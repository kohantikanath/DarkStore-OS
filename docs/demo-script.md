# Demo video script

A shot-by-shot script for a ~3-minute walkthrough recording. Each section
names what's on screen, what to click, and a line or two to say — not a
word-for-word transcript, just enough to keep the pacing tight. Record at
1280×800 or larger so the UI doesn't look cramped.

Setup before recording:
- Open https://darkstore-os.netlify.app in one browser window, three tabs.
- Visit it once ~a minute beforehand so Render's free tier is already awake
  (skip the "Waking up the server…" wait on camera).
- Tab 1: Customer. Tab 2: Picker. Tab 3: Store Manager. (Role picker →
  pick the role → each tab keeps it via `localStorage`.)

## 1. The problem (0:00–0:20)

**Screen**: title card or just the role-picker screen.

> Zepto-style quick-commerce promises ten-minute delivery. Inside the dark
> store, a picker is physically grabbing items off the shelf for your
> order. When something's missing, most systems just... drop it, and you
> find out at the door. That's DarkStore OS's one headline feature: Live
> Substitution — the customer gets a live popup with a real countdown to
> pick a replacement, the instant the picker finds the shelf empty.

## 2. The normal flow, fast (0:20–0:50)

**Screen**: Tab 1 (Customer) → `/shop`.

- Add 1–2 items to the cart, click **Place order**.
- Land on the order tracker. Point out the status stepper (PLACED).

> One API call, with an idempotency key so a flaky connection can't double
> the order.

**Screen**: Tab 2 (Picker) → `/picker`, open the same order, **Start
picking**.

> Watch the customer's tab — no refresh.

**Screen**: cut back to Tab 1 — status stepper now shows PICKING, live.

## 3. Live Substitution — the main event (0:50–2:00)

**Screen**: Tab 2 (Picker), same order, click **Mark short** on an item.

> The picker's screen now shows "Awaiting customer." The backend just
> found up to two same-category replacements within thirty percent of the
> price, reserved stock for them, and gave the customer sixty seconds.

**Screen**: cut to Tab 1 (Customer) — the substitution popup, with the
countdown visibly ticking down.

> This popup is derived from the order's own state, not a one-off toast —
> refresh the page right now and it's still here, counting down from the
> same real deadline.

- Click a replacement option.

**Screen**: popup closes instantly (optimistic update); cut to Tab 2
(Picker) — item now shows "Substituted," live, no refresh.

> Pick, pack, dispatch — full lifecycle.

- Tab 2: **Pack**, then **Dispatch**.
- Quick cut to Tab 1: status stepper now at DISPATCHED.

**Optional, if there's time**: redo "Mark short" on a fresh order and let
the 60-second window actually expire on screen (speed up in editing) to
show the automatic refund — same popup, same live update, no customer
action needed.

## 4. Store Manager / ops (2:00–2:20)

**Screen**: Tab 3 (Store Manager) → `/ops`.

> Ten thousand seeded historical orders, virtualized — only the rows near
> the viewport are ever actually in the DOM, so this stays smooth no matter
> how far you scroll.

- Scroll the table fast to show smoothness.
- Type a status filter or search an order id.
- Click **Simulate** — a new order appears at the top, live, every few
  seconds, with no refresh.

## 5. Mock mode — the bonus round (2:20–2:45)

**Screen**: a terminal, `VITE_USE_MOCK=true npm run dev`, then the same app
in a browser with the backend/database *not running*.

> Everything you just watched also runs with zero backend — no Go server,
> no Postgres. MSW intercepts the REST calls, BroadcastChannel stands in
> for the WebSocket. Not one React component changed between these two
> modes — that's the adapter pattern paying for itself.

- Briefly repeat the mark-short → popup flow in mock mode across two tabs,
  if time allows; otherwise just show the catalog loading with the Go
  server's process genuinely killed/stopped on screen.

## 6. Close (2:45–3:00)

**Screen**: README on GitHub, scrolled to the architecture diagram.

> Go, chi, Postgres with atomic stock reservation on the backend; React,
> TypeScript strict, TanStack Query, and Zustand on the front, built in ten
> scoped phases with tests, a documented set of trade-offs, and two ways to
> run it — with a real backend, or with none at all. Code and full write-up
> are linked below.

**Screen**: end card with the repo URL and live links.

## Notes for editing

- Cut dead air out of every "watch the other tab update live" beat — the
  point is the *instant* update, not the few seconds of camera movement
  between tabs.
- If the free-tier Render backend cold-starts on camera anyway, keep ~5
  seconds of the "Waking up the server…" state in — it's an honest, minor
  trade-off of the free-tier hosting, not worth hiding, and it's a real
  state the app explicitly designed for (see README, frontend rule 14).
- Captions/subtitles help if this gets posted without sound by default
  (LinkedIn, etc.) — the "say" lines above are written to work as captions
  with light editing.
