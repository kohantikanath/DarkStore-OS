package orders

import (
	"context"
	"fmt"
	"net/http"

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

type Service struct {
	pool   *pgxpool.Pool
	repo   *Repository
	prices priceLookup
}

func NewService(pool *pgxpool.Pool, repo *Repository, prices priceLookup) *Service {
	return &Service{pool: pool, repo: repo, prices: prices}
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
		Status:     "PLACED",
		Version:    1,
		TotalPaise: totalPaise,
	}
	if err := s.repo.InsertOrder(ctx, tx, order); err != nil {
		return nil, fmt.Errorf("orders: create: insert order: %w", err)
	}

	order.Items = make([]OrderItem, len(items))
	for i, item := range items {
		orderItem := OrderItem{ID: db.NewUUID(), ProductID: item.ProductID, Qty: item.Qty, Status: "PENDING"}
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
