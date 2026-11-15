# DarkStore OS

> Status: Phase 4 — deployed to production (Render + Neon + a deploy-check
> page) and verified end-to-end. No substitution flow yet (Phase 8), no real
> frontend yet (Phase 5+).

A mini fulfillment platform modeling a Zepto-style dark store (a small warehouse that only
packs online orders), with three real-time connected views — customer, picker, and store
manager — built around one headline feature: **Live Substitution**.

## The problem

Zepto-style quick-commerce promises ~10-minute delivery. Inside the dark store, a picker
collects items for each order. When an item is missing from the shelf, basic systems
silently drop it and the customer only finds out at the door — causing refunds,
complaints, and bad ratings.

## The feature: Live Substitution

1. A picker marks an item **short**.
2. The backend finds up to 2 same-category replacements within ±30% of the price,
   reserves stock for them, and puts the item into `AWAITING_SUBSTITUTE` with a
   60-second deadline.
3. The customer sees a live popup with a countdown to pick a replacement.
4. The choice (or the 60-second timeout, which triggers an automatic refund) is reflected
   instantly on the picker and manager screens.

## Architecture

_Diagram and walkthrough added once the backend and frontend are built (Phases 2–8)._

## Tech stack

| Layer     | Choices                                                                 |
|-----------|--------------------------------------------------------------------------|
| Backend   | Go, chi, pgx, gorilla/websocket, goose                                   |
| Database  | PostgreSQL 16 (Docker locally, Neon in production)                       |
| Frontend  | React + TypeScript (strict), Vite, React Router, Tailwind CSS            |
| State     | TanStack Query (server state), Zustand (client state), TanStack Virtual  |
| Validation| Zod                                                                      |
| Mock mode | MSW + BroadcastChannel                                                   |
| Tests     | Go `testing`, Vitest                                                     |
| Hosting   | Vercel (frontend), Render (backend), Neon (database) — free tiers        |

## Key decisions and trade-offs

- **UUID primary keys**, generated via Postgres's `gen_random_uuid()` (pgcrypto).
  Order/product IDs are exposed in URLs and WebSocket payloads, so sequential
  integers would leak how many orders exist and let one order's ID be guessed
  from another's.
- **`version` bump is application logic, not a DB trigger.** A trigger would
  guarantee the invariant even against a stray manual `UPDATE`, but the Go
  service layer (Phase 2/3) is the only thing that will ever write to these
  tables, so a trigger would just be indirection with no real benefit here.
- **Seed data uses `COPY` (bulk load), not one `INSERT` per row.** Seeding
  10,000 orders with individual inserts would mean 10,000+ round trips to
  Postgres; `COPY` streams all rows in one pass and runs in ~1 second.
- **Seed data is deterministic** (`rand.NewSource(42)`), so re-running `go run
  ./cmd/seed` always produces the same demo dataset — useful when debugging
  something that shows up in the ops table.
- **`GET /api/products` excludes live stock numbers.** Stock changes on every
  order; if the catalog response included it, the ETag would change
  constantly and the frontend's 5-minute `staleTime` would be pointless.
  Out-of-stock is instead surfaced as a `409 INSUFFICIENT_STOCK` at checkout.
- **`GET /api/orders` returns the full list with no pagination.** At this
  project's scale, one request is simpler than cursor pagination, and the
  frontend's design (fetch once, patch via WebSocket, `staleTime: Infinity`)
  assumes the whole list lives in one cache entry anyway. A production system
  with millions of orders would need real pagination here.
- **Idempotency is check-then-act, not DB-locked.** Two requests sharing a
  brand-new key at the exact same instant could in theory both pass the
  lookup and both create an order — true safety would need a unique-insert-
  first pattern or a row lock. Not worth the complexity here since the
  frontend only ever issues one request per generated key.
- **No "mark item picked" endpoint.** The item state machine allows
  `PENDING → PICKED`, but the only item-level action a picker takes is
  marking something *short* — everything else is implicitly picked. So
  `pack` bulk-finalizes any still-`PENDING` items to `PICKED` in the same
  transaction as the order's own `PICKING → PACKED` move, instead of making
  the picker confirm each item individually.
