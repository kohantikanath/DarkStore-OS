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
import { StatusPill } from "../../components/StatusPill";
import { useRemainingSeconds } from "../../lib/useCountdown";
import type { ItemStatus, OrderItem } from "../../types/order";

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
    return <p className="text-ink/70">No order specified.</p>;
  }

  if (order.isPending) {
    return <div className="h-32 animate-pulse rounded-xl bg-ink/5" />;
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
        <Link to="/picker" className="text-sm font-medium text-crate underline">
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
      <Link to="/picker" className="text-sm font-medium text-crate underline">
        ← Back to queue
      </Link>

      <div className="mt-3 flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">
          Order #{order.data.id.slice(0, 8)}
        </h1>
        <p className="font-display text-xl font-semibold tabular-nums text-ink/70">
          {formatPaise(order.data.totalPaise)}
        </p>
      </div>
      <StatusPill status={order.data.status} />

      <ul className="my-4 space-y-2">
        {order.data.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            productName={productNameById.get(item.productId) ?? item.productId}
            onMarkShort={() => markShort.mutate({ orderId, itemId: item.id, shortQty: item.qty })}
            isMarking={markShort.isPending}
            canMarkShort={item.status === "PENDING" && order.data.status === "PICKING"}
          />
        ))}
      </ul>

      <div className="flex gap-3">
        {canStartPicking && (
          <button
            type="button"
            onClick={() => startPicking.mutate(orderId)}
            disabled={startPicking.isPending}
            className="min-h-12 rounded-full bg-crate px-6 font-medium text-white hover:bg-crate-dark disabled:opacity-50"
          >
            Start picking
          </button>
        )}
        {canPack && (
          <button
            type="button"
            onClick={() => pack.mutate(orderId)}
            disabled={pack.isPending}
            className="min-h-12 rounded-full bg-crate px-6 font-medium text-white hover:bg-crate-dark disabled:opacity-50"
          >
            Pack
          </button>
        )}
        {canDispatch && (
          <button
            type="button"
            onClick={() => dispatchOrder.mutate(orderId)}
            disabled={dispatchOrder.isPending}
            className="min-h-12 rounded-full bg-crate px-6 font-medium text-white hover:bg-crate-dark disabled:opacity-50"
          >
            Dispatch
          </button>
        )}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  productName,
  onMarkShort,
  isMarking,
  canMarkShort,
}: {
  item: OrderItem;
  productName: string;
  onMarkShort: () => void;
  isMarking: boolean;
  canMarkShort: boolean;
}) {
  const awaiting = item.status === "AWAITING_SUBSTITUTE";

  return (
    <li
      className={`flex min-h-14 items-center justify-between gap-3 rounded-xl bg-white py-3 pr-4 pl-4 ring-1 ${
        awaiting ? "border-l-4 border-l-safety ring-ink/10" : "ring-ink/10"
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-ink">{productName}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <StatusPill status={item.status} label={itemStatusLabel[item.status]} />
          {awaiting && item.expiresAt && <AwaitingCountdown expiresAt={item.expiresAt} />}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="font-display text-2xl font-semibold tabular-nums text-ink">
          {item.qty}
        </span>
        {canMarkShort && (
          <button
            type="button"
            onClick={onMarkShort}
            disabled={isMarking}
            className="min-h-12 shrink-0 rounded-full border-2 border-alert px-4 text-sm font-medium text-alert-dark hover:bg-alert/5 disabled:opacity-50"
          >
            Short
          </button>
        )}
      </div>
    </li>
  );
}

function AwaitingCountdown({ expiresAt }: { expiresAt: string }) {
  const remaining = useRemainingSeconds(expiresAt);
  return (
    <span className="font-display text-xs font-semibold tabular-nums text-safety-dark">
      {remaining > 0 ? `${remaining}s left` : "expiring…"}
    </span>
  );
}
