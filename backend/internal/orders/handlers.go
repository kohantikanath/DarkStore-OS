package orders

import (
	"context"
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

// Simulate handles POST /api/dev/simulate — creates one order from random
// catalog items, so a demo's ops table has something happening on its own.
// No Idempotency-Key: each call is its own, intentionally-new random order.
func (h *Handler) Simulate(w http.ResponseWriter, r *http.Request) {
	order, err := h.service.SimulateOrder(r.Context())
	if err != nil {
		var stockErr *InsufficientStockError
		switch {
		case errors.As(err, &stockErr):
			httpx.WriteError(w, http.StatusConflict, "INSUFFICIENT_STOCK",
				"not enough stock for one or more items", stockErr.Items)
		default:
			log.Printf("orders: simulate: %v", err)
			httpx.WriteError(w, http.StatusInternalServerError, "INTERNAL", "something went wrong", nil)
		}
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, order)
}

// MarkShort handles POST /api/orders/{id}/items/{itemId}/short.
func (h *Handler) MarkShort(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "itemId")

	var req ShortItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "body must be valid JSON", nil)
		return
	}
	if req.ShortQty < 1 {
		httpx.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "shortQty must be at least 1", nil)
		return
	}

	order, err := h.service.MarkItemShort(r.Context(), orderID, itemID, req.ShortQty)
	if err != nil {
		var transitionErr *TransitionError
		var validationErr *ValidationError
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.WriteError(w, http.StatusNotFound, "ORDER_NOT_FOUND", "no matching order/item", nil)
		case errors.As(err, &validationErr):
			httpx.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", validationErr.Error(), nil)
		case errors.As(err, &transitionErr):
			httpx.WriteError(w, http.StatusConflict, "INVALID_TRANSITION", transitionErr.Error(), nil)
		default:
			log.Printf("orders: mark short: %v", err)
			httpx.WriteError(w, http.StatusInternalServerError, "INTERNAL", "something went wrong", nil)
		}
		return
	}

	httpx.WriteJSON(w, http.StatusOK, order)
}

// ChooseSubstitute handles POST /api/orders/{id}/items/{itemId}/substitute.
// The Idempotency-Key header is mandatory, same as order creation.
func (h *Handler) ChooseSubstitute(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "id")
	itemID := chi.URLParam(r, "itemId")

	idempotencyKey := r.Header.Get("Idempotency-Key")
	if idempotencyKey == "" {
		httpx.WriteError(w, http.StatusBadRequest, "IDEMPOTENCY_KEY_REQUIRED",
			"the Idempotency-Key header is required", nil)
		return
	}

	var req SubstituteChoiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ProductID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "productId is required", nil)
		return
	}

	order, err := h.service.ChooseSubstitute(r.Context(), orderID, itemID, idempotencyKey, req.ProductID)
	if err != nil {
		var transitionErr *TransitionError
		var invalidChoiceErr *InvalidSubstituteChoiceError
		var expiredErr *ExpiredError
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.WriteError(w, http.StatusNotFound, "ORDER_NOT_FOUND", "no matching order/item", nil)
		case errors.As(err, &expiredErr):
			httpx.WriteError(w, http.StatusConflict, "EXPIRED", expiredErr.Error(), nil)
		case errors.As(err, &transitionErr):
			httpx.WriteError(w, http.StatusConflict, "INVALID_TRANSITION", transitionErr.Error(), nil)
		case errors.As(err, &invalidChoiceErr):
			httpx.WriteError(w, http.StatusBadRequest, "INVALID_SUBSTITUTE_CHOICE", invalidChoiceErr.Error(), nil)
		default:
			log.Printf("orders: choose substitute: %v", err)
			httpx.WriteError(w, http.StatusInternalServerError, "INTERNAL", "something went wrong", nil)
		}
		return
	}

	httpx.WriteJSON(w, http.StatusOK, order)
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

// StartPicking handles POST /api/orders/{id}/start-picking.
func (h *Handler) StartPicking(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, h.service.StartPicking)
}

// Pack handles POST /api/orders/{id}/pack.
func (h *Handler) Pack(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, h.service.Pack)
}

// Dispatch handles POST /api/orders/{id}/dispatch.
func (h *Handler) Dispatch(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, h.service.Dispatch)
}

// transition is shared by all three order-status endpoints: they only differ
// in which Service method moves the order forward.
func (h *Handler) transition(w http.ResponseWriter, r *http.Request, step func(ctx context.Context, id string) (*Order, error)) {
	id := chi.URLParam(r, "id")

	order, err := step(r.Context(), id)
	if err != nil {
		var transitionErr *TransitionError
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.WriteError(w, http.StatusNotFound, "ORDER_NOT_FOUND", "no order with that id", nil)
		case errors.As(err, &transitionErr):
			httpx.WriteError(w, http.StatusConflict, "INVALID_TRANSITION", transitionErr.Error(), nil)
		default:
			log.Printf("orders: transition: %v", err)
			httpx.WriteError(w, http.StatusInternalServerError, "INTERNAL", "something went wrong", nil)
		}
		return
	}

	httpx.WriteJSON(w, http.StatusOK, order)
}
