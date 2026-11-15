package orders

import (
	"context"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kohantikanath/darkstore-os/backend/internal/db"
	"github.com/kohantikanath/darkstore-os/backend/internal/idempotency"
)

// priceLookup is the one thing Service needs from the products package,
// pulled out as an interface so this package doesn't import products
// directly (orders depending on products would be fine either way here, but
// keeping the dependency this narrow makes it obvious the service only ever
// needs prices, never the rest of the catalog).
type priceLookup interface {
	PriceLookup(ctx context.Context, ids []string) (map[string]int, error)
}

// broadcaster is the one thing Service needs from the ws package, narrowed to
// an interface for the same reason as priceLookup above.
type broadcaster interface {
	Broadcast(orderID, eventType string, order any)
}

type Service struct {
	pool   *pgxpool.Pool
	repo   *Repository
	prices priceLookup
	hub    broadcaster
}

func NewService(pool *pgxpool.Pool, repo *Repository, prices priceLookup, hub broadcaster) *Service {
	return &Service{pool: pool, repo: repo, prices: prices, hub: hub}
}

// CreateOrder validates the requested items against the catalog, reserves
// stock for each one atomically, and inserts the order — all in one
// transaction, with the idempotency record saved in the same transaction so
// a crash between "order created" and "key saved" can't happen.
func (s *Service) CreateOrder(ctx context.Context, idempotencyKey string, items []CreateOrderItem) (*Order, error) {
	ids := uniqueProductIDs(items)

	prices, err := s.prices.PriceLookup(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("orders: create: %w", err)
	}

	var unknown []string
	for _, id := range ids {
		if _, ok := prices[id]; !ok {
			unknown = append(unknown, id)
		}
	}
	if len(unknown) > 0 {
		return nil, &UnknownProductError{ProductIDs: unknown}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("orders: create: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	var shortfalls []StockShortfall
	for _, item := range items {
		ok, available, err := s.repo.ReserveStock(ctx, tx, item.ProductID, item.Qty)
		if err != nil {
			return nil, fmt.Errorf("orders: create: %w", err)
		}
		if !ok {
			shortfalls = append(shortfalls, StockShortfall{
				ProductID: item.ProductID, Requested: item.Qty, Available: available,
			})
		}
	}
	if len(shortfalls) > 0 {
		return nil, &InsufficientStockError{Items: shortfalls}
	}

	totalPaise := 0
	for _, item := range items {
		totalPaise += prices[item.ProductID] * item.Qty
	}

	order := &Order{
		ID:         db.NewUUID(),
		Status:     string(StatusPlaced),
		Version:    1,
		TotalPaise: totalPaise,
	}
	if err := s.repo.InsertOrder(ctx, tx, order); err != nil {
		return nil, fmt.Errorf("orders: create: insert order: %w", err)
	}

	order.Items = make([]OrderItem, len(items))
	for i, item := range items {
		orderItem := OrderItem{ID: db.NewUUID(), ProductID: item.ProductID, Qty: item.Qty, Status: string(ItemPending)}
		if err := s.repo.InsertOrderItem(ctx, tx, order.ID, orderItem); err != nil {
			return nil, fmt.Errorf("orders: create: insert item: %w", err)
		}
		order.Items[i] = orderItem
	}

	if err := idempotency.Save(ctx, tx, idempotencyKey, http.StatusCreated, order); err != nil {
		return nil, fmt.Errorf("orders: create: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("orders: create: commit: %w", err)
	}

	s.hub.Broadcast(order.ID, "order.created", order)

	return order, nil
}

// StartPicking moves an order from PLACED to PICKING.
func (s *Service) StartPicking(ctx context.Context, id string) (*Order, error) {
	return s.transition(ctx, id, StatusPlaced, StatusPicking, nil)
}

// Pack moves an order from PICKING to PACKED, and finalizes any items still
// PENDING to PICKED in the same transaction (see MarkRemainingItemsPicked).
func (s *Service) Pack(ctx context.Context, id string) (*Order, error) {
	return s.transition(ctx, id, StatusPicking, StatusPacked, s.repo.MarkRemainingItemsPicked)
}

// Dispatch moves an order from PACKED to DISPATCHED.
func (s *Service) Dispatch(ctx context.Context, id string) (*Order, error) {
	return s.transition(ctx, id, StatusPacked, StatusDispatched, nil)
}

// transition runs an order status change (and an optional extra step, e.g.
// Pack's bulk item update) in one transaction, then re-reads the full order
// to return and broadcast a fully up-to-date snapshot.
func (s *Service) transition(
	ctx context.Context, id string, from, to OrderStatus,
	extra func(ctx context.Context, tx pgx.Tx, orderID string) error,
) (*Order, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("orders: transition: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	if err := s.repo.TransitionOrderStatus(ctx, tx, id, from, to); err != nil {
		return nil, err
	}

	if extra != nil {
		if err := extra(ctx, tx, id); err != nil {
			return nil, fmt.Errorf("orders: transition: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("orders: transition: commit: %w", err)
	}

	order, err := s.repo.GetOrder(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("orders: transition: reload: %w", err)
	}

	s.hub.Broadcast(order.ID, "order.updated", order)

	return order, nil
}

func uniqueProductIDs(items []CreateOrderItem) []string {
	seen := make(map[string]bool, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		if !seen[item.ProductID] {
			seen[item.ProductID] = true
			out = append(out, item.ProductID)
		}
	}
	return out
}
