import { describe, expect, it } from "vitest";

import { mergeOrder, mergeOrderIntoSummaries, orderToSummary, rollbackOrder } from "./cache";
import type { Order, OrderSummary } from "../types/order";

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    status: "PLACED",
    version: 1,
    totalPaise: 1000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    items: [],
    ...overrides,
  };
}

describe("orderToSummary", () => {
  it("is false when no item is awaiting a substitution decision", () => {
    const order = makeOrder({
      items: [
        { id: "item-1", productId: "p1", qty: 1, status: "PENDING" },
        { id: "item-2", productId: "p2", qty: 1, status: "PICKED" },
      ],
    });
    expect(orderToSummary(order).awaitingSubstitution).toBe(false);
  });

  it("is true when any item is AWAITING_SUBSTITUTE", () => {
    const order = makeOrder({
      items: [
        { id: "item-1", productId: "p1", qty: 1, status: "PICKED" },
        { id: "item-2", productId: "p2", qty: 1, status: "AWAITING_SUBSTITUTE" },
      ],
    });
    expect(orderToSummary(order).awaitingSubstitution).toBe(true);
  });
});

describe("mergeOrder", () => {
  it("accepts an incoming order when there's nothing cached yet", () => {
    const incoming = makeOrder({ version: 1 });
    expect(mergeOrder(undefined, incoming)).toBe(incoming);
  });

  it("accepts an incoming order with a higher version", () => {
    const cached = makeOrder({ version: 1, status: "PLACED" });
    const incoming = makeOrder({ version: 2, status: "PICKING" });
    expect(mergeOrder(cached, incoming)).toBe(incoming);
  });

  it("rejects a stale incoming order with a lower version", () => {
    const cached = makeOrder({ version: 3, status: "PACKED" });
    const incoming = makeOrder({ version: 2, status: "PICKING" });
    expect(mergeOrder(cached, incoming)).toBe(cached);
  });

  it("accepts an incoming order with an equal version (idempotent replay)", () => {
    const cached = makeOrder({ version: 2 });
    const incoming = makeOrder({ version: 2 });
    expect(mergeOrder(cached, incoming)).toBe(incoming);
  });
});

describe("rollbackOrder", () => {
  it("restores the snapshot when the cached version still matches it", () => {
    const snapshot = makeOrder({ version: 1, status: "PLACED" });
    // The optimistic update changed fields but never bumped version.
    const cached = makeOrder({ version: 1, status: "PICKING" });
    expect(rollbackOrder(cached, snapshot)).toBe(snapshot);
  });

  it("skips the rollback when a newer version already landed", () => {
    const snapshot = makeOrder({ version: 1, status: "PLACED" });
    const cached = makeOrder({ version: 2, status: "PACKED" });
    expect(rollbackOrder(cached, snapshot)).toBe(cached);
  });

  it("restores the snapshot when there's nothing cached at all", () => {
    const snapshot = makeOrder({ version: 1 });
    expect(rollbackOrder(undefined, snapshot)).toBe(snapshot);
  });
});

describe("mergeOrderIntoSummaries", () => {
  it("leaves an unloaded list alone (undefined stays undefined)", () => {
    expect(mergeOrderIntoSummaries(undefined, makeOrder())).toBeUndefined();
  });

  it("prepends a new order that isn't in the list yet", () => {
    const existing: OrderSummary[] = [orderToSummary(makeOrder({ id: "order-0" }))];
    const incoming = makeOrder({ id: "order-1", version: 1 });

    const result = mergeOrderIntoSummaries(existing, incoming);

    expect(result).toHaveLength(2);
    expect(result?.[0].id).toBe("order-1");
    expect(result?.[1].id).toBe("order-0");
  });

  it("patches the matching row in place when the version is newer", () => {
    const existing: OrderSummary[] = [
      orderToSummary(makeOrder({ id: "order-1", version: 1, status: "PLACED" })),
      orderToSummary(makeOrder({ id: "order-2", version: 1 })),
    ];
    const incoming = makeOrder({ id: "order-1", version: 2, status: "PICKING" });

    const result = mergeOrderIntoSummaries(existing, incoming);

    expect(result).toHaveLength(2);
    expect(result?.[0].status).toBe("PICKING");
    expect(result?.[0].version).toBe(2);
    expect(result?.[1]).toBe(existing[1]); // untouched row keeps its identity
  });

  it("ignores a stale update for a row already at a higher version", () => {
    const existing: OrderSummary[] = [
      orderToSummary(makeOrder({ id: "order-1", version: 3, status: "PACKED" })),
    ];
    const incoming = makeOrder({ id: "order-1", version: 2, status: "PICKING" });

    const result = mergeOrderIntoSummaries(existing, incoming);

    expect(result).toBe(existing);
  });
});
