package orders

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kohantikanath/darkstore-os/backend/internal/httpx"
	"github.com/kohantikanath/darkstore-os/backend/internal/idempotency"
)

type Handler struct {
	pool    *pgxpool.Pool
	repo    *Repository
	service *Service
}

func NewHandler(pool *pgxpool.Pool, repo *Repository, service *Service) *Handler {
	return &Handler{pool: pool, repo: repo, service: service}
}

// Create handles POST /api/orders. The Idempotency-Key header is mandatory:
// if a request with the same key already completed, its original response is
// replayed verbatim instead of creating a second order.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	idempotencyKey := r.Header.Get("Idempotency-Key")
	if idempotencyKey == "" {
		httpx.WriteError(w, http.StatusBadRequest, "IDEMPOTENCY_KEY_REQUIRED",
			"the Idempotency-Key header is required", nil)
		return
	}

	stored, err := idempotency.Lookup(r.Context(), h.pool, idempotencyKey)
	if err != nil {
		log.Printf("orders: idempotency lookup: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "INTERNAL", "something went wrong", nil)
		return
	}
	if stored != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(stored.Status)
		_, _ = w.Write(stored.Body)
		return
	}

	var req CreateOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "body must be valid JSON", nil)
		return
	}
	if err := req.Validate(); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}

	order, err := h.service.CreateOrder(r.Context(), idempotencyKey, req.Items)
	if err != nil {
		var unknownErr *UnknownProductError
		var stockErr *InsufficientStockError
		switch {
		case errors.As(err, &unknownErr):
			httpx.WriteError(w, http.StatusBadRequest, "UNKNOWN_PRODUCT",
				"one or more products do not exist", unknownErr.ProductIDs)
		case errors.As(err, &stockErr):
			httpx.WriteError(w, http.StatusConflict, "INSUFFICIENT_STOCK",
				"not enough stock for one or more items", stockErr.Items)
		default:
			log.Printf("orders: create: %v", err)
			httpx.WriteError(w, http.StatusInternalServerError, "INTERNAL", "something went wrong", nil)
		}
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, order)
}

// List handles GET /api/orders — lightweight summaries for the ops table.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	summaries, err := h.repo.ListSummaries(r.Context())
	if err != nil {
		log.Printf("orders: list: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "INTERNAL", "something went wrong", nil)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, summaries)
}

// Get handles GET /api/orders/{id} — the full order with its items.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	order, err := h.repo.GetOrder(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httpx.WriteError(w, http.StatusNotFound, "ORDER_NOT_FOUND", "no order with that id", nil)
		return
	}
	if err != nil {
		log.Printf("orders: get: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "INTERNAL", "something went wrong", nil)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, order)
}
