import { memo } from "react";
import type { CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import { formatPaise } from "../../lib/cart";
import type { OrderStatus, OrderSummary } from "../../types/order";

const ROW_HEIGHT = 48;
const VISIBLE_HEIGHT = 560;

const statusStyles: Record<OrderStatus, string> = {
  PLACED: "bg-blue-100 text-blue-800",
  PICKING: "bg-amber-100 text-amber-800",
  PACKED: "bg-purple-100 text-purple-800",
  DISPATCHED: "bg-green-100 text-green-800",
};

// TanStack Virtual only renders the rows actually in (or near) the viewport,
// so this stays smooth whether `orders` has 10 rows or 10,000 — rule 11.
export function OrdersTable({ orders }: { orders: OrderSummary[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  return (
    <div className="rounded-md border border-slate-200">
      <div className="grid grid-cols-6 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>Order</span>
        <span>Status</span>
        <span>Version</span>
        <span>Items</span>
        <span>Total</span>
        <span>Updated</span>
      </div>
      <div ref={parentRef} style={{ height: VISIBLE_HEIGHT }} className="overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => (
            <OrderRow
              key={orders[virtualRow.index].id}
              order={orders[virtualRow.index]}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Memoized: with 10,000+ rows, a row must only re-render when ITS data
// changes, not whenever any other row (or the table's own scroll state)
// changes — rule 11.
const OrderRow = memo(function OrderRow({
  order,
  style,
}: {
  order: OrderSummary;
  style: CSSProperties;
}) {
  return (
    <div
      style={style}
      className="grid grid-cols-6 items-center gap-2 border-b border-slate-100 px-4 text-sm text-slate-700"
    >
      <span className="truncate font-mono text-xs text-slate-500">{order.id.slice(0, 8)}</span>
      <span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[order.status]}`}
        >
          {order.status}
        </span>
      </span>
      <span>{order.version}</span>
      <span>{order.itemCount}</span>
      <span>{formatPaise(order.totalPaise)}</span>
      <span className="text-xs text-slate-500">
        {new Date(order.updatedAt).toLocaleTimeString()}
      </span>
    </div>
  );
});
