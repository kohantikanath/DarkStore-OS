# DarkStore OS — Project Spec

This is the full project spec agreed at kickoff. It is the source of truth for scope,
architecture, and phase order. Do not start a phase without re-reading the relevant
section here.

## Who this is for
Portfolio project for a Software Development Engineer I role on Zepto's Fulfillment Web
team (React + TypeScript, with backend exposure in Go). The author must be able to explain
every line in interviews.

## Working agreement
- Work in phases. Do ONLY the phase asked for, then stop.
- Before writing code in each phase, show the plan and the list of files to be created.
- After each phase, provide: what was built, how to run and test it, the key decisions and
  why (with alternatives and trade-offs), and 3 questions to check understanding.
- Explain like a patient senior engineer, in simple English. Explain unfamiliar terms.
- Use best practices, but don't over-engineer. Prefer simple, readable code.

## Project name
- Name: DarkStore OS
- Repo / folder name: darkstore-os

## The business problem
Zepto promises ~10-minute delivery. Inside a dark store (a small warehouse that only packs
online orders), a picker collects items for each order. When an item is missing from the
shelf, basic systems silently drop it and the customer finds out at the door. This causes
refunds, complaints, and bad ratings.

## The solution and the headline feature: Live Substitution
A mini fulfillment platform with three views connected in real time:
- Customer (`/shop`): browse products, place an order, track it live.
- Picker (`/picker`): see orders, pick items, mark an item "short".
- Store manager (`/ops`): live queue of all orders in the store.

When a picker marks an item short:
1. The backend picks up to 2 replacement products, reserves stock for them, sets the item
   to `AWAITING_SUBSTITUTE` with an `expiresAt` timestamp 60 seconds in the future.
2. The customer instantly gets a popup with a countdown to choose a replacement.
3. The choice reaches the picker and manager screens instantly.
4. If the customer doesn't answer in 60 seconds, the backend refunds that item line
   automatically, releases the replacement reservations, and picking continues.

## Scope for this build
IN scope: everything above, role switcher (fake login), seeded data, deploy.
OUT of scope: payments, maps, rider tracking, real authentication, finance module,
Redis, offline mode. Mention these as future improvements in the README.

## Tech stack
Backend:
- Go, with chi (router), pgx (PostgreSQL driver), gorilla/websocket, goose (migrations)
- PostgreSQL 16 via Docker Compose locally; Neon in production

Frontend:
- React + TypeScript (strict mode) with Vite, React Router, Tailwind CSS
- TanStack Query (server state), Zustand (client state), TanStack Virtual (large tables)
- Zod (runtime validation of API responses)
- MSW + BroadcastChannel for the mock mode (Plan B, see below)
- Vitest for frontend tests; Go's testing package for backend tests

Use current stable versions of all libraries.

Hosting (all free): frontend on Netlify, Go backend on Render (free web service),
database on Neon (free plan).

## Repo structure (feature-based)
```
darkstore-os/
├── CLAUDE.md
├── README.md
├── docker-compose.yml          # local PostgreSQL
├── docs/                       # project docs
├── backend/
│   ├── cmd/server/main.go
│   ├── cmd/seed/main.go
│   ├── internal/
│   │   ├── orders/             # handlers, service, state machine, substitution logic
│   │   ├── products/
│   │   ├── ws/                 # WebSocket hub
│   │   ├── idempotency/
│   │   └── db/
│   └── migrations/
└── frontend/
    └── src/
        ├── features/shop/
        ├── features/ops/
        ├── features/picker/
        ├── lib/api.ts          # ALL REST calls go through here
        ├── lib/realtime.ts     # ALL live events go through here
        ├── lib/queryClient.ts
        ├── stores/             # Zustand stores
        ├── types/              # shared types + Zod schemas
        └── mocks/              # MSW handlers for mock mode
```

## Data model (PostgreSQL)
- `products`: id, name, category, price_paise (integer), created_at
- `stock`: product_id, available, reserved
- `orders`: id, status, version (integer, starts at 1), total_paise, created_at, updated_at
- `order_items`: id, order_id, product_id, qty, status, substitute_product_id (nullable),
  substitute_options (jsonb, nullable), expires_at (nullable)
- `idempotency_keys`: key, response_json, created_at

Rules:
- Money is always stored in paise as integers, never floats.
- Every change to an order (or any of its items) increments `orders.version` by 1.
- Stock reservation must be atomic to prevent overselling, using a conditional update like:
  ```sql
  UPDATE stock SET available = available - $1, reserved = reserved + $1
  WHERE product_id = $2 AND available >= $1
  ```
  and check rows affected, inside a transaction.

## Order state machine (enforced on the server only)
Order: `PLACED → PICKING → PACKED → DISPATCHED`
Item: `PENDING → PICKED | AWAITING_SUBSTITUTE → SUBSTITUTED | REFUNDED`
- Substitution is only allowed while the order is `PICKING`.
- Reject invalid transitions with 409 Conflict and a clear error code.
- Write unit tests for every allowed and disallowed transition.

## Substitution rules
- Candidates: same category, in stock, price within ±30% of the original,
  sorted by smallest price difference, top 2.
- Reserve 1 unit (or `shortQty` units) of each candidate when offering.
- On choice: apply it, release the unused candidate reservations.
- Expiry: store `expires_at` in the database. A background ticker in Go runs every
  2 seconds and refunds any `AWAITING_SUBSTITUTE` item past its `expires_at`.
  (Storing the deadline in the DB means expiry still works after a server restart.)

## REST API
- `GET  /api/health`
- `GET  /api/products`                         (send ETag; return 304 if unchanged)
- `POST /api/orders`                           (Idempotency-Key header required)
  - body: `{ items: [{ productId, qty }] }` — NEVER accept prices from the client
  - 409 `INSUFFICIENT_STOCK` with details if stock is not enough
