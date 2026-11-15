// Command seed wipes and repopulates the database with demo data: the
// product catalog plus stock, and a batch of historical orders so the ops
// table has something realistic to virtualize. It is meant for local
// development and demos only — it always truncates first, so never point it
// at anything you care about.
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kohantikanath/darkstore-os/backend/internal/db"
)

const initialStockPerSKU = 200

// seededProduct is a catalog entry after it's been written to the DB and
// assigned an id, which order generation needs to build references.
type seededProduct struct {
	id         string
	category   string
	pricePaise int
}

func main() {
	connString := os.Getenv("DATABASE_URL")
	if connString == "" {
		log.Fatal("seed: DATABASE_URL is required")
	}

	ctx := context.Background()

	pool, err := db.New(ctx, connString)
	if err != nil {
		log.Fatalf("seed: %v", err)
	}
	defer pool.Close()

	if err := run(ctx, pool); err != nil {
		log.Fatalf("seed: %v", err)
	}

	log.Println("seed: done")
}

func run(ctx context.Context, pool *pgxpool.Pool) error {
	if err := wipe(ctx, pool); err != nil {
		return fmt.Errorf("wipe: %w", err)
	}

	products, err := seedProducts(ctx, pool)
	if err != nil {
		return fmt.Errorf("seed products: %w", err)
	}
	log.Printf("seed: inserted %d products + stock rows", len(products))

	numOrders, numItems, err := seedOrders(ctx, pool, products)
	if err != nil {
		return fmt.Errorf("seed orders: %w", err)
	}
	log.Printf("seed: inserted %d historical orders (%d items)", numOrders, numItems)

	return nil
}

func wipe(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx,
		`TRUNCATE idempotency_keys, order_items, orders, stock, products CASCADE`)
	return err
}

func seedProducts(ctx context.Context, pool *pgxpool.Pool) ([]seededProduct, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	products := make([]seededProduct, len(catalog))
	for i, p := range catalog {
		products[i] = seededProduct{id: db.NewUUID(), category: p.category, pricePaise: p.pricePaise}

		if _, err := tx.Exec(ctx,
			`INSERT INTO products (id, name, category, price_paise) VALUES ($1, $2, $3, $4)`,
			products[i].id, p.name, p.category, p.pricePaise,
		); err != nil {
			return nil, fmt.Errorf("insert product %q: %w", p.name, err)
		}
	}

	stockRows := make([][]interface{}, len(products))
	for i, p := range products {
		stockRows[i] = []interface{}{p.id, initialStockPerSKU, 0}
	}
	if _, err := tx.CopyFrom(ctx,
		pgx.Identifier{"stock"},
		[]string{"product_id", "available", "reserved"},
		pgx.CopyFromRows(stockRows),
	); err != nil {
		return nil, fmt.Errorf("copy stock: %w", err)
	}

	return products, tx.Commit(ctx)
}
