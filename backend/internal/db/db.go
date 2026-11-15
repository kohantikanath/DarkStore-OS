// Package db holds the one shared way the rest of the backend talks to Postgres.
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// New opens a connection pool against DATABASE_URL-style connString and
// verifies it with a ping before returning, so callers fail fast on a bad
// connection instead of on their first query.
func New(ctx context.Context, connString string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, connString)
	if err != nil {
		return nil, fmt.Errorf("db: create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}

	return pool, nil
}