- `GET  /api/orders`                           (lightweight summaries for the ops table)
- `GET  /api/orders/{id}`                      (full order with items)
- `POST /api/orders/{id}/start-picking`
- `POST /api/orders/{id}/items/{itemId}/short`       body: `{ shortQty }`
- `POST /api/orders/{id}/items/{itemId}/substitute`  body: `{ productId }`
  - (Idempotency-Key header required; 409 `EXPIRED` if past `expires_at`)
- `POST /api/orders/{id}/pack`
- `POST /api/orders/{id}/dispatch`
- `POST /api/dev/simulate`                     (creates random orders every few seconds,
  so the demo looks alive)

All errors use one JSON shape: `{ "error": "CODE", "message": "...", "details": {} }`

## WebSocket
- Endpoint: `/ws`
- Clients send subscribe messages: `{ "type": "subscribe", "channel": "ops" }`
  or `{ "type": "subscribe", "channel": "order:<id>" }`
- Server sends events containing the FULL order snapshot including version:
  `{ "type": "order.created" | "order.updated", "order": { ... } }`
- `ops` channel receives all order events; `order:<id>` only that order's events.
- Note: in production, the server must verify the customer owns the order.

## Frontend rules (these are the important part of the project)
1. Components never call `fetch` or open WebSockets directly; only `lib/api.ts` and
   `lib/realtime.ts` do (adapter pattern).
2. Server state lives in TanStack Query; client-only state (cart, role, filters) in Zustand.
3. Query keys: `['products']`, `['orders']`, `['order', id]`.
   `staleTime`: products 5 minutes; orders `Infinity` (kept fresh by WebSocket).
4. On WebSocket events, patch the cache with `setQueryData`. Never refetch the whole list
   for one change. Only apply an update if `incoming.version > cached.version`.
5. On WebSocket reconnect, invalidate `['orders']` and any open `['order', id]` once,
   and show a "Reconnecting…" badge while disconnected.
6. Optimistic updates with rollback (`onMutate` / `onError` / `onSettled`) for the
   substitution choice and picker actions.
7. Generate an Idempotency-Key with `crypto.randomUUID()` once per user action.
8. Validate all API responses with Zod.
9. Every data screen handles loading (skeleton), error (with retry), and empty states.
10. The substitution popup is DERIVED from order state (an item with status
    `AWAITING_SUBSTITUTE`), not triggered by the event itself, so it survives a page refresh.
    The countdown is computed from `expiresAt`, never a local 60-second timer.
11. The ops order table uses TanStack Virtual and stays smooth with 10,000+ rows.
    Row components are memoized; Zustand is used with selectors.
12. Role switcher (customer / picker / manager) with route guards.
    Lazy-load each route so each role only downloads its own code.
13. Cart stores only `productId → quantity` (prices come from the products cache) and
    persists to `localStorage`.
14. Add an error boundary and a friendly "Waking up the server…" state for cold starts.

## Mock mode (Plan B)
- An env flag `VITE_USE_MOCK=true` swaps the real adapters for mock ones:
  MSW answers REST calls, and BroadcastChannel syncs live events across browser tabs.
- No component should change when switching modes.

## Seed data
- One store, ~40 products across 5 categories (Dairy, Bakery, Fruits & Vegetables,
  Snacks, Beverages), using realistic Indian grocery items and prices in paise.
- ~10,000 historical orders spread across all statuses (for the virtualized table).
- Include at least 2 similar products per category so substitution has candidates.

## Quality bar
- TypeScript strict, no `any`. ESLint + Prettier on the frontend; `gofmt` on the backend.
- Environment variables for all URLs: `VITE_API_URL`, `VITE_WS_URL` (wss:// in production),
  `DATABASE_URL`, `ALLOWED_ORIGIN` (for CORS), `PORT`.
- Tests: Go unit tests for the state machine and substitution expiry; Vitest test for the
  cache patching + version check function.
- Small, meaningful commits (conventional commit messages).
- README: problem, feature walkthrough, architecture diagram, key decisions and trade-offs,
  known limitations, how to run locally, and live links.

## Phases (do ONE at a time and stop after each)
- **Phase 0**: Create CLAUDE.md (short: project summary, stack, and the frontend rules
  above) and docs/project-spec.md (this full spec). Set up the folder structure,
  docker-compose.yml, .gitignore, and a README skeleton.
- **Phase 1**: Database schema (migrations) + seed command.
- **Phase 2**: Go REST API (products with ETag, orders, atomic stock reservation,
  idempotency, error format, CORS) + `/api/health`.
- **Phase 3**: WebSocket hub, order state machine with tests, version increments.
- **Phase 4** (early deploy check): deploy backend to Render + Neon and a "hello" frontend
  to Netlify that calls `/api/health` and opens the WebSocket. Fix CORS / env / wss now.
- **Phase 5**: Frontend foundation: Vite + TS strict + Tailwind + TanStack Query + Zustand +
  router + role switcher + adapters + Zod schemas.
- **Phase 6**: `/shop` (catalog, cart, checkout with idempotency and 409 handling, order
  tracker).
- **Phase 7**: `/ops` (virtualized live order table with cache patching, version checks,
  reconnect handling, simulate button).
- **Phase 8**: `/picker` + Live Substitution end to end (short → popup with countdown →
  optimistic choice → expiry refund), across all three views.
- **Phase 9**: Mock mode (MSW + BroadcastChannel).
- **Phase 10**: Tests, polish, final deploy, README, and a script for the demo video.

Checkpoints: after Phase 7 the project must already be presentable; after Phase 8 it is
the full story. If time runs short, stop after Phase 8 and polish.
