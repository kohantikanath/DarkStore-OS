# DarkStore OS

**A real-time fulfillment platform for a Zepto-style dark store, with one headline
feature: when a picker finds an item out of stock mid-order, the customer gets a live
popup — with a real countdown — to pick a replacement before it's auto-refunded.**

🔗 **[Try it live](https://darkstore-os.netlify.app)** — backend is on Render's free
tier, so the first load can take up to a minute to wake up.

| Shop — substitution bottom sheet | Picker — marking an item short | Ops — a live "awaiting substitution" row |
|:---:|:---:|:---:|
| ![Customer order tracker with the live substitution bottom sheet open, showing a 28-second countdown and two replacement options](docs/screenshots/shop-substitution.jpg) | ![Picker order detail with one item awaiting the customer, highlighted with a yellow left edge and a live countdown, and two more items with a red-outlined Short button](docs/screenshots/picker.jpg) | ![Store Manager ops table with a live count on the Awaiting substitution filter chip and a yellow-edged row for the order currently awaiting a decision](docs/screenshots/ops.jpg) |

**What's technically interesting here:**

- **Live Substitution, live for real** — a picker marking one item short triggers a
  60-second countdown on the customer's screen and an automatic refund on timeout,
  synced across three independently role-switched views with no polling, derived
  entirely from order state (so it survives a page refresh mid-countdown).
- **Atomic stock reservation with no read-then-write race** — every reservation is one
  conditional `UPDATE ... WHERE available >= $1`, checked by rows-affected, inside the
  same transaction as the idempotency record, so a crash or a duplicate request can
  never double-reserve or silently drop stock.
- **The whole app also runs with zero backend.** A build-time flag swaps every REST
  call and WebSocket message for MSW + `BroadcastChannel`, with not one React
  component aware of the difference — verified by diffing the production bundle with
  the flag on and off.
- **A 10,000-row live table that stays smooth**, via windowed virtualization plus
  targeted, version-gated cache patches instead of a full refetch on every change — a
  late or out-of-order event can never silently overwrite a newer state.

A mini fulfillment platform modeling a Zepto-style dark store (a small warehouse that only
packs online orders), with three real-time connected views — customer, picker, and store
manager — built around that one headline feature: **Live Substitution**.

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

```mermaid
flowchart LR
    subgraph Browser["Browser — 3 roles, 1 SPA"]
        Customer["Customer\n/shop"]
        Picker["Picker\n/picker"]
        Manager["Store Manager\n/ops"]
    end

    Adapters["lib/api.ts (REST)\nlib/realtime.ts (live events)"]
    Customer --> Adapters
    Picker --> Adapters
    Manager --> Adapters

    Adapters -- "HTTPS" --> API["Go API (chi)\nRender"]
    Adapters <-- "WSS, patches\nTanStack Query cache" --> WS["WebSocket hub\n(same Go process)"]

    API --> PG[("Postgres\nNeon")]
    WS --> PG
    Ticker["2s expiry ticker\n(goroutine)"] -- "refund overdue\nAWAITING_SUBSTITUTE items" --> PG
    Ticker --> WS

    API -- "every committed\nchange" --> WS

    style Browser fill:#eef2ff,stroke:#6366f1
```

Three React Router–lazy-loaded views share one TanStack Query cache and one
live-events connection. REST calls and WebSocket messages each go through
exactly one file (`lib/api.ts` for REST, `lib/realtime.ts` for live events), so no
component ever touches `fetch` or `WebSocket` directly. Every state-changing
API call commits to Postgres first, then broadcasts the fresh order over the
WebSocket hub to every subscribed tab — including the one that made the
change, so a picker marking an item short sees the same update their own
customer-role tab would. The 2-second ticker is a background goroutine in
the same process, not a separate service: it exists only to catch
substitution deadlines nobody's request happens to cross.

In **mock mode** (`VITE_USE_MOCK=true`), `API`/`WS`/`Postgres` are
replaced client-side by MSW + an in-memory store + `BroadcastChannel` — same
diagram shape, same adapter boundary, zero servers. See "Mock mode" under
Key decisions below for the one behavioral difference that comes with that.

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
  service layer is the only thing that will ever write to these
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
- **Mock mode is a build-time-only toggle, not a runtime one.** `VITE_USE_MOCK`
  is read via `import.meta.env`, so Vite inlines it as a literal at build
  time; when it's `false`/unset, Rollup's dead-code elimination drops the
  entire mock branch, including the dynamic `import("./mocks/browser")` and
  MSW itself. Verified directly: a normal `npm run build` produces one
  388.28kB main bundle with no extra chunk; building with
  `VITE_USE_MOCK=true` instead produces a separate ~408KB chunk for the mock
  code. A real deployment never ships MSW by accident.
- **`mocks/db.ts` is a from-scratch, simplified reimplementation of the
  backend's rules, not a shared library with it.** Same state machine,
  same ±30%/same-category substitute selection, same atomic-enough stock
  bookkeeping — but in plain in-memory `Map`s with no transactions, because
  there's no concurrency to guard against inside one JS thread. Keeping
  frontend and backend logic genuinely independent (vs., say, compiling the
  Go rules to WASM) was the simpler choice for a demo-only mock backend.
- **Each browser tab's mock "backend" is its own isolated instance** — the
  `orders` Map in `mocks/db.ts` is module-level state, and every tab/document
  loads a fresh copy. BroadcastChannel is one shared event bus across tabs,
  but it carries *events*, not a shared database: a tab can only mutate
  (pick, mark short, substitute) an order it created or was seeded with
  itself. Found this directly while testing the live-substitution demo
  across two tabs — a second tab opened straight to a picker's order detail
  page 404's, because that tab's own mock "backend" never heard of that
  order. The real fix for *testing* this is to perform the mutating action
  (e.g. "mark short") in the tab that owns the order, then watch a second,
  merely-observing tab receive the live update — which is also exactly how
  a real multi-device demo would look once a real backend is involved.
- **`broadcastMockEvent` applies its own event locally, not just to other
  tabs.** `BroadcastChannel.postMessage` never delivers a message back to
  its own sender (unlike a real WebSocket, where the server has no reason to
  exclude the connection that triggered the change from its own broadcast).
  The mutation hooks (`useMarkItemShort`, etc.) only optimistically guess at
  the next state in `onMutate` — they can't know `substituteOptions` ahead of
  time, since the server/mock backend picks the candidates — so without this,
  the *acting* tab's own order-detail view and ops list would simply never
  learn the real outcome unless some other tab happened to be open to
  broadcast it back. Found this by testing solo in one tab (switching
  customer → picker → customer to drive the whole flow alone, the way
  someone demoing this project unassisted actually would): the substitution
  popup silently never appeared, and the ops table kept showing a stale
  status/version for the order that tab itself had just changed, even
  though the real backend-equivalent data was correct all along. Patching
  locally — the same `applyEvent` a receiving tab runs — fixes both.
- **The ops table's loading/empty states, and the Simulate button's
  failures, needed a second look.** An audit against this project's own
  data-screen convention ("every data screen: loading skeleton, error
  retry, empty state") found three real gaps: the ops page's loading state
  was plain text, not a
  skeleton like every other data screen; "no orders" and "no orders *match
  your filter*" showed the identical message, which is misleading the first
  time anyone opens `/ops` before placing any demo orders; and a failed
  `simulateOrder()` call was only ever `console.error`'d, silently leaving
  the "Stop simulating" button showing while nothing was actually happening
  anymore. Fixed by adding a real skeleton, splitting the empty-state
  message on whether `orders.data` itself is empty vs. just the filtered
  view, and surfacing the failure as a message plus turning simulating off.
- **The real frontend was deployed to the same Netlify site as the original
  throwaway `hello/` deploy-check page, renamed rather than left as two
  sites.** Netlify
  lets a site's subdomain be changed independently of its project — so
  `darkstore-os-hello` became `darkstore-os`, with `frontend/netlify.toml`
  (not `hello/netlify.toml`) now driving its build, and `ALLOWED_ORIGIN` on
  the Render backend updated to match. One free-tier project to manage
  instead of an orphaned "hello" site sitting next to the real one forever.

- **`IsDueForExpiry` is a small pure function in `statemachine.go`, pulled
  out of `refundExpiredItem`** — same reasoning as
  `lib/cache.ts` on the frontend: the one piece of this project's spec that
  explicitly calls for a unit test ("Go unit tests for the state machine and
  substitution expiry") needs something pure to test against. `Service`
  itself is wired directly to a real `*pgxpool.Pool`, with no repository
  interface to fake, so testing the *decision* — is this item's deadline
  actually passed, given its last-known status — separately from the
  transaction/locking code that re-checks it is simpler than introducing a
  mock database layer just for this one function.
- **Every optimistic mutation now writes the server's response straight into
  the cache on success**, not just the picker/customer mutations' own
  `onMutate` guess. A docstring on `useMarkItemShort` used to claim this
  already happened — it didn't; the response was silently discarded, and
  `substituteOptions` (which the client can't guess, since the server picks
  the candidates) only ever arrived if a WebSocket event happened to show up
  later. `onSuccess` now merges the real response in immediately via the
  same version-gated `mergeOrder` the WebSocket path uses, so the UI is
  correct the instant the request resolves, with the live event arriving
  after as a no-op confirmation rather than the only source of truth.
- **Rollback-on-error is version-aware, not an unconditional restore.** An
  optimistic update's `onMutate` never bumps `version` — only a real server
  response does — so if a mutation fails *after* some other authoritative
  update already landed (a WebSocket event, another mutation's response),
  the cached order's version will have moved past the pre-mutation
  snapshot's. Naively restoring that snapshot on error would silently erase
  the newer state. `rollbackOrder` (`lib/cache.ts`) checks the version
  first and only restores when nothing newer is known to have arrived.
- **`SubstitutionModal` generates its `Idempotency-Key` once per offer**
  (`useMemo` keyed on `item.id`/`item.expiresAt`), not fresh on every click.
  A key generated per click defeats its own purpose: a double click or a
  retry after a transient failure would get two different keys, so the
  server would see two distinct requests instead of recognizing a retry —
  exactly the duplicate-processing idempotency keys exist to prevent. One
  key per offer means every click attempting to resolve the *same* offer is
  treated as the same logical action.
- **`SubstitutionModal` has real dialog semantics**: `role="dialog"`,
  `aria-modal`, `aria-labelledby` pointing at its heading, focus moved into
  it the instant it mounts, and `aria-live="polite"` on the countdown text.
  Without these, a screen reader user gets no indication a 60-second,
  money-affecting decision just appeared on screen at all — this is exactly
  the kind of modal (unprompted, time-limited, financially consequential)
  where that gap matters most.
- **`OrderSummary` carries a derived `awaitingSubstitution` boolean, not the
  order's full items array.** The ops table needs to highlight a row with
  an item awaiting a decision, but pulling the whole `items` array into
  every one of 10,000+ summary rows just to answer one yes/no question
  would bloat `GET /api/orders` for no reason — the flag is computed once
  in `ListSummaries`' SQL (`bool_or` over the same `order_items` join the
  query already does for `item_count`, not a second correlated subquery —
  confirmed via `EXPLAIN ANALYZE` at the full 10,000-row scale: ~12ms,
  identical shape of plan to before the column was added) and mirrored
  on the frontend by `orderToSummary` (`lib/cache.ts`) for orders arriving
  live over the WebSocket, so both paths agree on what the flag means.

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

### Database

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

### Backend API

```bash
cd backend
cp .env.example .env   # then edit if your ports differ
export $(cat .env | xargs)
go run ./cmd/server    # listens on :8080 by default
```

```bash
gofmt -l .    # should print nothing
go vet ./...
go test ./... # state machine + substitution-expiry logic (internal/orders)
```

Try it:

```bash
curl http://localhost:8080/api/health
curl http://localhost:8080/api/products
```

Creating an order needs an `Idempotency-Key` header (any unique string —
the frontend generates one with `crypto.randomUUID()`):

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

`short`/`substitute` (the Live Substitution flow) also exist —
`POST /api/orders/<id>/items/<itemId>/short` and `.../substitute` — easiest
to exercise from the frontend below, since picking good candidate products
by hand needs the seeded catalog's category/price data in front of you.

### Frontend

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

### Mock mode — no backend needed

The whole app also runs with zero Go server and zero Postgres, for
demoing the project from a static-hosted frontend alone:

```bash
cd frontend
cp .env.example .env.development.local
# then set VITE_USE_MOCK=true in .env.development.local (gitignored —
# local-only, so this never affects a real build or deploy)
npm run dev
```

MSW intercepts every `/api/*` call at the network layer and answers from an
in-memory mock "backend" (`src/mocks/db.ts`, `src/mocks/handlers.ts`) seeded
with the same 40-product catalog and 10,000 historical orders; a
`BroadcastChannel` stands in for the WebSocket, so the live substitution
popup, the ops table, and cross-role updates all still work — open two
tabs with different roles (**Picker** in one, **Customer** in the other) to
watch it live, same as the real-backend walkthrough above. One thing to
know: each tab's mock backend is its own isolated copy (see "Key decisions"
above) — a mutation like "mark short" or "choose a substitute" has to
happen in the tab that actually owns that order; a second tab can only
*watch* it update live, not act on it, until the real backend replaces the
mock one.

To build the production bundle in mock mode instead of running the dev
server (e.g. to sanity-check it ships correctly isolated from a normal
build):

```bash
VITE_USE_MOCK=true npm run build    # adds a separate ~408KB chunk for MSW + the mock backend
npm run build                       # normal build — no mock code in the bundle at all
```

## Live links

- **Frontend**: https://darkstore-os.netlify.app — the real app
  ([frontend/netlify.toml](frontend/netlify.toml))
- **Backend**: https://darkstore-os-backend.onrender.com ([render.yaml](render.yaml))
- **Database**: Neon (Postgres), Singapore region

> First load can take up to a minute — Render's free tier spins the backend
> down when idle, and the app shows a "Waking up the server…" state while it
> comes back.

> **Why Netlify, not Vercel**: the original plan was Vercel throughout, but
> the Vercel account hit a 2FA account-recovery flow early on that only
> Vercel support can resolve, with no ETA. Netlify is a like-for-like
> replacement (same free tier, same build-command/env-var model). The
> original `hello/` deploy-check page and the real frontend above were the
> same Netlify project — it was renamed (`darkstore-os-hello` →
> `darkstore-os`) and redeployed with the real app once it was built, rather
> than standing up a second site.

## Project docs

- [Full project spec](docs/project-spec.md)
- [CLAUDE.md](CLAUDE.md) — quick-reference for stack and frontend/backend rules
- [Demo video script](docs/demo-script.md) — shot-by-shot script for a ~3-minute walkthrough
