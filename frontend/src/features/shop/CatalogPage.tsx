import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../../lib/api";
import { computeCartSummary, formatPaise } from "../../lib/cart";
import { useCreateOrder, useProducts } from "../../lib/queries";
import { useCartStore } from "../../stores/cart";
import type { Product } from "../../types/product";
import { StockShortfallListSchema } from "../../types/order";
import { productEmoji } from "./productEmoji";

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

  const categories = useMemo(() => Array.from(byCategory.keys()), [byCategory]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const currentCategory = activeCategory && byCategory.has(activeCategory) ? activeCategory : categories[0];

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-ink/5" />
        ))}
      </div>
    );
  }

  if (products.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink/70">Couldn't load the catalog.</p>
        <button
          type="button"
          onClick={() => products.refetch()}
          className="rounded-md bg-crate px-4 py-2 font-medium text-white hover:bg-crate-dark"
        >
          Retry
        </button>
      </div>
    );
  }

  if ((products.data ?? []).length === 0) {
    return <p className="text-ink/70">No products available right now.</p>;
  }

  return (
    <div className="pb-28 lg:pb-6">
      <h1 className="mb-4 text-2xl font-semibold text-ink">Shop</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="sticky top-0 z-10 -mx-4 mb-4 flex gap-2 overflow-x-auto bg-paper/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-full sm:bg-ink/5 sm:px-1.5 sm:py-1.5">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  category === currentCategory
                    ? "bg-crate text-white shadow-sm"
                    : "text-ink/70 hover:text-ink sm:hover:bg-white/60"
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(byCategory.get(currentCategory) ?? []).map((product) => (
              <ProductTile
                key={product.id}
                product={product}
                qty={items[product.id] ?? 0}
                onIncrement={() => increment(product.id)}
                onDecrement={() => decrement(product.id)}
              />
            ))}
          </ul>
        </div>

        <aside className="hidden lg:block">
          <CartPanel
            cart={cart}
            isPlacing={createOrder.isPending}
            error={checkoutError}
            onPlaceOrder={handlePlaceOrder}
          />
        </aside>
      </div>

      {cart.totalItems > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-ink/10 bg-white p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] lg:hidden">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <div>
              <p className="text-sm text-ink/70">
                {cart.totalItems} item{cart.totalItems === 1 ? "" : "s"}
              </p>
              <p className="font-display text-xl font-semibold tabular-nums text-ink">
                {formatPaise(cart.totalPaise)}
              </p>
              {checkoutError && <p className="mt-1 text-sm text-alert-dark">{checkoutError}</p>}
            </div>
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={createOrder.isPending}
              className="rounded-full bg-crate px-5 py-2.5 font-medium text-white hover:bg-crate-dark disabled:opacity-50"
            >
              {createOrder.isPending ? "Placing order…" : "Place order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CartPanel({
  cart,
  isPlacing,
  error,
  onPlaceOrder,
}: {
  cart: ReturnType<typeof computeCartSummary>;
  isPlacing: boolean;
  error: string | null;
  onPlaceOrder: () => void;
}) {
  return (
    <div className="sticky top-20 rounded-xl bg-white p-5 ring-1 ring-ink/10">
      <h2 className="text-lg font-semibold text-ink">Your cart</h2>

      {cart.lines.length === 0 ? (
        <p className="mt-3 text-sm text-ink/70">Nothing here yet — add something from the shop.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {cart.lines.map((line) => (
            <li key={line.product.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-ink/80">
                {line.product.name} <span className="text-ink/70">× {line.qty}</span>
              </span>
              <span className="shrink-0 tabular-nums text-ink">
                {formatPaise(line.lineTotalPaise)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-ink/10 pt-4">
        <span className="text-sm font-medium text-ink/70">Total</span>
        <span className="font-display text-2xl font-semibold tabular-nums text-ink">
          {formatPaise(cart.totalPaise)}
        </span>
      </div>

      {error && <p className="mt-3 text-sm text-alert-dark">{error}</p>}

      <button
        type="button"
        onClick={onPlaceOrder}
        disabled={isPlacing || cart.lines.length === 0}
        className="mt-4 w-full rounded-full bg-crate px-5 py-2.5 font-medium text-white hover:bg-crate-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPlacing ? "Placing order…" : "Place order"}
      </button>
    </div>
  );
}

function ProductTile({
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
    <li
      className={`flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 transition ${
        qty > 0 ? "ring-2 ring-crate" : "ring-ink/10"
      }`}
    >
      <span className="text-3xl" aria-hidden="true">
        {productEmoji(product.name, product.category)}
      </span>
      <p className="text-sm leading-snug font-medium text-ink">{product.name}</p>
      <p className="text-sm tabular-nums text-ink/70">{formatPaise(product.pricePaise)}</p>

      <div className="mt-auto flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onDecrement}
          disabled={qty === 0}
          aria-label={`Remove one ${product.name}`}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 text-ink/70 hover:bg-ink/5 disabled:opacity-30"
        >
          −
        </button>
        <span className="font-display tabular-nums text-lg font-semibold text-ink">{qty}</span>
        <button
          type="button"
          onClick={onIncrement}
          aria-label={`Add one ${product.name}`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-crate text-white hover:bg-crate-dark"
        >
          +
        </button>
      </div>
    </li>
  );
}
