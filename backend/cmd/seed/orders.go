package main

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kohantikanath/darkstore-os/backend/internal/db"
)

const (
	numHistoricalOrders = 10_000
	maxItemsPerOrder    = 5
	historyWindowDays   = 60
)

// orderStatuses and their relative weights. Historical data skews toward
// finished orders (PACKED/DISPATCHED) since a seed of "live" in-progress
// orders wouldn't make sense for data that's supposed to be in the past.
var orderStatuses = []struct {
	name   string
	weight int
}{
	{"PLACED", 10},
	{"PICKING", 15},
	{"PACKED", 25},
	{"DISPATCHED", 50},
}

// seedOrders generates numHistoricalOrders orders (with 1-5 items each) and
// bulk-loads them with COPY, which is dramatically faster than individual
// INSERTs at this volume. Deterministic rand.NewSource keeps the seed
// reproducible across runs.
func seedOrders(ctx context.Context, pool *pgxpool.Pool, products []seededProduct) (numOrders, numItems int, err error) {
	rng := rand.New(rand.NewSource(42))

	byCategory := make(map[string][]int)
	for i, p := range products {
		byCategory[p.category] = append(byCategory[p.category], i)
	}

	now := time.Now()
	orderRows := make([][]interface{}, 0, numHistoricalOrders)
	itemRows := make([][]interface{}, 0, numHistoricalOrders*3)

	for i := 0; i < numHistoricalOrders; i++ {
		orderID := db.NewUUID()
		status := weightedStatus(rng)

		createdAt := now.Add(-time.Duration(rng.Intn(historyWindowDays*24*60)) * time.Minute)
		updatedAt := createdAt
		if status != "PLACED" {
			updatedAt = createdAt.Add(time.Duration(5+rng.Intn(115)) * time.Minute)
		}

		itemCount := 1 + rng.Intn(maxItemsPerOrder)
		chosen := pickDistinctProducts(rng, len(products), itemCount)

		totalPaise := 0
		for _, pIdx := range chosen {
			p := products[pIdx]
			qty := 1 + rng.Intn(3)
			totalPaise += p.pricePaise * qty

			itemStatus, substituteIdx := itemStatusFor(rng, status, byCategory[p.category], pIdx)

			var substituteProductID interface{}
			if substituteIdx >= 0 {
				substituteProductID = products[substituteIdx].id
			}

			itemRows = append(itemRows, []interface{}{
				db.NewUUID(), orderID, p.id, qty, itemStatus, substituteProductID, nil, nil,
			})
		}

		orderRows = append(orderRows, []interface{}{
			orderID, status, 1, totalPaise, createdAt, updatedAt,
		})
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	if _, err := tx.CopyFrom(ctx,
		pgx.Identifier{"orders"},
		[]string{"id", "status", "version", "total_paise", "created_at", "updated_at"},
		pgx.CopyFromRows(orderRows),
	); err != nil {
		return 0, 0, fmt.Errorf("copy orders: %w", err)
	}

	if _, err := tx.CopyFrom(ctx,
		pgx.Identifier{"order_items"},
		[]string{"id", "order_id", "product_id", "qty", "status", "substitute_product_id", "substitute_options", "expires_at"},
		pgx.CopyFromRows(itemRows),
	); err != nil {
		return 0, 0, fmt.Errorf("copy order_items: %w", err)
	}

	return len(orderRows), len(itemRows), tx.Commit(ctx)
}

func weightedStatus(rng *rand.Rand) string {
	total := 0
	for _, s := range orderStatuses {
		total += s.weight
	}

	r := rng.Intn(total)
	cum := 0
	for _, s := range orderStatuses {
		cum += s.weight
		if r < cum {
			return s.name
		}
	}

	return orderStatuses[len(orderStatuses)-1].name
}

// pickDistinctProducts returns k distinct indices into products, so one order
// never lists the same product twice.
func pickDistinctProducts(rng *rand.Rand, n, k int) []int {
	if k > n {
		k = n
	}

	seen := make(map[int]bool, k)
	out := make([]int, 0, k)
	for len(out) < k {
		idx := rng.Intn(n)
		if seen[idx] {
			continue
		}
		seen[idx] = true
		out = append(out, idx)
	}

	return out
}

// itemStatusFor picks a plausible item status given the order's own status.
// For finished orders it occasionally picks SUBSTITUTED, in which case it
// also returns the index of a same-category substitute product; otherwise it
// returns -1. This is seed data standing in for history, not a replay of the
// real state machine, so the mix is an approximation, not a strict invariant.
func itemStatusFor(rng *rand.Rand, orderStatus string, sameCategory []int, selfIdx int) (status string, substituteIdx int) {
	switch orderStatus {
	case "PLACED":
		return "PENDING", -1
	case "PICKING":
		if rng.Intn(2) == 0 {
			return "PENDING", -1
		}
		return "PICKED", -1
	default: // PACKED, DISPATCHED
		roll := rng.Intn(100)
		switch {
		case roll < 85:
			return "PICKED", -1
		case roll < 95:
			candidates := excluding(sameCategory, selfIdx)
			if len(candidates) == 0 {
				return "PICKED", -1
			}
			return "SUBSTITUTED", candidates[rng.Intn(len(candidates))]
		default:
			return "REFUNDED", -1
		}
	}
}

func excluding(indices []int, exclude int) []int {
	out := make([]int, 0, len(indices))
	for _, i := range indices {
		if i != exclude {
			out = append(out, i)
		}
	}
	return out
}
