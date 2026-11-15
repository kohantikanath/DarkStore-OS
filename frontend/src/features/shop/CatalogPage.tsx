import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../../lib/api";
import { computeCartSummary, formatPaise } from "../../lib/cart";
import { useCreateOrder, useProducts } from "../../lib/queries";
import { useCartStore } from "../../stores/cart";
import type { Product } from "../../types/product";
import { StockShortfallListSchema } from "../../types/order";

export function CatalogPage() {
  const products = useProducts();
  const items = useCartStore((s) => s.items);
  const increment = useCartStore((s) => s.increment);
  const decrement = useCartStore((s) => s.decrement);
  const clearCart = useCartStore((s) => s.clear);

  const createOrder = useCreateOrder();
  const navigate = useNavigate();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const byCategory = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const product of products.data ?? []) {
      const list = map.get(product.category) ?? [];
      list.push(product);
      map.set(product.category, list);
    }
    return map;
  }, [products.data]);

  const cart = computeCartSummary(products.data, items);

  function handlePlaceOrder() {
    setCheckoutError(null);
    const orderItems = cart.lines.map((line) => ({ productId: line.product.id, qty: line.qty }));
    // One fresh key per click — this is one checkout attempt, not retried
    // automatically, so it never needs to be reused across calls.
    const idempotencyKey = crypto.randomUUID();

    createOrder.mutate(
      { items: orderItems, idempotencyKey },
      {
        onSuccess: (order) => {
          clearCart();
          navigate(`/shop/order/${order.id}`);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === "INSUFFICIENT_STOCK") {
            const parsed = StockShortfallListSchema.safeParse(error.details);
            const byId = new Map((products.data ?? []).map((p) => [p.id, p]));
            const names = parsed.success
              ? parsed.data.map((s) => byId.get(s.productId)?.name ?? s.productId).join(", ")
              : "one or more items";
            setCheckoutError(`Not enough stock for: ${names}. Adjust quantities and try again.`);
          } else if (error instanceof ApiError) {
            setCheckoutError(error.message);
          } else {
            setCheckoutError("Something went wrong placing the order.");
          }
        },
      },
    );
  }

  if (products.isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  }

  if (products.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-slate-600">Couldn't load the catalog.</p>
        <button
          type="button"
          onClick={() => products.refetch()}
          className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if ((products.data ?? []).length === 0) {
    return <p className="text-slate-500">No products available right now.</p>;
  }

  return (
    <div className="pb-28">
      <h1 className="mb-6 text-xl font-semibold text-slate-800">Shop</h1>

      {Array.from(byCategory.entries()).map(([category, categoryProducts]) => (
        <section key={category} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {category}
          </h2>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
            {categoryProducts.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                qty={items[product.id] ?? 0}
                onIncrement={() => increment(product.id)}
                onDecrement={() => decrement(product.id)}
              />
            ))}
          </ul>
        </section>
      ))}

      {cart.totalItems > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-4 shadow-lg">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">
                {cart.totalItems} item{cart.totalItems === 1 ? "" : "s"}
              </p>
              <p className="text-lg font-semibold text-slate-800">{formatPaise(cart.totalPaise)}</p>
              {checkoutError && <p className="mt-1 text-sm text-red-600">{checkoutError}</p>}
            </div>
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={createOrder.isPending}
              className="rounded-md bg-slate-800 px-5 py-2.5 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {createOrder.isPending ? "Placing order…" : "Place order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
  qty,
  onIncrement,
  onDecrement,
}: {
  product: Product;
  qty: number;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  return (
    <li className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-slate-800">{product.name}</p>
        <p className="text-sm text-slate-500">{formatPaise(product.pricePaise)}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onDecrement}
          disabled={qty === 0}
          aria-label={`Remove one ${product.name}`}
          className="h-8 w-8 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          −
        </button>
        <span className="w-6 text-center text-slate-800">{qty}</span>
        <button
          type="button"
          onClick={onIncrement}
          aria-label={`Add one ${product.name}`}
          className="h-8 w-8 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          +
        </button>
      </div>
    </li>
  );
}
