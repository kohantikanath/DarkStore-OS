// Package httpx holds the small set of HTTP helpers every handler package
// shares: one JSON response shape, one error shape, and CORS.
package httpx

import (
	"encoding/json"
	"log"
	"net/http"
)

// AppError is the one error shape every endpoint returns, per the spec:
// { "error": "CODE", "message": "...", "details": {} }.
type AppError struct {
	Code    string `json:"error"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

// WriteJSON writes v as a JSON body with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("httpx: encode response: %v", err)
	}
}

// WriteError writes the standard error envelope. details may be nil.
func WriteError(w http.ResponseWriter, status int, code, message string, details any) {
	WriteJSON(w, status, AppError{Code: code, Message: message, Details: details})
}
