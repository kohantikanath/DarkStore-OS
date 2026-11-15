package orders

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kohantikanath/darkstore-os/backend/internal/db"
	"github.com/kohantikanath/darkstore-os/backend/internal/idempotency"
	"github.com/kohantikanath/darkstore-os/backend/internal/products"
)

// catalog is the one thing Service needs from the products package, pulled
// out as an interface so this package doesn't import products' repository
// or handler logic directly — only its plain data types (Product,
// SubstituteCandidate), which are just shared DTOs, not behavior.
type catalog interface {
	PriceLookup(ctx context.Context, ids []string) (map[string]int, error)
	RandomProductIDs(ctx context.Context, n int) ([]string, error)
	GetProduct(ctx context.Context, id string) (*products.Product, error)
	SubstituteCandidates(ctx context.Context, subcategory, excludeProductID string, minAvailable, targetPricePaise, limit int) ([]products.SubstituteCandidate, error)
}

// broadcaster is the one thing Service needs from the ws package, narrowed to
// an interface for the same reason as catalog above.
type broadcaster interface {
	Broadcast(orderID, eventType string, order any)
}

// substitutionWindow is how long a customer has to choose a replacement
// before the expiry ticker auto-refunds the item, per the spec.
const substitutionWindow = 60 * time.Second

// maxSubstituteCandidates is how many replacement options are offered.
const maxSubstituteCandidates = 2

type Service struct {
	pool    *pgxpool.Pool
	repo    *Repository
	catalog catalog
	hub     broadcaster
}

func NewService(pool *pgxpool.Pool, repo *Repository, catalog catalog, hub broadcaster) *Service {
	return &Service{pool: pool, repo: repo, catalog: catalog, hub: hub}
}

