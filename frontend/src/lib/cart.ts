// Pure cart math, kept separate from the Zustand store for the same reason
// as lib/cache.ts: this is the part worth getting right and worth testing
// with plain objects, no store or component involved.
import type { Product } from "../types/product";

export interface CartLine {
  product: Product;
  qty: number;
  lineTotalPaise: number;
}

export interface CartSummary {
  lines: CartLine[];
  totalPaise: number;
  totalItems: number;
}

// Cart state only ever stores productId -> qty (see stores/cart.ts); prices
// always come from here, from whatever the products query currently has
// cached, never from the cart itself.
export function computeCartSummary(
  products: Product[] | undefined,
  items: Record<string, number>,
): CartSummary {
  if (!products) return { lines: [], totalPaise: 0, totalItems: 0 };

  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: CartLine[] = [];

  for (const [productId, qty] of Object.entries(items)) {
    if (qty <= 0) continue;
    const product = byId.get(productId);
    if (!product) continue; // stale cart entry for a product that no longer exists
    lines.push({ product, qty, lineTotalPaise: product.pricePaise * qty });
  }

  lines.sort((a, b) => a.product.name.localeCompare(b.product.name));

  const totalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  const totalItems = lines.reduce((sum, line) => sum + line.qty, 0);

  return { lines, totalPaise, totalItems };
}

export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

// A substitute candidate's price relative to the original item, for the
// substitution modal ("Mother Dairy Curd 400g +₹3.00"). Keeping the sign
// out front of the currency symbol (formatPaise alone would render a
// negative diff as the odd-looking "₹-2.00") and calling out "Same price"
// for an exact match rather than printing "+₹0.00".
export function formatPriceDiff(diffPaise: number): string {
  if (diffPaise === 0) return "Same price";
  const sign = diffPaise > 0 ? "+" : "−";
  return `${sign}${formatPaise(Math.abs(diffPaise))}`;
}
