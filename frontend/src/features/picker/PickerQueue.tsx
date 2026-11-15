import { useEffect } from "react";
import { Link } from "react-router-dom";

import { formatPaise } from "../../lib/cart";
import { useOrders } from "../../lib/queries";
import { subscribe } from "../../lib/realtime";
import { StatusPill } from "../../components/StatusPill";

// Same "ops" channel and ['orders'] cache as the manager's table — a picker
// needs to see new orders arrive and orders drop off once fully picked,
// which is exactly what that channel already broadcasts.
export function PickerQueue() {
  const orders = useOrders();

  useEffect(() => {
    subscribe("ops");
  }, []);

  if (orders.isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-ink/5" />
        ))}
      </div>
    );
  }

  if (orders.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink/70">Couldn't load orders.</p>
        <button
          type="button"
          onClick={() => orders.refetch()}
          className="rounded-md bg-crate px-4 py-2 font-medium text-white hover:bg-crate-dark"
        >
          Retry
        </button>
      </div>
    );
  }

  // A picker only ever acts on orders that still need picking — PACKED and
  // DISPATCHED orders are someone else's concern (or no one's, at this
  // scope). Oldest first: first in, first picked.
  const actionable = orders.data
    .filter((o) => o.status === "PLACED" || o.status === "PICKING")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (actionable.length === 0) {
    return <p className="text-ink/70">No orders waiting to be picked right now.</p>;
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-ink">Picker queue</h1>
      <ul className="space-y-2">
        {actionable.map((order) => (
          <li key={order.id}>
            <Link
              to={`/picker/order/${order.id}`}
              className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-ink/10 transition hover:ring-crate"
            >
              <span className="font-display text-lg font-semibold tabular-nums text-ink">
                #{order.id.slice(0, 8)}
              </span>
              <StatusPill status={order.status} />
              <span className="hidden text-sm text-ink/70 sm:inline">
                {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
              </span>
              <span className="font-display text-lg font-semibold tabular-nums text-ink">
                {formatPaise(order.totalPaise)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