// CreateOrder validates the requested items against the catalog, reserves
// stock for each one atomically, and inserts the order — all in one
// transaction, with the idempotency record saved in the same transaction so
// a crash between "order created" and "key saved" can't happen.
func (s *Service) CreateOrder(ctx context.Context, idempotencyKey string, items []CreateOrderItem) (*Order, error) {
	ids := uniqueProductIDs(items)

	prices, err := s.catalog.PriceLookup(ctx, ids)
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

// SimulateOrder creates one order from a random sample of the catalog, for
// POST /api/dev/simulate — it's just CreateOrder with made-up input, so it
// gets the same atomic stock reservation, idempotency bookkeeping, and
// live broadcast for free, and a simulated order behaves identically to a
// real one everywhere else in the system.
func (s *Service) SimulateOrder(ctx context.Context) (*Order, error) {
	n := 1 + rand.Intn(3) // 1-3 line items

	ids, err := s.catalog.RandomProductIDs(ctx, n)
	if err != nil {
		return nil, fmt.Errorf("orders: simulate: %w", err)
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("orders: simulate: no products in catalog")
	}

	items := make([]CreateOrderItem, len(ids))
	for i, id := range ids {
		items[i] = CreateOrderItem{ProductID: id, Qty: 1 + rand.Intn(3)}
	}

	return s.CreateOrder(ctx, db.NewUUID(), items)
}

// StartPicking moves an order from PLACED to PICKING.
func (s *Service) StartPicking(ctx context.Context, id string) (*Order, error) {
	return s.transition(ctx, id, StatusPlaced, StatusPicking, nil)
}

// Pack moves an order from PICKING to PACKED, and finalizes any items still
// PENDING to PICKED in the same transaction (see MarkRemainingItemsPicked).
// Refuses with SubstitutionPendingError if any item is still
// AWAITING_SUBSTITUTE — see packExtra and CanPackOrder.
func (s *Service) Pack(ctx context.Context, id string) (*Order, error) {
	return s.transition(ctx, id, StatusPicking, StatusPacked, s.packExtra)
}

// packExtra runs as transition's "extra" step, inside the same transaction
// that already locked the order row (TransitionOrderStatus's own
// SELECT ... FOR UPDATE) — see HasItemAwaitingSubstitute for why that
// ordering is what makes this check race-safe. By this point the order's
// status is already known to have been StatusPicking (TransitionOrderStatus
// would have failed otherwise), so CanPackOrder's first condition is really
// just documenting the rule for readers and tests, not re-deriving
// something this call site doesn't already know.
func (s *Service) packExtra(ctx context.Context, tx pgx.Tx, orderID string) error {
	awaiting, err := s.repo.HasItemAwaitingSubstitute(ctx, tx, orderID)
	if err != nil {
		return err
	}
	if !CanPackOrder(StatusPicking, awaiting) {
		return &SubstitutionPendingError{}
	}
	return s.repo.MarkRemainingItemsPicked(ctx, tx, orderID)
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

	return s.reloadAndBroadcast(ctx, id)
}

// MarkItemShort handles a picker flagging an item as short. It writes off
// the original product's reservation (that stock was never really there —
// see Repository.WriteOffReservation), looks for up to two same-subcategory
// replacements within ±30% of the price with enough stock, and reserves
// shortQty units of each one it finds. If it finds none, the item is
// refunded immediately — the same outcome as if an offer had been made and
// nobody answered in time.
//
// The spec's API accepts a shortQty distinct from the item's own qty, but
// since order_items has one status per row (no sub-row quantity split),
// this implementation treats the whole item as short rather than modeling
// partial shortages — see the README for why that's a deliberate
// simplification, not an oversight.
func (s *Service) MarkItemShort(ctx context.Context, orderID, itemID string, shortQty int) (*Order, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("orders: mark short: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	item, err := s.repo.GetItemForUpdate(ctx, tx, itemID)
	if err != nil {
		return nil, err
	}
	if item.OrderID != orderID {
		return nil, ErrNotFound
	}
	if !CanMarkItemShort(OrderStatus(item.OrderStatus), ItemStatus(item.ItemStatus)) {
		return nil, &TransitionError{
			Entity: "item", From: item.ItemStatus, To: string(ItemAwaitingSubstitute),
		}
	}
	if shortQty < 1 || shortQty > item.Qty {
		return nil, &ValidationError{Message: fmt.Sprintf("shortQty must be between 1 and %d", item.Qty)}
	}

	product, err := s.catalog.GetProduct(ctx, item.ProductID)
	if err != nil {
		return nil, fmt.Errorf("orders: mark short: %w", err)
	}

	if err := s.repo.WriteOffReservation(ctx, tx, item.ProductID, shortQty); err != nil {
		return nil, err
	}

	found, err := s.catalog.SubstituteCandidates(
		ctx, product.Subcategory, product.ID, shortQty, product.PricePaise, maxSubstituteCandidates,
	)
	if err != nil {
		return nil, fmt.Errorf("orders: mark short: %w", err)
	}

	var reserved []SubstituteCandidate
	for _, c := range found {
		ok, _, err := s.repo.ReserveStock(ctx, tx, c.ProductID, shortQty)
		if err != nil {
			return nil, err
		}
		if ok {
			reserved = append(reserved, SubstituteCandidate{
				ProductID: c.ProductID, Name: c.Name, PricePaise: c.PricePaise,
			})
		}
		// Not ok means stock changed out from under us between the SELECT and
		// here; just offer fewer candidates rather than fail the whole request.
	}

	if len(reserved) == 0 {
		if err := s.repo.MarkItemRefunded(ctx, tx, itemID); err != nil {
			return nil, err
		}
	} else {
		offer := SubstituteOffer{ShortQty: shortQty, Candidates: reserved}
		optionsJSON, err := json.Marshal(offer)
		if err != nil {
			return nil, fmt.Errorf("orders: mark short: marshal offer: %w", err)
		}
		expiresAt := time.Now().Add(substitutionWindow)
		if err := s.repo.MarkItemAwaitingSubstitute(ctx, tx, itemID, optionsJSON, expiresAt); err != nil {
			return nil, err
		}
	}

	if err := s.repo.BumpOrderVersion(ctx, tx, orderID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("orders: mark short: commit: %w", err)
	}

	return s.reloadAndBroadcast(ctx, orderID)
}

// ChooseSubstitute applies the customer's pick: the chosen candidate's
// reservation (already made when the offer went out) simply becomes real,
// and any other candidate that was offered but not chosen is released back
// to available stock.
func (s *Service) ChooseSubstitute(
	ctx context.Context, orderID, itemID, idempotencyKey, chosenProductID string,
) (*Order, error) {
	stored, err := idempotency.Lookup(ctx, s.pool, idempotencyKey)
	if err != nil {
		return nil, fmt.Errorf("orders: choose substitute: %w", err)
	}
	if stored != nil {
		var order Order
		if err := json.Unmarshal(stored.Body, &order); err != nil {
			return nil, fmt.Errorf("orders: choose substitute: unmarshal replay: %w", err)
		}
		return &order, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("orders: choose substitute: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	item, err := s.repo.GetItemForUpdate(ctx, tx, itemID)
	if err != nil {
		return nil, err
	}
	if item.OrderID != orderID {
		return nil, ErrNotFound
	}
	if !CanChooseSubstitute(OrderStatus(item.OrderStatus), ItemStatus(item.ItemStatus)) {
		return nil, &TransitionError{
			Entity: "item", From: item.ItemStatus, To: string(ItemSubstituted),
		}
	}
	if item.ExpiresAt == nil || time.Now().After(*item.ExpiresAt) {
		return nil, &ExpiredError{}
	}

	var offer SubstituteOffer
	if err := json.Unmarshal(item.SubstituteOptions, &offer); err != nil {
		return nil, fmt.Errorf("orders: choose substitute: unmarshal offer: %w", err)
	}

	var chosen *SubstituteCandidate
	for i, c := range offer.Candidates {
		if c.ProductID == chosenProductID {
			chosen = &offer.Candidates[i]
			continue
		}
		// Every offered candidate was already reserved; the ones not chosen
		// are released now rather than left reserved forever.
		if err := s.repo.ReleaseStock(ctx, tx, c.ProductID, offer.ShortQty); err != nil {
			return nil, err
		}
	}
	if chosen == nil {
		return nil, &InvalidSubstituteChoiceError{ProductID: chosenProductID}
	}

	if err := s.repo.MarkItemSubstituted(ctx, tx, itemID, chosen.ProductID); err != nil {
		return nil, err
	}
	if err := s.repo.BumpOrderVersion(ctx, tx, orderID); err != nil {
		return nil, err
	}

	// GetOrderTx, not GetOrder: this read has to happen inside tx, before
	// commit, so it sees the writes this same transaction just made (the
	// pool-backed GetOrder can't — another connection never sees an
	// in-flight transaction's uncommitted changes).
	order, err := s.repo.GetOrderTx(ctx, tx, orderID)
	if err != nil {
		return nil, fmt.Errorf("orders: choose substitute: reload: %w", err)
	}
	if err := idempotency.Save(ctx, tx, idempotencyKey, http.StatusOK, order); err != nil {
		return nil, fmt.Errorf("orders: choose substitute: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("orders: choose substitute: commit: %w", err)
	}

	s.hub.Broadcast(order.ID, "order.updated", order)

	return order, nil
}

// ExpireDueSubstitutions is called by the background ticker (see
// cmd/server/main.go) every 2 seconds. Each due item is refunded in its own
// transaction so one bad row can't block the rest, and a row already
// resolved by the time its transaction starts (the customer chose at the
// last second) is simply skipped rather than treated as an error.
func (s *Service) ExpireDueSubstitutions(ctx context.Context) {
	ids, err := s.repo.FindExpiredAwaitingSubstitution(ctx)
	if err != nil {
		log.Printf("orders: expire: find due items: %v", err)
		return
	}

	for _, itemID := range ids {
		if err := s.refundExpiredItem(ctx, itemID); err != nil {
			log.Printf("orders: expire: item %s: %v", itemID, err)
		}
	}
}

func (s *Service) refundExpiredItem(ctx context.Context, itemID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	item, err := s.repo.GetItemForUpdate(ctx, tx, itemID)
	if err != nil {
		return err
	}
	// Re-check under the lock: the customer may have chosen in the gap
	// between FindExpiredAwaitingSubstitution's read and this transaction.
	if !IsDueForExpiry(ItemStatus(item.ItemStatus), item.ExpiresAt, time.Now()) {
		return nil
	}

	var offer SubstituteOffer
	if err := json.Unmarshal(item.SubstituteOptions, &offer); err != nil {
		return fmt.Errorf("unmarshal offer: %w", err)
	}
	for _, c := range offer.Candidates {
		if err := s.repo.ReleaseStock(ctx, tx, c.ProductID, offer.ShortQty); err != nil {
			return err
		}
	}

	if err := s.repo.MarkItemRefunded(ctx, tx, itemID); err != nil {
		return err
	}
	if err := s.repo.BumpOrderVersion(ctx, tx, item.OrderID); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	order, err := s.repo.GetOrder(ctx, item.OrderID)
	if err != nil {
		return fmt.Errorf("reload: %w", err)
	}
	s.hub.Broadcast(order.ID, "order.updated", order)

	return nil
}

// reloadAndBroadcast re-reads an order (to pick up everything a just-committed
// transaction changed) and broadcasts it, so every mutation ends with the
// same "reload the authoritative state, then tell everyone" shape.
func (s *Service) reloadAndBroadcast(ctx context.Context, orderID string) (*Order, error) {
	order, err := s.repo.GetOrder(ctx, orderID)
	if err != nil {
		return nil, fmt.Errorf("orders: reload: %w", err)
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
