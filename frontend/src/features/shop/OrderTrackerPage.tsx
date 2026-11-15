import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "../../lib/api";
import { formatPaise } from "../../lib/cart";
import { useOrder, useProducts } from "../../lib/queries";
import { subscribe } from "../../lib/realtime";
import { StatusPill } from "../../components/StatusPill";
import { SubstitutionModal } from "./SubstitutionModal";
import type { OrderStatus, ItemStatus } from "../../types/order";

const orderSteps: { status: OrderStatus; label: string }[] = [
  { status: "PLACED", label: "Placed" },
  { status: "PICKING", label: "Picking" },
  { status: "PACKED", label: "Packed" },
  { status: "DISPATCHED", label: "Dispatched" },
];

const itemStatusLabel: Record<ItemStatus, string> = {
  PENDING: "Pending",
  PICKED: "Picked",
  AWAITING_SUBSTITUTE: "Choosing a replacement",
  SUBSTITUTED: "Substituted",
  REFUNDED: "Refunded",
};

export function OrderTrackerPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const order = useOrder(orderId ?? "");
  const products = useProducts();
  const productNameById = new Map((products.data ?? []).map((p) => [p.id, p.name]));

  useEffect(() => {
    if (orderId) subscribe(`order:${orderId}`);
  }, [orderId]);

  if (!orderId) {
    return <p className="text-ink/70">No order specified.</p>;
  }

  if (order.isPending) {
    return (
      <div className="space-y-3">
        <div className="h-6 w-48 animate-pulse rounded-md bg-ink/5" />
        <div className="h-24 animate-pulse rounded-xl bg-ink/5" />
      </div>
    );
  }

  if (order.isError) {
    const notFound = order.error instanceof ApiError && order.error.code === "ORDER_NOT_FOUND";
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink/70">
          {notFound ? "No order with that id." : "Couldn't load this order."}
        </p>
        {!notFound && (
          <button
            type="button"
            onClick={() => order.refetch()}
            className="rounded-md bg-crate px-4 py-2 font-medium text-white hover:bg-crate-dark"
          >
            Retry
          </button>
        )}
        <Link to="/shop" className="text-sm font-medium text-crate underline">
          Back to shop
        </Link>
      </div>
    );
  }

  const currentStepIndex = orderSteps.findIndex((s) => s.status === order.data.status);
  // Derived from order state, not triggered by the WebSocket event itself —
  // this is why the popup is still here after a page refresh, and why it's
  // gone the instant an item resolves one way or the other.
  const awaitingItem = order.data.items.find((item) => item.status === "AWAITING_SUBSTITUTE");

  return (
    <div className={awaitingItem ? "pb-24" : undefined}>
      <Link to="/shop" className="text-sm font-medium text-crate underline">
        ← Back to shop
      </Link>

      <div className="mt-3 flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">
          Order #{order.data.id.slice(0, 8)}
        </h1>
        <p className="font-display text-xl font-semibold tabular-nums text-ink/70">
          {formatPaise(order.data.totalPaise)}
        </p>
      </div>

      <ol className="my-6 flex items-center gap-2">
        {orderSteps.map((step, i) => (
          <li key={step.status} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                i <= currentStepIndex ? "bg-crate text-white" : "bg-ink/10 text-ink/70"
              }`}
            >
              {i + 1}
            </div>
            <span
              className={`text-sm font-medium ${i <= currentStepIndex ? "text-ink" : "text-ink/70"}`}
            >
              {step.label}
            </span>
            {i < orderSteps.length - 1 && (
              <div
                className={`h-0.5 flex-1 rounded-full ${i < currentStepIndex ? "bg-crate" : "bg-ink/10"}`}
              />
            )}
          </li>
        ))}
      </ol>

      <h2 className="mb-2 text-sm font-medium text-ink/70">Items</h2>
      <ul className="divide-y divide-ink/5 rounded-xl bg-white ring-1 ring-ink/10">
        {order.data.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-ink">
              {productNameById.get(item.productId) ?? item.productId}{" "}
              <span className="text-ink/70">× {item.qty}</span>
            </span>
            <StatusPill status={item.status} label={itemStatusLabel[item.status]} />
          </li>
        ))}
      </ul>

      {awaitingItem && <SubstitutionModal orderId={order.data.id} item={awaitingItem} />}
    </div>
  );
}
