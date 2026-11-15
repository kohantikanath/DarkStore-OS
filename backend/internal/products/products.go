// Package products serves the catalog. It deliberately does not expose live
// stock numbers (see Handler.List) so the response stays stable enough for
// the ETag/staleTime caching the frontend relies on.
package products

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kohantikanath/darkstore-os/backend/internal/httpx"
)

var ErrNotFound = errors.New("products: not found")

type Product struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Category   string `json:"category"`
	PricePaise int    `json:"pricePaise"`
}

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) List(ctx context.Context) ([]Product, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, category, price_paise FROM products ORDER BY category, name`)
	if err != nil {
		return nil, fmt.Errorf("products: list: %w", err)
	}
	defer rows.Close()

	var out []Product
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Category, &p.PricePaise); err != nil {
			return nil, fmt.Errorf("products: scan: %w", err)
		}
		out = append(out, p)
	}

	return out, rows.Err()
}

// PriceLookup returns price_paise for the given product IDs, keyed by ID.
// Missing IDs are simply absent from the result — callers decide how to
// treat an unknown product.
func (r *Repository) PriceLookup(ctx context.Context, ids []string) (map[string]int, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, price_paise FROM products WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("products: price lookup: %w", err)
	}
	defer rows.Close()

	out := make(map[string]int, len(ids))
	for rows.Next() {
		var id string
		var price int
		if err := rows.Scan(&id, &price); err != nil {
			return nil, fmt.Errorf("products: scan price: %w", err)
		}
		out[id] = price
	}

	return out, rows.Err()
}

// RandomProductIDs returns up to n distinct product ids chosen at random,
// for POST /api/dev/simulate. ORDER BY random() is fine at this catalog's
// size (dozens of rows) — it wouldn't be the right choice on a large table,
// but there's no need for anything fancier here.
func (r *Repository) RandomProductIDs(ctx context.Context, n int) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id FROM products ORDER BY random() LIMIT $1`, n)
	if err != nil {
		return nil, fmt.Errorf("products: random ids: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("products: scan random id: %w", err)
		}
		ids = append(ids, id)
	}

	return ids, rows.Err()
}

// GetProduct fetches a single product by id, for the substitution flow,
// which needs the short item's own category and price to go looking for
// candidates.
func (r *Repository) GetProduct(ctx context.Context, id string) (*Product, error) {
	var p Product
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, category, price_paise FROM products WHERE id = $1`, id,
	).Scan(&p.ID, &p.Name, &p.Category, &p.PricePaise)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("products: get: %w", err)
	}
	return &p, nil
}

// SubstituteCandidate is one replacement option offered for a short item.
type SubstituteCandidate struct {
	ProductID  string `json:"productId"`
	Name       string `json:"name"`
	PricePaise int    `json:"pricePaise"`
}

// SubstituteCandidates finds up to limit same-category products, priced
// within ±30% of targetPricePaise, with at least minAvailable units in
// stock, sorted by closest price match — per the spec's substitution rules.
func (r *Repository) SubstituteCandidates(
	ctx context.Context, category, excludeProductID string, minAvailable, targetPricePaise, limit int,
) ([]SubstituteCandidate, error) {
	low := int(float64(targetPricePaise) * 0.7)
	high := int(math.Ceil(float64(targetPricePaise) * 1.3))

	rows, err := r.pool.Query(ctx, `
		SELECT p.id, p.name, p.price_paise
		FROM products p
		JOIN stock s ON s.product_id = p.id
		WHERE p.category = $1
		  AND p.id != $2
		  AND s.available >= $3
		  AND p.price_paise BETWEEN $4 AND $5
		ORDER BY ABS(p.price_paise - $6)
		LIMIT $7`,
		category, excludeProductID, minAvailable, low, high, targetPricePaise, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("products: substitute candidates: %w", err)
	}
	defer rows.Close()

	var candidates []SubstituteCandidate
	for rows.Next() {
		var c SubstituteCandidate
		if err := rows.Scan(&c.ProductID, &c.Name, &c.PricePaise); err != nil {
			return nil, fmt.Errorf("products: scan candidate: %w", err)
		}
		candidates = append(candidates, c)
	}

	return candidates, rows.Err()
}

type Handler struct {
	repo *Repository
}

func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// List responds with the full catalog, tagged with an ETag derived from its
// contents. The catalog only changes when someone reseeds the database, so in
// practice the frontend's 5-minute staleTime combined with this ETag means
// the body is rarely re-sent.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	list, err := h.repo.List(r.Context())
	if err != nil {
		log.Printf("products: list: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "INTERNAL", "something went wrong", nil)
		return
	}

	body, err := json.Marshal(list)
	if err != nil {
		log.Printf("products: marshal: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "INTERNAL", "something went wrong", nil)
		return
	}

	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:]) + `"`

	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
