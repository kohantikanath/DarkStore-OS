// The mock mode's "backend": an in-memory re-implementation of the Go
// server's core rules (atomic-enough stock reservation, the state machine,
// substitution candidate selection) so the frontend behaves the same way
// with or without a real backend running. It's simpler than the Go version
// in places — see the README for what's deliberately not reproduced
// (concurrent-request races don't really apply to a single JS thread, for
// instance).
import { orderToSummary } from "../lib/cache";
import { broadcastMockEvent } from "../lib/realtime";
import type {
  Order,
  OrderItem,
  OrderStatus,
  OrderSummary,
  SubstituteCandidate,
} from "../types/order";
import type { Product } from "../types/product";
import { catalog, findProduct } from "./catalog";

const SUBSTITUTION_WINDOW_MS = 60_000;
const MAX_SUBSTITUTE_CANDIDATES = 2;

interface StockEntry {
  available: number;
  reserved: number;
}

const stock = new Map<string, StockEntry>(
  catalog.map((p) => [p.id, { available: 200, reserved: 0 }]),
);
const orders = new Map<string, Order>();
// Every idempotency-guarded endpoint in this app returns an Order, so this
// is typed to that rather than `unknown` — mainly so callers get back
// something HttpResponse.json() accepts without a cast at every call site.
const idempotencyStore = new Map<string, { status: number; body: Order }>();
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function bumpVersion(order: Order) {
  order.version += 1;
  order.updatedAt = now();
}

function reserve(productId: string, qty: number): { ok: boolean; available: number } {
  const entry = stock.get(productId);
  if (!entry || entry.available < qty) return { ok: false, available: entry?.available ?? 0 };
  entry.available -= qty;
  entry.reserved += qty;
  return { ok: true, available: entry.available };
}

function writeOff(productId: string, qty: number) {
  const entry = stock.get(productId);
  if (entry) entry.reserved = Math.max(0, entry.reserved - qty);
}

function release(productId: string, qty: number) {
  const entry = stock.get(productId);
  if (!entry) return;
  entry.available += qty;
  entry.reserved = Math.max(0, entry.reserved - qty);
}

export function lookupIdempotency(key: string) {
  return idempotencyStore.get(key);
}

export function saveIdempotency(key: string, status: number, body: Order) {
  idempotencyStore.set(key, { status, body });
}

export function listProducts() {
  return catalog;
}

// Every mutator below returns this same shape, mirroring the backend's
// {error code, message, details} envelope closely enough that
// mocks/handlers.ts can forward it to the client almost verbatim.
export type MockResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string; details?: unknown };

export function createOrder(items: { productId: string; qty: number }[]): MockResult<Order> {
  const unknown = items.filter((i) => !findProduct(i.productId)).map((i) => i.productId);
  if (unknown.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "UNKNOWN_PRODUCT",
      message: "one or more products do not exist",
      details: unknown,
    };
  }

  const reserved: { productId: string; qty: number }[] = [];
  const shortfalls: { productId: string; requested: number; available: number }[] = [];
  for (const item of items) {
    const result = reserve(item.productId, item.qty);
    if (result.ok) {
      reserved.push(item);
    } else {
      shortfalls.push({
        productId: item.productId,
        requested: item.qty,
        available: result.available,
      });
    }
  }
  if (shortfalls.length > 0) {
    for (const r of reserved) release(r.productId, r.qty); // roll back what did succeed
    return {
      ok: false,
      status: 409,
      code: "INSUFFICIENT_STOCK",
      message: "not enough stock for one or more items",
      details: shortfalls,
    };
  }

  const totalPaise = items.reduce(
    (sum, i) => sum + (findProduct(i.productId)?.pricePaise ?? 0) * i.qty,
    0,
  );
  const timestamp = now();
  const order: Order = {
    id: uuid(),
    status: "PLACED",
    version: 1,
    totalPaise,
    createdAt: timestamp,
    updatedAt: timestamp,
    items: items.map((item) => ({
      id: uuid(),
      productId: item.productId,
      qty: item.qty,
      status: "PENDING",
    })),
  };
  orders.set(order.id, order);
  return { ok: true, value: order };
}

export function getOrder(id: string): Order | undefined {
  return orders.get(id);
}

