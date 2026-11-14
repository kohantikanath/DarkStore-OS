# DarkStore OS

> Status: Phase 0 — project scaffolding. Not runnable yet.

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

_Filled in as each phase is built — see the phase write-ups in project history._

## Known limitations / out of scope

Payments, maps, rider tracking, real authentication, a finance module, Redis, and offline
mode are intentionally out of scope for this build. Noted here as future improvements,
not oversights.

## Running locally

_Instructions added starting Phase 1 (database) and Phase 2 (backend API)._

## Live links

- Frontend: _TBD (Phase 4+)_
- Backend: _TBD (Phase 4+)_

## Project docs

- [Full project spec](docs/project-spec.md)
- [CLAUDE.md](CLAUDE.md) — quick-reference for stack and frontend/backend rules
