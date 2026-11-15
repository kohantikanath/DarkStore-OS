// Package products serves the catalog. It deliberately does not expose live
// stock numbers (see Handler.List) so the response stays stable enough for
// the ETag/staleTime caching the frontend relies on.
package products

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kohantikanath/darkstore-os/backend/internal/httpx"
)

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
