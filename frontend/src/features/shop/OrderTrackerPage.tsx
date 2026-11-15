import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "../../lib/api";
import { formatPaise } from "../../lib/cart";
import { useOrder, useProducts } from "../../lib/queries";
import { subscribe } from "../../lib/realtime";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import type { OrderStatus, ItemStatus } from "../../types/order";

const orderSteps: OrderStatus[] = ["PLACED", "PICKING", "PACKED", "DISPATCHED"];

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

  // The popup for AWAITING_SUBSTITUTE items and the full live-update story
  // land in Phase 8; this just needs the order itself kept fresh (version
  // check already handled by lib/realtime.ts's cache patching) — subscribing
  // is the only thing this screen needs to do for that to work.
  useEffect(() => {
    if (orderId) subscribe(`order:${orderId}`);
  }, [orderId]);

  if (!orderId) {
    return <p className="text-slate-500">No order specified.</p>;
  }

  if (order.isPending) {
    return (
      <div className="space-y-3">
        <div className="h-6 w-48 animate-pulse rounded-md bg-slate-100" />
        <div className="h-24 animate-pulse rounded-md bg-slate-100" />
      </div>
    );
  }

  if (order.isError) {
    const notFound = order.error instanceof ApiError && order.error.code === "ORDER_NOT_FOUND";
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-slate-600">
          {notFound ? "No order with that id." : "Couldn't load this order."}
        </p>
        {!notFound && (
          <button
            type="button"
            onClick={() => order.refetch()}
            className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-700"
          >
            Retry
          </button>
        )}
        <Link to="/shop" className="text-sm text-slate-500 underline">
          Back to shop
        </Link>
      </div>
    );
  }

  const currentStepIndex = orderSteps.indexOf(order.data.status);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link to="/shop" className="text-sm text-slate-500 underline">
          ← Back to shop
        </Link>
        <ConnectionBadge />
      </div>

      <h1 className="text-xl font-semibold text-slate-800">Order #{order.data.id.slice(0, 8)}</h1>
      <p className="text-slate-500">{formatPaise(order.data.totalPaise)}</p>

      <ol className="my-6 flex items-center gap-2">
        {orderSteps.map((step, i) => (
          <li key={step} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                i <= currentStepIndex ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-500"
              }`}
            >
              {i + 1}
            </div>
            <span
              className={`text-sm ${i <= currentStepIndex ? "text-slate-800" : "text-slate-400"}`}
            >
              {step}
            </span>
            {i < orderSteps.length - 1 && <div className="h-px flex-1 bg-slate-200" />}
          </li>
        ))}
      </ol>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Items</h2>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
        {order.data.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between px-4 py-3">
            <span className="text-slate-800">
              {productNameById.get(item.productId) ?? item.productId} × {item.qty}
            </span>
            <span className="text-sm text-slate-500">{itemStatusLabel[item.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
