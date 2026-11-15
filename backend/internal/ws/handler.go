package ws

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
)

type subscribeMessage struct {
	Type    string `json:"type"`
	Channel string `json:"channel"`
}

var upgrader = websocket.Upgrader{
	// CORS already restricts which origin the frontend is served from; this
	// handler doesn't re-check it. A production deployment with multiple
	// possible origins would want a real CheckOrigin here.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Handler upgrades the connection and reads subscribe messages from it until
// it closes. It never writes anything itself — Hub.Broadcast does that via
// the client's send channel.
func (h *Hub) Handler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws: upgrade: %v", err)
		return
	}

	c := newClient()
	h.register(c)

	go writePump(conn, c)
	readPump(conn, c, h)
}

// readPump owns the connection's read side and only ever handles subscribe
// messages; anything else (and any read error, including a normal close) is
// treated as "this client is done."
func readPump(conn *websocket.Conn, c *client, h *Hub) {
	defer func() {
		h.unregister(c)
		_ = conn.Close()
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var msg subscribeMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if msg.Type == "subscribe" && msg.Channel != "" {
			c.subscribe(msg.Channel)
		}
	}
}

// writePump owns the connection's write side; it exits (and closes the
// connection) once c.send is closed by unregister.
func writePump(conn *websocket.Conn, c *client) {
	defer func() { _ = conn.Close() }()

	for payload := range c.send {
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			return
		}
	}
}
