package orders

import (
	"context"
	"errors"
	"fmt"

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

func (r *Repository) GetOrder(ctx context.Context, id string) (*Order, error) {
	var o Order
	err := r.pool.QueryRow(ctx,
		`SELECT id, status, version, total_paise, created_at, updated_at
		 FROM orders WHERE id = $1`, id,
	).Scan(&o.ID, &o.Status, &o.Version, &o.TotalPaise, &o.CreatedAt, &o.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("orders: get order: %w", err)
	}

	rows, err := r.pool.Query(ctx,
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
func (r *Repository) ListSummaries(ctx context.Context) ([]OrderSummary, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT o.id, o.status, o.version, o.total_paise, o.created_at, o.updated_at,
		        count(oi.id)
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
		); err != nil {
			return nil, fmt.Errorf("orders: scan summary: %w", err)
		}
		out = append(out, s)
	}

	return out, rows.Err()
}