export function listOrderSummaries(): OrderSummary[] {
  return Array.from(orders.values())
    .map(orderToSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function transition(
  id: string,
  from: OrderStatus,
  to: OrderStatus,
  extra?: (order: Order) => void,
): MockResult<Order> {
  const order = orders.get(id);
  if (!order)
    return { ok: false, status: 404, code: "ORDER_NOT_FOUND", message: "no order with that id" };
  if (order.status !== from) {
    return {
      ok: false,
      status: 409,
      code: "INVALID_TRANSITION",
      message: `cannot transition order from ${order.status} to ${to}`,
    };
  }
  order.status = to;
  extra?.(order);
  bumpVersion(order);
  return { ok: true, value: order };
}

export function startPicking(id: string): MockResult<Order> {
  return transition(id, "PLACED", "PICKING");
}

export function pack(id: string): MockResult<Order> {
  const order = orders.get(id);
  // Mirrors the backend's CanPackOrder: packing finalizes every still-PENDING
  // item to PICKED, which must not run out from under an item the customer
  // hasn't decided on yet (or the expiry timer hasn't resolved yet).
  if (order?.status === "PICKING" && order.items.some((i) => i.status === "AWAITING_SUBSTITUTE")) {
    return {
      ok: false,
      status: 409,
      code: "SUBSTITUTION_PENDING",
      message: "cannot pack while an item is awaiting a substitution decision",
    };
  }

  return transition(id, "PICKING", "PACKED", (order) => {
    for (const item of order.items) {
      if (item.status === "PENDING") item.status = "PICKED";
    }
  });
}

export function dispatch(id: string): MockResult<Order> {
  return transition(id, "PACKED", "DISPATCHED");
}

function findItem(orderId: string, itemId: string): { order: Order; item: OrderItem } | undefined {
  const order = orders.get(orderId);
  const item = order?.items.find((i) => i.id === itemId);
  if (!order || !item) return undefined;
  return { order, item };
}

// Candidates within ±30% of product's price, in the same subcategory, that
// currently have enough available stock — checked against the stock Map
// directly (not via reserve(), which would mutate state). Never falls back
// to the wider category: a wrong substitute (curd for butter, onion for
// potato) is worse than a refund.
function findSubstituteMatches(product: Product, shortQty: number): Product[] {
  const low = product.pricePaise * 0.7;
  const high = product.pricePaise * 1.3;

  return catalog
    .filter((p) => p.id !== product.id)
    .filter((p) => p.subcategory === product.subcategory)
    .filter((p) => p.pricePaise >= low && p.pricePaise <= high)
    .filter((p) => (stock.get(p.id)?.available ?? 0) >= shortQty)
    .sort(
      (a, b) =>
        Math.abs(a.pricePaise - product.pricePaise) - Math.abs(b.pricePaise - product.pricePaise),
    )
    .slice(0, MAX_SUBSTITUTE_CANDIDATES);
}

export function markItemShort(
  orderId: string,
  itemId: string,
  shortQty: number,
): MockResult<Order> {
  const found = findItem(orderId, itemId);
  if (!found)
    return { ok: false, status: 404, code: "ORDER_NOT_FOUND", message: "no matching order/item" };
  const { order, item } = found;

  if (order.status !== "PICKING" || item.status !== "PENDING") {
    return {
      ok: false,
      status: 409,
      code: "INVALID_TRANSITION",
      message: "cannot mark this item short right now",
    };
  }
  if (shortQty < 1 || shortQty > item.qty) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: `shortQty must be between 1 and ${item.qty}`,
    };
  }

  const product = findProduct(item.productId);
  if (!product)
    return { ok: false, status: 404, code: "ORDER_NOT_FOUND", message: "no matching order/item" };

  writeOff(item.productId, shortQty);

  // Mirrors the backend's SubstituteCandidates: same-subcategory match
  // only, never the wider category.
  const matched = findSubstituteMatches(product, shortQty);

  const candidates: SubstituteCandidate[] = matched
    .filter((p) => reserve(p.id, shortQty).ok)
    .map((p) => ({ productId: p.id, name: p.name, pricePaise: p.pricePaise }));

  if (candidates.length === 0) {
    item.status = "REFUNDED";
  } else {
    item.status = "AWAITING_SUBSTITUTE";
    item.substituteOptions = { shortQty, candidates };
    item.expiresAt = new Date(Date.now() + SUBSTITUTION_WINDOW_MS).toISOString();

    // Stands in for the backend's 2-second ticker — since this only runs in
    // the tab that made the offer, the countdown only truly expires if that
    // tab stays open (see the README for this trade-off).
    const timer = setTimeout(() => expireItem(orderId, itemId), SUBSTITUTION_WINDOW_MS);
    expiryTimers.set(itemId, timer);
  }

  bumpVersion(order);
  return { ok: true, value: order };
}

