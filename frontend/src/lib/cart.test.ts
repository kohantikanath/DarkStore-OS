import { describe, expect, it } from "vitest";

import { computeCartSummary } from "./cart";
import type { Product } from "../types/product";

const products: Product[] = [
  { id: "p1", name: "Milk", category: "Dairy", pricePaise: 2700 },
  { id: "p2", name: "Bread", category: "Bakery", pricePaise: 4500 },
];

describe("computeCartSummary", () => {
  it("returns an empty summary when products haven't loaded yet", () => {
    expect(computeCartSummary(undefined, { p1: 2 })).toEqual({
      lines: [],
      totalPaise: 0,
      totalItems: 0,
    });
  });

  it("returns an empty summary for an empty cart", () => {
    expect(computeCartSummary(products, {})).toEqual({
      lines: [],
      totalPaise: 0,
      totalItems: 0,
    });
  });

  it("computes line totals and a grand total from current product prices", () => {
    const summary = computeCartSummary(products, { p1: 2, p2: 1 });

    expect(summary.totalItems).toBe(3);
    expect(summary.totalPaise).toBe(2700 * 2 + 4500);
    expect(summary.lines).toHaveLength(2);
    // Sorted by product name: Bread before Milk.
    expect(summary.lines[0].product.id).toBe("p2");
    expect(summary.lines[0].lineTotalPaise).toBe(4500);
    expect(summary.lines[1].product.id).toBe("p1");
    expect(summary.lines[1].lineTotalPaise).toBe(5400);
  });

  it("ignores a zero or negative quantity entry", () => {
    const summary = computeCartSummary(products, { p1: 0, p2: -1 });
    expect(summary.lines).toHaveLength(0);
  });

  it("ignores a cart entry for a product that no longer exists in the catalog", () => {
    const summary = computeCartSummary(products, { p1: 1, "ghost-id": 5 });
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0].product.id).toBe("p1");
  });
});
