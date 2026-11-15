// Package ws is the WebSocket hub: clients subscribe to "ops" (every order
// event) or "order:<id>" (just that order), and the rest of the backend
// broadcasts full order snapshots to whichever clients asked for them.
package ws

import (
	"encoding/json"
	"log"
	"sync"
)

// Event is the one message shape sent to clients: a full order snapshot
// (including version, so the frontend can ignore stale/out-of-order events)
// tagged with why it was sent.
type Event struct {
	Type  string          `json:"type"` // "order.created" | "order.updated"
	Order json.RawMessage `json:"order"`
}

type client struct {
	send     chan []byte
	mu       sync.Mutex
	channels map[string]bool
}

func newClient() *client {
	return &client{send: make(chan []byte, 16), channels: make(map[string]bool)}
}

func (c *client) subscribe(channel string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.channels[channel] = true
}

func (c *client) isSubscribed(channel string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.channels[channel]
}

// Hub tracks connected clients and fans events out to the ones that asked
// for them. The zero value is not usable; construct with NewHub.
type Hub struct {
	mu      sync.Mutex
	clients map[*client]bool
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*client]bool)}
}

func (h *Hub) register(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = true
}

func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	_, ok := h.clients[c]
	delete(h.clients, c)
	h.mu.Unlock()

	if ok {
		close(c.send)
	}
}

// Broadcast sends order (marshaled to JSON) as an eventType event to every
// client subscribed to "ops" or to "order:<orderID>".
//
// Note for production: a real deployment must verify the customer actually
// owns orderID before letting them subscribe to its channel — this demo
// trusts the channel name as-is, since there's no real auth (see README).
func (h *Hub) Broadcast(orderID, eventType string, order any) {
	orderJSON, err := json.Marshal(order)
	if err != nil {
		log.Printf("ws: marshal order for broadcast: %v", err)
		return
	}

	payload, err := json.Marshal(Event{Type: eventType, Order: orderJSON})
	if err != nil {
		log.Printf("ws: marshal event: %v", err)
		return
	}

	orderChannel := "order:" + orderID

	h.mu.Lock()
	defer h.mu.Unlock()

	for c := range h.clients {
		if !c.isSubscribed("ops") && !c.isSubscribed(orderChannel) {
			continue
		}

		select {
		case c.send <- payload:
		default:
			// Slow/stuck client: drop it rather than block every other
			// client's broadcast on one unresponsive connection.
			go h.unregister(c)
		}
	}
}
