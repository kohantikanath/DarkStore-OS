import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "../../lib/api";
import { formatPaise } from "../../lib/cart";
import {
  useDispatchOrder,
  useMarkItemShort,
  useOrder,
  usePackOrder,
  useProducts,
  useStartPicking,
} from "../../lib/queries";
import { subscribe } from "../../lib/realtime";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import type { ItemStatus } from "../../types/order";

const itemStatusLabel: Record<ItemStatus, string> = {
  PENDING: "Pending",
  PICKED: "Picked",
  AWAITING_SUBSTITUTE: "Awaiting customer",
  SUBSTITUTED: "Substituted",
  REFUNDED: "Refunded",
};

export function PickerOrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const order = useOrder(orderId ?? "");
  const products = useProducts();
  const productNameById = new Map((products.data ?? []).map((p) => [p.id, p.name]));

  const startPicking = useStartPicking();
  const markShort = useMarkItemShort();
  const pack = usePackOrder();
  const dispatchOrder = useDispatchOrder();

  useEffect(() => {
    if (orderId) subscribe(`order:${orderId}`);
  }, [orderId]);

  if (!orderId) {
    return <p className="text-slate-500">No order specified.</p>;
  }

  if (order.isPending) {
    return <div className="h-32 animate-pulse rounded-md bg-slate-100" />;
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
        <Link to="/picker" className="text-sm text-slate-500 underline">
          Back to queue
        </Link>
      </div>
    );
  }

  const canStartPicking = order.data.status === "PLACED";
  // Packing is what finalizes any still-PENDING item to PICKED (there's no
  // separate "mark picked" action — see backend/internal/orders/repository.go
  // MarkRemainingItemsPicked), so it's available any time the order is
  // PICKING, not gated on every item having already been individually
  // resolved.
  const canPack = order.data.status === "PICKING";
  const canDispatch = order.data.status === "PACKED";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link to="/picker" className="text-sm text-slate-500 underline">
          ← Back to queue
        </Link>
        <ConnectionBadge />
      </div>

      <h1 className="text-xl font-semibold text-slate-800">Order #{order.data.id.slice(0, 8)}</h1>
      <p className="text-slate-500">
        {order.data.status} · {formatPaise(order.data.totalPaise)}
      </p>

      <ul className="my-4 divide-y divide-slate-100 rounded-md border border-slate-100">
        {order.data.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between px-4 py-3">
            <span className="text-slate-800">
              {productNameById.get(item.productId) ?? item.productId} × {item.qty}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">{itemStatusLabel[item.status]}</span>
              {item.status === "PENDING" && order.data.status === "PICKING" && (
                <button
                  type="button"
                  onClick={() => markShort.mutate({ orderId, itemId: item.id, shortQty: item.qty })}
                  disabled={markShort.isPending}
                  className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Mark short
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex gap-3">
        {canStartPicking && (
          <button
            type="button"
            onClick={() => startPicking.mutate(orderId)}
            disabled={startPicking.isPending}
            className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Start picking
          </button>
        )}
        {canPack && (
          <button
            type="button"
            onClick={() => pack.mutate(orderId)}
            disabled={pack.isPending}
            className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Pack
          </button>
        )}
        {canDispatch && (
          <button
            type="button"
            onClick={() => dispatchOrder.mutate(orderId)}
            disabled={dispatchOrder.isPending}
            className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Dispatch
          </button>
        )}
      </div>
    </div>
  );
}
