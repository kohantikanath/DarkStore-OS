package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("orders: not found")

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// ReserveStock atomically reserves qty units of productID, per the spec's
// conditional-update rule: the WHERE clause only lets the row change if
// there's enough available, so a failed reservation never partially applies.
// When it fails, it separately reads the current available count (within the
// same transaction) purely to report a useful error back to the caller.
func (r *Repository) ReserveStock(ctx context.Context, tx pgx.Tx, productID string, qty int) (ok bool, available int, err error) {
	ct, err := tx.Exec(ctx,
		`UPDATE stock SET available = available - $1, reserved = reserved + $1
		 WHERE product_id = $2 AND available >= $1`,
		qty, productID,
	)
	if err != nil {
		return false, 0, fmt.Errorf("orders: reserve stock: %w", err)
	}
	if ct.RowsAffected() > 0 {
		return true, 0, nil
	}

	if err := tx.QueryRow(ctx,
		`SELECT available FROM stock WHERE product_id = $1`, productID,
	).Scan(&available); err != nil {
		return false, 0, fmt.Errorf("orders: read available after failed reservation: %w", err)
	}

	return false, available, nil
}

// InsertOrder inserts the order row and returns the DB-assigned created_at
// and updated_at, since those are set by column defaults rather than chosen
// by the caller.
func (r *Repository) InsertOrder(ctx context.Context, tx pgx.Tx, order *Order) error {
	return tx.QueryRow(ctx,
		`INSERT INTO orders (id, status, version, total_paise)
		 VALUES ($1, $2, $3, $4)
		 RETURNING created_at, updated_at`,
		order.ID, order.Status, order.Version, order.TotalPaise,
	).Scan(&order.CreatedAt, &order.UpdatedAt)
}

