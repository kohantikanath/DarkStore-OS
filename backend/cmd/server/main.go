// Command server runs the DarkStore OS REST API.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kohantikanath/darkstore-os/backend/internal/db"
	"github.com/kohantikanath/darkstore-os/backend/internal/httpx"
	"github.com/kohantikanath/darkstore-os/backend/internal/orders"
	"github.com/kohantikanath/darkstore-os/backend/internal/products"
)

func main() {
	connString := requireEnv("DATABASE_URL")
	allowedOrigin := requireEnv("ALLOWED_ORIGIN")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx := context.Background()

	pool, err := db.New(ctx, connString)
	if err != nil {
		log.Fatalf("server: %v", err)
	}
	defer pool.Close()

	router := buildRouter(pool, allowedOrigin)

	log.Printf("server: listening on :%s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func buildRouter(pool *pgxpool.Pool, allowedOrigin string) http.Handler {
	productsRepo := products.NewRepository(pool)
	productsHandler := products.NewHandler(productsRepo)

	ordersRepo := orders.NewRepository(pool)
	ordersService := orders.NewService(pool, ordersRepo, productsRepo)
	ordersHandler := orders.NewHandler(pool, ordersRepo, ordersService)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(httpx.CORS(allowedOrigin))

	r.Get("/api/health", healthHandler(pool))
	r.Get("/api/products", productsHandler.List)
	r.Post("/api/orders", ordersHandler.Create)
	r.Get("/api/orders", ordersHandler.List)
	r.Get("/api/orders/{id}", ordersHandler.Get)

	return r
}

// healthHandler pings the database so Render/Neon cold starts and real
// outages both show up as a non-200 instead of a false "ok".
func healthHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := pool.Ping(ctx); err != nil {
			httpx.WriteError(w, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database is not reachable", nil)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("server: %s is required", key)
	}
	return v
}