function expireItem(orderId: string, itemId: string) {
  const found = findItem(orderId, itemId);
  expiryTimers.delete(itemId);
  if (!found || found.item.status !== "AWAITING_SUBSTITUTE") return; // already resolved

  const { order, item } = found;
  const offer = item.substituteOptions;
  if (offer) {
    for (const c of offer.candidates) release(c.productId, offer.shortQty);
  }
  item.status = "REFUNDED";
  item.expiresAt = undefined;
  bumpVersion(order);

  broadcastMockEvent(order, "order.updated");
}

export function chooseSubstitute(
  orderId: string,
  itemId: string,
  productId: string,
): MockResult<Order> {
  const found = findItem(orderId, itemId);
  if (!found)
    return { ok: false, status: 404, code: "ORDER_NOT_FOUND", message: "no matching order/item" };
  const { order, item } = found;

  // Mirrors the backend's CanChooseSubstitute: the order itself must still
  // be PICKING, not just the item still AWAITING_SUBSTITUTE — in practice
  // unreachable now that pack() above refuses to run while any item awaits,
  // but checked anyway rather than trusting that invariant from a distance.
  if (order.status !== "PICKING" || item.status !== "AWAITING_SUBSTITUTE") {
    return {
      ok: false,
      status: 409,
      code: "INVALID_TRANSITION",
      message: "this item isn't awaiting a substitution choice",
    };
  }
  if (!item.expiresAt || Date.now() > new Date(item.expiresAt).getTime()) {
    return {
      ok: false,
      status: 409,
      code: "EXPIRED",
      message: "the substitution window has expired",
    };
  }

  const offer = item.substituteOptions;
  const chosen = offer?.candidates.find((c) => c.productId === productId);
  if (!offer || !chosen) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_SUBSTITUTE_CHOICE",
      message: "that product wasn't offered as a substitute for this item",
    };
  }

  for (const c of offer.candidates) {
    if (c.productId !== productId) release(c.productId, offer.shortQty);
  }

  const timer = expiryTimers.get(itemId);
  if (timer) {
    clearTimeout(timer);
    expiryTimers.delete(itemId);
  }

  item.status = "SUBSTITUTED";
  item.substituteProductId = productId;
  item.expiresAt = undefined;
  bumpVersion(order);

  return { ok: true, value: order };
}

export function simulateOrder(): MockResult<Order> {
  const n = 1 + Math.floor(Math.random() * 3);
  const picks = [...catalog].sort(() => Math.random() - 0.5).slice(0, n);
  const items = picks.map((p) => ({ productId: p.id, qty: 1 + Math.floor(Math.random() * 3) }));
  return createOrder(items);
}

const orderStatuses: { status: OrderStatus; weight: number }[] = [
  { status: "PLACED", weight: 10 },
  { status: "PICKING", weight: 15 },
  { status: "PACKED", weight: 25 },
  { status: "DISPATCHED", weight: 50 },
];

function weightedStatus(): OrderStatus {
  const total = orderStatuses.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * total;
  for (const s of orderStatuses) {
    if (r < s.weight) return s.status;
    r -= s.weight;
  }
  return "DISPATCHED";
}

// Mirrors cmd/seed's historical-order generation (simplified — see the
// README), so the ops table's virtualization demo works the same whether
// or not a real backend is running.
export function seedHistoricalOrders(count: number) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (let i = 0; i < count; i++) {
    const status = weightedStatus();
    const itemCount = 1 + Math.floor(Math.random() * 5);
    const items: OrderItem[] = [];
    let totalPaise = 0;

    for (let j = 0; j < itemCount; j++) {
      const product = catalog[Math.floor(Math.random() * catalog.length)];
      const qty = 1 + Math.floor(Math.random() * 3);
      totalPaise += product.pricePaise * qty;
      items.push({
        id: uuid(),
        productId: product.id,
        qty,
        status: status === "PLACED" ? "PENDING" : "PICKED",
      });
    }

    const createdAt = new Date(Date.now() - Math.random() * 60 * DAY_MS).toISOString();
    const orderId = uuid();
    orders.set(orderId, {
      id: orderId,
      status,
      version: 1,
      totalPaise,
      createdAt,
      updatedAt: createdAt,
      items,
    });
  }
}
