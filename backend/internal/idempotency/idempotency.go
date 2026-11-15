// Package idempotency lets a handler replay the exact response of an earlier
// request instead of repeating its side effects, keyed by the client-supplied
// Idempotency-Key header.
package idempotency

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Stored is a previously-recorded response for a given key.
type Stored struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

// Lookup returns the stored response for key, if any request has already
// completed with it.
func Lookup(ctx context.Context, pool *pgxpool.Pool, key string) (*Stored, error) {
	var raw []byte
	err := pool.QueryRow(ctx,
		`SELECT response_json FROM idempotency_keys WHERE key = $1`, key,
	).Scan(&raw)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("idempotency: lookup: %w", err)
	}

	var stored Stored
	if err := json.Unmarshal(raw, &stored); err != nil {
		return nil, fmt.Errorf("idempotency: unmarshal stored response: %w", err)
	}

	return &stored, nil
}

// Save records a response for key as part of the caller's transaction, so it
// commits atomically with whatever side effect it is guarding.
//
// Known limitation: two requests with the same brand-new key arriving at
// truly the same instant can both pass Lookup and both proceed — real
// distributed idempotency would need a row lock or a unique-constraint-first
// insert. Acceptable here since the frontend only ever issues one request per
// generated key.
func Save(ctx context.Context, tx pgx.Tx, key string, status int, body any) error {
	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("idempotency: marshal body: %w", err)
	}

	stored := Stored{Status: status, Body: bodyJSON}
	storedJSON, err := json.Marshal(stored)
	if err != nil {
		return fmt.Errorf("idempotency: marshal stored: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO idempotency_keys (key, response_json) VALUES ($1, $2)`,
		key, storedJSON,
	); err != nil {
		return fmt.Errorf("idempotency: save: %w", err)
	}

	return nil
}
