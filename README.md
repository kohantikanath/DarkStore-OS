# DarkStore OS

> Status: Phase 8 — **the full story.** `/picker` is real (start picking,
> mark an item short, pack, dispatch), and Live Substitution works
> end-to-end: short → a live popup with a real countdown on the customer's
> tracker → their choice (or an automatic refund on timeout) → reflected
> instantly across all three views. This is the complete feature set the
> project set out to build.

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
- **`lib/cart.ts` is pure, like `lib/cache.ts`** — `computeCartSummary`
  takes the products list and the cart's `productId -> qty` map and returns
  line items + totals, with no Zustand or React involved. Same reasoning
  as the WebSocket merge logic: the only part worth bugs hiding in is unit
  tested directly.
- **One fresh `Idempotency-Key` per checkout click**, generated right in the
  click handler rather than once per page load. TanStack Query mutations
  don't auto-retry by default, so one click is reliably one attempt — no
  need to track and reuse a key across retries that never happen.
- **`useConnectionStatus` reads the current status via a lazy `useState`
  initializer, not a hardcoded `"connecting"`.** Found this one by actually
  using the app: a component that mounts *after* the socket already
  connected (e.g. navigating to the order tracker once the app's been
  running a while) would otherwise show a permanently stuck "Connecting…"
  badge, since `onConnectionChange` only pushes future changes to new
  listeners — there was no way to ask "what's the status right now?" A
  `getConnectionStatus()` getter fixes that.
- **On WebSocket reconnect, `['orders']` and any open `['order', id]` are
  invalidated once** (not refetched blindly on every render) — since orders
  are never polled (`staleTime: Infinity`), a fresh fetch after reconnecting
  is the only way to be sure nothing was missed while disconnected.
- **`POST /api/dev/simulate` reuses `CreateOrder` with randomly picked
  items**, rather than writing a separate order-creation path. A simulated
  order goes through the exact same atomic stock reservation and live
  broadcast as a real one — there's no second code path to keep in sync, and
  demo orders behave identically to real ones everywhere downstream.
- **The ops table filters client-side**, not via a `?status=` query param.
  At 10,000 rows already held in memory (the whole point of `staleTime:
  Infinity` plus WebSocket patching), filtering in place is simpler and
  faster than a round trip, and keeps `GET /api/orders` a single, simple
  endpoint. A system with millions of orders would need server-side
  filtering here instead.
- **TanStack Virtual only renders rows near the viewport, not all 10,000.**
  Verified directly — scrolling 42% into the list still only produced ~22
  DOM nodes for the table body, same as scrolled to the top.
- **`shortQty` is accepted by the API (matching the spec), but the picker UI
  always sends the item's full qty.** `order_items` has one status per row,
  with no sub-row quantity split, so there's no way to represent "2 of 3
  units are short" without either adding a quantity-tracking column or
  splitting a line into multiple rows — both real options, but more schema
  than this project's scope calls for. Documented here as a deliberate
  simplification, not a gap I didn't notice.
- **A short item's original stock reservation is written off, not
  released** (`WriteOffReservation`: `reserved -= qty`, `available`
  untouched) — released stock (`available += qty`) would mean "this is
  sellable again," which isn't true for something that was just discovered
  missing from the shelf. A substitute candidate that's offered but not
  chosen *is* released (`ReleaseStock`), since that stock was never actually
  unavailable — it just wasn't picked.
- **Neither a chosen nor an expired substitution recomputes the order's
  `total_paise`.** The schema only stores a price per *order*, not per
  *order item* (prices are looked up from the catalog at order-creation
  time and summed once) — there's no per-line price to swap in for a
  substitute's different cost. Getting this right would mean storing
  `price_paise` on `order_items` too. Left as a known gap rather than
  silently rounding or guessing.
- **`GetOrderTx` exists alongside `GetOrder`, reading via a `pgx.Tx` instead
  of the pool.** Found via a real bug: `ChooseSubstitute` originally read
  the order back through the pool *before* committing its own transaction —
  which (correctly) can't see an in-flight transaction's uncommitted
  writes, so the response, the broadcast, and the saved idempotency record
  all echoed stale pre-substitution data even though the database write
  itself was correct. The actual data was always right; only what got
  returned and broadcast was wrong — caught by checking the database
  directly against what the API claimed.
- **The picker queue has a real scale mismatch with the seed data.** The
  10,000 seeded historical orders include thousands sitting in PLACED/
  PICKING forever (useful for the ops table's virtualization demo), and
  since the picker queue filters to exactly those two statuses, it shows
  all of them — not just genuinely live ones. A production version would
  need to scope "actionable" to something like "created recently" or a
  separate queue table; noted here rather than silently worked around.

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

### Frontend (Phase 5 foundation, Phase 6 /shop, Phase 7 /ops, Phase 8 /picker + substitution)

```bash
cd frontend
cp .env.example .env   # points at the local backend above by default
npm install
npm run dev             # http://localhost:5173
```

Pick **Customer** — fake login, persisted to `localStorage`, with route
guards that bounce you back to the role picker if you try a URL for a role
you're not in. `/shop` is real: browse the seeded catalog, add items (qty
steppers, grouped by category), place an order (one `Idempotency-Key` per
click), and land on a live order tracker. Drive the order through its
lifecycle from another terminal to watch the tracker update with no
refresh:

```bash
curl -X POST http://localhost:8080/api/orders/<id>/start-picking
curl -X POST http://localhost:8080/api/orders/<id>/pack
curl -X POST http://localhost:8080/api/orders/<id>/dispatch
```

Pick **Store Manager** instead (switch role, top right) for `/ops` — a live
table of every order, seeded with 10,000 rows so you can feel the
virtualization (only the rows near the viewport are ever in the DOM).
Filter by status, search by order id, and hit **Simulate** to have the
backend create a new random order every 3 seconds — watch it land at the
top of the table live, with no refresh.

Pick **Picker** for `/picker` — a queue of orders to work (open two browser
profiles, or two tabs with different roles, to see the full story at once):

1. Open an order, **Start picking**.
2. **Mark short** on an item — watch the *customer's* tracker (a different
   tab/role, same order) show the substitution popup **live**, with a real
   countdown.
3. Pick a replacement there — the picker's screen updates instantly too, no
   refresh either direction.
4. Back on the picker, **Pack** then **Dispatch** to finish the order.

To see the timeout path instead of choosing: mark an item short, then force
its deadline into the past and watch the 2-second ticker refund it live,
closing the popup on its own:

```bash
docker exec darkstore-os-postgres psql -U darkstore -d darkstore -c \
  "UPDATE order_items SET expires_at = now() - interval '5 seconds' WHERE id = '<itemId>';"
```

```bash
npm run lint    # ESLint
npm run test    # Vitest — lib/cache.ts's merge/version logic, lib/cart.ts's totals
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