func (r *Repository) InsertOrderItem(ctx context.Context, tx pgx.Tx, orderID string, item OrderItem) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO order_items (id, order_id, product_id, qty, status)
		 VALUES ($1, $2, $3, $4, $5)`,
		item.ID, orderID, item.ProductID, item.Qty, item.Status,
	)
	return err
}

// TransitionOrderStatus moves an order from `from` to `to`, bumping version
// by 1. It locks the row with FOR UPDATE and checks the current status
// itself (rather than relying on a conditional UPDATE's rows-affected)
// because it needs to tell "order doesn't exist" (404) apart from "order
// exists but is in the wrong state" (409) — the conditional-update pattern
// used by ReserveStock can't make that distinction on its own.
func (r *Repository) TransitionOrderStatus(ctx context.Context, tx pgx.Tx, id string, from, to OrderStatus) error {
	var current string
	err := tx.QueryRow(ctx,
		`SELECT status FROM orders WHERE id = $1 FOR UPDATE`, id,
	).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("orders: read status for transition: %w", err)
	}
	if OrderStatus(current) != from {
		return &TransitionError{Entity: "order", From: current, To: string(to)}
	}

	if _, err := tx.Exec(ctx,
		`UPDATE orders SET status = $1, version = version + 1, updated_at = now() WHERE id = $2`,
		to, id,
	); err != nil {
		return fmt.Errorf("orders: transition order: %w", err)
	}

	return nil
}

// MarkRemainingItemsPicked bulk-finalizes every still-PENDING item on an
// order to PICKED. There's no separate "mark this item picked" endpoint —
// picking is the default outcome, and "short" is the one exception a picker
// has to actively flag — so this runs as part of packing an order.
func (r *Repository) MarkRemainingItemsPicked(ctx context.Context, tx pgx.Tx, orderID string) error {
	_, err := tx.Exec(ctx,
		`UPDATE order_items SET status = $1 WHERE order_id = $2 AND status = $3`,
		ItemPicked, orderID, ItemPending,
	)
	if err != nil {
		return fmt.Errorf("orders: mark remaining items picked: %w", err)
	}
	return nil
}

// itemForUpdate is a row-locked snapshot of one order_item, joined with its
// parent order's status — the short/substitute flows need both at once to
// validate preconditions (order must be PICKING, item must be in the right
// state) before touching anything.
type itemForUpdate struct {
	OrderID           string
	OrderStatus       string
	ItemStatus        string
	ProductID         string
	Qty               int
	SubstituteOptions []byte
	ExpiresAt         *time.Time
}

// GetItemForUpdate locks both the item and its parent order FOR UPDATE, so
// two concurrent requests (a picker marking an item short while the expiry
// ticker is refunding it, say) can't race. It's looked up by item id alone
// (not scoped to an order id) so the expiry ticker — which only has an item
// id — can reuse it; callers that came in via /orders/{id}/items/{itemId}
// check the returned OrderID themselves and treat a mismatch as not found.
func (r *Repository) GetItemForUpdate(ctx context.Context, tx pgx.Tx, itemID string) (*itemForUpdate, error) {
	var out itemForUpdate
	err := tx.QueryRow(ctx, `
		SELECT oi.order_id, o.status, oi.status, oi.product_id, oi.qty,
		       oi.substitute_options, oi.expires_at
		FROM order_items oi
		JOIN orders o ON o.id = oi.order_id
		WHERE oi.id = $1
		FOR UPDATE OF oi, o`,
		itemID,
	).Scan(
		&out.OrderID, &out.OrderStatus, &out.ItemStatus, &out.ProductID, &out.Qty,
		&out.SubstituteOptions, &out.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("orders: get item for update: %w", err)
	}
	return &out, nil
}

// WriteOffReservation removes qty units from a product's reserved count
// without returning them to available — used when a picker marks an item
// short: the reservation was never going to be fulfilled, but the units
// aren't magically back on the shelf either (that's the whole reason it was
// short), so this is a write-off, not a release.
func (r *Repository) WriteOffReservation(ctx context.Context, tx pgx.Tx, productID string, qty int) error {
	_, err := tx.Exec(ctx,
		`UPDATE stock SET reserved = reserved - $1 WHERE product_id = $2`, qty, productID)
	if err != nil {
		return fmt.Errorf("orders: write off reservation: %w", err)
	}
	return nil
}

// ReleaseStock returns qty reserved units to available — used for a
// substitute candidate that was reserved as an option but never chosen
// (either the customer picked the other one, or the offer expired): unlike
// WriteOffReservation, this stock genuinely exists and is sellable again.
func (r *Repository) ReleaseStock(ctx context.Context, tx pgx.Tx, productID string, qty int) error {
	_, err := tx.Exec(ctx,
		`UPDATE stock SET available = available + $1, reserved = reserved - $1 WHERE product_id = $2`,
		qty, productID,
	)
	if err != nil {
		return fmt.Errorf("orders: release stock: %w", err)
	}
	return nil
}

func (r *Repository) MarkItemAwaitingSubstitute(
	ctx context.Context, tx pgx.Tx, itemID string, options []byte, expiresAt time.Time,
) error {
	_, err := tx.Exec(ctx,
		`UPDATE order_items SET status = $1, substitute_options = $2, expires_at = $3 WHERE id = $4`,
		ItemAwaitingSubstitute, options, expiresAt, itemID,
	)
	if err != nil {
		return fmt.Errorf("orders: mark item awaiting substitute: %w", err)
	}
	return nil
}

func (r *Repository) MarkItemSubstituted(ctx context.Context, tx pgx.Tx, itemID, substituteProductID string) error {
	_, err := tx.Exec(ctx,
		`UPDATE order_items SET status = $1, substitute_product_id = $2, expires_at = NULL WHERE id = $3`,
		ItemSubstituted, substituteProductID, itemID,
	)
	if err != nil {
		return fmt.Errorf("orders: mark item substituted: %w", err)
	}
	return nil
}

func (r *Repository) MarkItemRefunded(ctx context.Context, tx pgx.Tx, itemID string) error {
	_, err := tx.Exec(ctx,
		`UPDATE order_items SET status = $1, expires_at = NULL WHERE id = $2`, ItemRefunded, itemID)
	if err != nil {
		return fmt.Errorf("orders: mark item refunded: %w", err)
	}
	return nil
}

// BumpOrderVersion increments an order's version without touching its
// status — used by the substitution flows, which change an item, not the
// order's own status, but still need to bump the version every change-rule
// the frontend's cache patching relies on.
func (r *Repository) BumpOrderVersion(ctx context.Context, tx pgx.Tx, orderID string) error {
	_, err := tx.Exec(ctx,
		`UPDATE orders SET version = version + 1, updated_at = now() WHERE id = $1`, orderID)
	if err != nil {
		return fmt.Errorf("orders: bump version: %w", err)
	}
	return nil
}

// FindExpiredAwaitingSubstitution returns the ids of every item whose
// substitution offer has passed its deadline. Backed by the partial index
// on (expires_at) WHERE status = 'AWAITING_SUBSTITUTE' from the Phase 1
// migration, built for exactly this scan.
func (r *Repository) FindExpiredAwaitingSubstitution(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id FROM order_items WHERE status = $1 AND expires_at <= now()`, ItemAwaitingSubstitute)
	if err != nil {
		return nil, fmt.Errorf("orders: find expired: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("orders: scan expired id: %w", err)
		}
		ids = append(ids, id)
	}

	return ids, rows.Err()
}

