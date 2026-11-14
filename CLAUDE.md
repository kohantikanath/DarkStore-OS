# DarkStore OS

A mini fulfillment platform modeling a Zepto-style dark store: a customer shop, a picker
app, and a store-manager ops view, connected in real time over WebSockets. Headline
feature: **Live Substitution** — when a picker marks an item out of stock, the customer
gets a 60-second popup to pick a replacement before the line is auto-refunded.

Full spec: [docs/project-spec.md](docs/project-spec.md). Read it before starting a phase;
this file is just the quick-reference summary.

## Working agreement
- Build in phases, one at a time; stop after each and wait for the go-ahead.
- Before coding a phase, show the plan and file list.
- After a phase: what was built, how to run/test it, key decisions + trade-offs, and
  3 comprehension-check questions.
- Simple, readable code over clever code. Explain unfamiliar terms.

## Stack
- **Backend**: Go, chi (router), pgx (Postgres driver), gorilla/websocket, goose
  (migrations). PostgreSQL 16 (Docker Compose locally, Neon in prod).
- **Frontend**: React + TypeScript (strict), Vite, React Router, Tailwind CSS,
  TanStack Query, Zustand, TanStack Virtual, Zod, MSW + BroadcastChannel (mock mode).
- **Tests**: Go `testing` package; Vitest.
- **Hosting**: Vercel (frontend), Render (backend), Neon (Postgres) — all free tier.

## Frontend rules (non-negotiable)
1. Components never call `fetch` or open WebSockets directly — only `lib/api.ts` and
   `lib/realtime.ts` do (adapter pattern), so mock mode is a drop-in swap.
2. Server state → TanStack Query. Client-only state (cart, role, filters) → Zustand.
3. Query keys: `['products']`, `['orders']`, `['order', id]`. `staleTime`: products 5 min,
   orders `Infinity` (freshness comes from WebSocket pushes, not polling).
4. WebSocket events patch the cache via `setQueryData`, gated on
   `incoming.version > cached.version`. Never refetch a whole list for one change.
5. On reconnect: invalidate `['orders']` and any open `['order', id]` once; show a
   "Reconnecting…" badge while disconnected.
6. Optimistic updates with rollback (`onMutate`/`onError`/`onSettled`) for substitution
   choices and picker actions.
7. One `crypto.randomUUID()` Idempotency-Key per user action.
8. Validate all API responses with Zod.
9. Every data screen: loading (skeleton), error (retry), empty state.
10. The substitution popup is *derived* from order state (an item with status
    `AWAITING_SUBSTITUTE`), not from the socket event — so it survives a refresh. The
    countdown is computed from `expiresAt`, never a local timer.
11. Ops order table: TanStack Virtual, memoized rows, Zustand selectors — must stay smooth
    at 10,000+ rows.
12. Role switcher (customer/picker/manager) with route guards; each role's code is
    lazy-loaded.
13. Cart stores `productId → quantity` only (prices come from the products cache);
    persists to `localStorage`.
14. Error boundary + a "Waking up the server…" state for Render cold starts.

## Backend rules (non-negotiable)
- Money is always integer paise, never floats.
- Every order/item change increments `orders.version`.
- Stock reservation is atomic: conditional `UPDATE ... WHERE available >= $1` inside a
  transaction, checking rows affected — never read-then-write.
- Order/item state transitions are enforced server-side only; invalid ones → 409.
- All errors: `{ "error": "CODE", "message": "...", "details": {} }`.
- Substitution expiry is driven by `expires_at` in the DB + a 2-second ticker, not an
  in-memory timer, so it survives a restart.

## Out of scope (mention as future work in the README)
Payments, maps, rider tracking, real authentication, finance module, Redis, offline mode.
