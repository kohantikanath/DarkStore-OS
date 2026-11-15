import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { formatPaise } from "../../lib/cart";
import { StatusPill } from "../../components/StatusPill";
import type { OrderSummary } from "../../types/order";

const ROW_HEIGHT = 56;
const VISIBLE_HEIGHT = 560;

// TanStack Virtual only renders the rows actually in (or near) the viewport,
// so this stays smooth whether `orders` has 10 rows or 10,000.
export function OrdersTable({ orders }: { orders: OrderSummary[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-ink/10">
      <div className="grid grid-cols-6 gap-2 border-b border-ink/10 bg-ink/[0.03] px-4 py-2.5 text-xs font-medium text-ink/70">
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
// changes.
const OrderRow = memo(function OrderRow({
  order,
  style,
}: {
  order: OrderSummary;
  style: CSSProperties;
}) {
  const isPulsing = useLiveUpdatePulse(order.version);

  return (
    <div
      style={style}
      className={`grid grid-cols-6 items-center gap-2 border-b border-ink/5 px-4 text-sm text-ink/80 ${
        isPulsing ? "pulse-live" : ""
      }`}
    >
      <span className="truncate font-display tabular-nums text-ink/70">
        #{order.id.slice(0, 8)}
      </span>
      <span>
        <StatusPill status={order.status} />
      </span>
      <span className="font-display tabular-nums">{order.version}</span>
      <span className="font-display tabular-nums">{order.itemCount}</span>
      <span className="font-display tabular-nums">{formatPaise(order.totalPaise)}</span>
      <span className="text-xs text-ink/70">{new Date(order.updatedAt).toLocaleTimeString()}</span>
    </div>
  );
});

// A brief highlight when a row's version changes under it — purely visual,
// never the thing that decides whether the change is real (that's the
// version-gated cache patching in lib/cache.ts). Fires only for a row
// that's currently mounted (visible or within the virtualizer's overscan)
// when the change arrives; a row scrolled far out of view just shows its
// new data next time it's scrolled back in, with no pulse to catch up on.
function useLiveUpdatePulse(version: number): boolean {
  const previousVersion = useRef(version);
  const [isPulsing, setIsPulsing] = useState(false);

  useEffect(() => {
    if (previousVersion.current === version) return;
    previousVersion.current = version;
    setIsPulsing(true);
    const timer = setTimeout(() => setIsPulsing(false), 1400);
    return () => clearTimeout(timer);
  }, [version]);

  return isPulsing;
}