// queryRower is the common subset of *pgxpool.Pool and pgx.Tx that getOrder
// needs — letting the same query logic run either against the pool (the
// normal case: read whatever's currently committed) or against an
// in-flight transaction (see GetOrderTx) without duplicating the SQL.
type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (r *Repository) GetOrder(ctx context.Context, id string) (*Order, error) {
	return getOrder(ctx, r.pool, id)
}

// GetOrderTx is GetOrder's transaction-scoped twin. A transaction always
// sees its own uncommitted writes, so this is what a caller needs when it
// has to build the post-write order content *before* committing — e.g. to
// save alongside an idempotency record in the same transaction (see
// Service.ChooseSubstitute). GetOrder itself can't be used for that: it
// reads via the pool, which — correctly — can't see another transaction's
// uncommitted changes, so calling it before commit would return stale data.
func (r *Repository) GetOrderTx(ctx context.Context, tx pgx.Tx, id string) (*Order, error) {
	return getOrder(ctx, tx, id)
}

func getOrder(ctx context.Context, q queryRower, id string) (*Order, error) {
	var o Order
	err := q.QueryRow(ctx,
		`SELECT id, status, version, total_paise, created_at, updated_at
		 FROM orders WHERE id = $1`, id,
	).Scan(&o.ID, &o.Status, &o.Version, &o.TotalPaise, &o.CreatedAt, &o.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("orders: get order: %w", err)
	}

	rows, err := q.Query(ctx,
		`SELECT id, product_id, qty, status, substitute_product_id, substitute_options, expires_at
		 FROM order_items WHERE order_id = $1 ORDER BY id`, id,
	)
	if err != nil {
		return nil, fmt.Errorf("orders: get order items: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var item OrderItem
		if err := rows.Scan(
			&item.ID, &item.ProductID, &item.Qty, &item.Status,
			&item.SubstituteProductID, &item.SubstituteOptions, &item.ExpiresAt,
		); err != nil {
			return nil, fmt.Errorf("orders: scan order item: %w", err)
		}
		o.Items = append(o.Items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &o, nil
}

// ListSummaries returns every order as a lightweight row (no item array) for
// the ops table. It's a full-table read with no pagination — see the README
// for why that's an acceptable trade-off at this project's scale.
//
// awaiting_substitution is computed with bool_or over the same
// order_items join this query already does for item_count, rather than a
// separate correlated EXISTS subquery per order — the join has to visit
// every order_item row either way, so folding the check into the existing
// aggregate costs nothing extra, where a second subquery would mean a
// second index lookup per row across all 10,000+ orders.
//
// Wrapped in COALESCE(..., false): bool_or aggregates to NULL for a group
// with no non-NULL input, which is exactly what an order with zero
// order_items rows produces through the LEFT JOIN — confirmed directly
// against Postgres, and an order should never actually have zero items,
// but without this, a NULL here wouldn't quietly read as "not awaiting a
// substitution" — pgx refuses to scan NULL into a plain bool at all
// ("cannot scan NULL into *bool"), confirmed directly too, so it would
// fail this entire query, for every order, not just the itemless one.
func (r *Repository) ListSummaries(ctx context.Context) ([]OrderSummary, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT o.id, o.status, o.version, o.total_paise, o.created_at, o.updated_at,
		        count(oi.id),
		        COALESCE(bool_or(oi.status = 'AWAITING_SUBSTITUTE'), false)
		 FROM orders o
		 LEFT JOIN order_items oi ON oi.order_id = o.id
		 GROUP BY o.id
		 ORDER BY o.created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("orders: list summaries: %w", err)
	}
	defer rows.Close()

	var out []OrderSummary
	for rows.Next() {
		var s OrderSummary
		if err := rows.Scan(
			&s.ID, &s.Status, &s.Version, &s.TotalPaise, &s.CreatedAt, &s.UpdatedAt, &s.ItemCount,
			&s.AwaitingSubstitution,
		); err != nil {
			return nil, fmt.Errorf("orders: scan summary: %w", err)
		}
		out = append(out, s)
	}

	return out, rows.Err()
}
