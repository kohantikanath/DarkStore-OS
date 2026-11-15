// Pure merge logic for applying a WebSocket order event to the TanStack
// Query cache. Kept separate from lib/realtime.ts (which owns the actual
// WebSocket connection) so this — the part with real logic worth getting
// wrong — can be unit tested with plain objects, no socket or QueryClient
// involved.
import type { Order, OrderSummary } from "../types/order";

export function orderToSummary(order: Order): OrderSummary {
  return {
    id: order.id,
    status: order.status,
    version: order.version,
    totalPaise: order.totalPaise,
    itemCount: order.items.length,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    awaitingSubstitution: order.items.some((item) => item.status === "AWAITING_SUBSTITUTE"),
  };
}

// The version-check rule: an incoming event only replaces what's cached if
// it's actually newer. WebSocket delivery isn't guaranteed to preserve
// order, so without this check a late-arriving stale event could overwrite
// a newer state the UI already has.
export function mergeOrder(cached: Order | undefined, incoming: Order): Order {
  if (cached && cached.version > incoming.version) return cached;
  return incoming;
}

// The rollback-safety rule: an optimistic update's onError handler only
// restores its pre-mutation snapshot if nothing authoritative has changed
// the order since the mutation started. Optimistic updates never bump
// `version` (only a real server response does), so if the currently cached
// order's version no longer matches the snapshot's, something newer — a
// WebSocket event, another mutation's response — already landed while this
// one was in flight, and blindly restoring the older snapshot would
// silently undo it. No cached order at all (an unusual case — the query
// would have to have been removed mid-mutation) is treated the same as
// "nothing newer is known to exist", so the snapshot is restored.
export function rollbackOrder(cached: Order | undefined, snapshot: Order): Order | undefined {
  if (cached && cached.version !== snapshot.version) return cached;
  return snapshot;
}

// Patches one row of the ops list in place instead of refetching the whole
// list — the list can be 10,000+ rows, and this event only ever describes
// one order's change.
export function mergeOrderIntoSummaries(
  cached: OrderSummary[] | undefined,
  incoming: Order,
): OrderSummary[] | undefined {
  if (!cached) return cached;

  const incomingSummary = orderToSummary(incoming);
  const index = cached.findIndex((o) => o.id === incoming.id);

  if (index === -1) {
    // A brand new order (order.created) — the list is sorted newest-first,
    // so it goes at the front.
    return [incomingSummary, ...cached];
  }

  if (cached[index].version > incoming.version) return cached;

  const next = [...cached];
  next[index] = incomingSummary;
  return next;
}
