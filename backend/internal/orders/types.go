package orders

import (
	"encoding/json"
	"errors"
	"time"
)

// CreateOrderItem is both the wire shape of one line in a create-order
// request and what the service works with internally — productId and qty
// are literally all a client is allowed to send; price always comes from the
// server's own catalog.
type CreateOrderItem struct {
	ProductID string `json:"productId"`
	Qty       int    `json:"qty"`
}

type CreateOrderRequest struct {
	Items []CreateOrderItem `json:"items"`
}

func (r CreateOrderRequest) Validate() error {
	if len(r.Items) == 0 {
		return errors.New("items must not be empty")
	}
	for _, item := range r.Items {
		if item.ProductID == "" {
			return errors.New("each item needs a productId")
		}
		if item.Qty <= 0 {
			return errors.New("each item's qty must be greater than 0")
		}
	}
	return nil
}

type OrderItem struct {
	ID                  string          `json:"id"`
	ProductID           string          `json:"productId"`
	Qty                 int             `json:"qty"`
	Status              string          `json:"status"`
	SubstituteProductID *string         `json:"substituteProductId,omitempty"`
	SubstituteOptions   json.RawMessage `json:"substituteOptions,omitempty"`
	ExpiresAt           *time.Time      `json:"expiresAt,omitempty"`
}

type Order struct {
	ID         string      `json:"id"`
	Status     string      `json:"status"`
	Version    int         `json:"version"`
	TotalPaise int         `json:"totalPaise"`
	CreatedAt  time.Time   `json:"createdAt"`
	UpdatedAt  time.Time   `json:"updatedAt"`
	Items      []OrderItem `json:"items"`
}

// OrderSummary is the lightweight shape listed for the ops table — no item
// array, so fetching all orders at once (query key ['orders'], staleTime
// Infinity) stays cheap even at 10,000+ rows.
type OrderSummary struct {
	ID         string    `json:"id"`
	Status     string    `json:"status"`
	Version    int       `json:"version"`
	TotalPaise int       `json:"totalPaise"`
	ItemCount  int       `json:"itemCount"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// StockShortfall describes one item that couldn't be fully reserved.
type StockShortfall struct {
	ProductID string `json:"productId"`
	Requested int    `json:"requested"`
	Available int    `json:"available"`
}

// UnknownProductError means a request referenced a productId that isn't in
// the catalog at all.
type UnknownProductError struct {
	ProductIDs []string
}

func (e *UnknownProductError) Error() string {
	return "unknown product id(s)"
}

// InsufficientStockError means every productId was valid but one or more
// didn't have enough stock available to reserve.
type InsufficientStockError struct {
	Items []StockShortfall
}

func (e *InsufficientStockError) Error() string {
	return "insufficient stock for one or more items"
}