- **`TransitionOrderStatus` reads the current status with `SELECT ... FOR
  UPDATE` before deciding**, rather than relying purely on a conditional
  `UPDATE`'s rows-affected count (like stock reservation does). The
  difference: a failed stock reservation only ever means "not enough stock,"
  but a failed transition could mean either "order doesn't exist" (404) or
  "order exists but is in the wrong state" (409) — a plain conditional UPDATE
  can't tell those apart, so this needs the extra read.
- **Broadcasting happens in the service layer, right after `tx.Commit`
  succeeds** — not in the HTTP handler. That keeps "change the order" and
  "tell everyone it changed" atomic from the caller's point of view: every
  successful API response implies a broadcast already went out (or is about
  to), and a handler can't forget to wire one up for a new transition.
- **Migrations run embedded in the server binary at startup, not via
  Render's `preDeployCommand`.** That hook is a paid-plan feature; embedding
  the SQL files (`migrations/embed.go`) and applying them with goose's
  library API (`internal/migrate`) before the server starts listening works
  on every plan and makes local `go run ./cmd/server` behave identically to
  the deployed one.

## Known limitations / out of scope

Payments, maps, rider tracking, real authentication, a finance module, Redis, and offline
mode are intentionally out of scope for this build. Noted here as future improvements,
not oversights.

**WebSocket channel authorization**: `/ws` lets any client subscribe to
`order:<id>` for any ID it already knows, with no check that the connecting
customer actually owns that order. That's acceptable for a demo with fake
login, but a real deployment must verify ownership (e.g. from a session
token) before allowing the subscription.

## Running locally

### Database (Phase 1)

```bash
docker compose up -d        # starts Postgres 16 on localhost:55432
```

> Host port `5432` is often already taken by another local Postgres, so this
> project maps to `55432` on the host instead (the container itself still
> listens on `5432`). Adjust the port in `docker-compose.yml` if `55432` is
> also taken on your machine.

```bash
export DATABASE_URL="postgres://darkstore:darkstore@localhost:55432/darkstore?sslmode=disable"

# apply migrations
cd backend
go run github.com/pressly/goose/v3/cmd/goose@v3.30.1 -dir migrations postgres "$DATABASE_URL" up

# wipe + seed demo data (40 products, ~10,000 historical orders)
go run ./cmd/seed
```

### Backend API (Phase 2)

```bash
cd backend
cp .env.example .env   # then edit if your ports differ
export $(cat .env | xargs)
go run ./cmd/server    # listens on :8080 by default
```

Try it:

```bash
curl http://localhost:8080/api/health
curl http://localhost:8080/api/products
```

Creating an order needs an `Idempotency-Key` header (any unique string —
the frontend will generate one with `crypto.randomUUID()` starting Phase 6):

```bash
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"items":[{"productId":"<a product id from /api/products>","qty":1}]}'
```

The order now moves through its full lifecycle, broadcasting every change
over `/ws`:

```bash
curl -X POST http://localhost:8080/api/orders/<id>/start-picking
curl -X POST http://localhost:8080/api/orders/<id>/pack
curl -X POST http://localhost:8080/api/orders/<id>/dispatch
```

Watch the live events (needs a WebSocket client — `wscat`, or the snippet
below with Python's `websocket-client`):

```bash
# wscat -c ws://localhost:8080/ws
# then send: {"type":"subscribe","channel":"ops"}
```

`short`/`substitute` (the Live Substitution flow) and the frontend are still
ahead — Phase 8 and Phase 5+ respectively.

## Live links

- Backend: https://darkstore-os-backend.onrender.com ([render.yaml](render.yaml))
- Database: Neon (Postgres), Singapore region
- Deploy-check page: https://darkstore-os-hello.netlify.app — the throwaway
  `hello/` page from Phase 4 (see below), not the real frontend
- Real frontend: _TBD (Phase 5+, on Vercel per the original plan — see note
  below)_

> **Why Netlify instead of Vercel for the Phase 4 check**: the plan was
> Vercel throughout, but the Vercel account hit a 2FA account-recovery flow
> mid-Phase-4 that only Vercel support can resolve, with no ETA. Netlify is a
> like-for-like substitute (same free tier, same build-command/env-var
> model) used here only to prove the Render/Neon backend and its CORS/`wss://`
> wiring work end-to-end in production without that being blocked. The real
> frontend in Phase 5+ still goes to Vercel once account access is back,
> matching the original stack choice.

## Project docs

- [Full project spec](docs/project-spec.md)
- [CLAUDE.md](CLAUDE.md) — quick-reference for stack and frontend/backend rules
