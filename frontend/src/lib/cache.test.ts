import { describe, expect, it } from "vitest";

import { mergeOrder, mergeOrderIntoSummaries, orderToSummary } from "./cache";
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
