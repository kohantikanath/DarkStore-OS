# DarkStore OS

> Status: Phase 5 — frontend foundation (routing, role switcher, adapters,
> Zod schemas) is wired up and talking to the real backend. No real
> shop/ops/picker screens yet (Phases 6–8), no substitution flow yet
> (Phase 8).

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
| Hosting   | Netlify (frontend), Render (backend), Neon (database) — free tiers       |

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
- **The 30-second request timeout middleware only wraps the REST routes,
  not `/ws`.** Found this one the hard way: applying it globally meant Go
  tried to write a `504` to a WebSocket connection gorilla/websocket had
  already hijacked once it outlived 30 seconds, logging a harmless-looking
  but real `response.WriteHeader on hijacked connection` warning for every
  long-lived WS session. A chi route group now scopes the timeout to the
  `/api/*` handlers only.
- **TypeScript is pinned to 5.9.3, not the new 7.x compiler.** TypeScript 7
  (the Go-based rewrite) is current-stable by version number, but
  `typescript-eslint` doesn't support it yet (caps at `<6.1.0`) — using it
  would mean no type-aware linting. 5.9.3 is the newest version the rest of
  the toolchain actually works with.
- **`lib/cache.ts` is split out from `lib/realtime.ts`.** The WebSocket
  connection itself (reconnect/backoff, channel subscriptions) lives in
  `realtime.ts`; the version-check/merge logic that decides what a cache
  patch should look like is pulled into its own pure functions in
  `cache.ts`, specifically so it can be unit tested with plain objects —
  no mock WebSocket or real QueryClient needed.
- **`GET /api/products` does its own ETag/304 dance in `lib/api.ts`**, not
  left to the browser's HTTP cache. Explicitly setting `If-None-Match` and
  `cache: "no-cache"` forces a real revalidation round-trip (and lets the
  304 actually surface to JS) instead of the browser silently serving a
  cached 200 that might hide whether the server-side ETag logic is even
  working.
- **Role switcher persists to `localStorage` via Zustand's `persist`
  middleware** rather than, say, a URL param or session cookie — a picker
  mid-shift who refreshes the page shouldn't be bounced back to the role
  picker.

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

`short`/`substitute` (the Live Substitution flow) is still ahead — Phase 8.

### Frontend (Phase 5)

```bash
cd frontend
cp .env.example .env   # points at the local backend above by default
npm install
npm run dev             # http://localhost:5173
```

Pick a role (customer/picker/manager) — it's a fake login, persisted to
`localStorage`, with route guards that bounce you back to the role picker
if you try a URL for a role you're not in. Each role's screen is a
placeholder until its phase (6, 7, 8) builds the real thing; this phase is
about proving the routing, the adapters (`lib/api.ts`, `lib/realtime.ts`),
and the Zod-validated types all actually talk to the backend above.

```bash
npm run lint    # ESLint
npm run test    # Vitest — currently covers lib/cache.ts's merge/version logic
npm run build   # tsc -b && vite build
```

## Live links

- Backend: https://darkstore-os-backend.onrender.com ([render.yaml](render.yaml))
- Database: Neon (Postgres), Singapore region
- Deploy-check page: https://darkstore-os-hello.netlify.app — the throwaway
  `hello/` page from Phase 4 (see below), replaced by the real frontend in
  Phase 5+ (same Netlify project/host)
- Real frontend: _TBD (Phase 5+)_

> **Why Netlify, not Vercel**: the original plan was Vercel throughout, but
> the Vercel account hit a 2FA account-recovery flow mid-Phase-4 that only
> Vercel support can resolve, with no ETA. Netlify is a like-for-like
> replacement (same free tier, same build-command/env-var model), and the
> project has settled on it for the rest of the build rather than waiting
> on account recovery.

## Project docs

- [Full project spec](docs/project-spec.md)
- [CLAUDE.md](CLAUDE.md) — quick-reference for stack and frontend/backend rules
