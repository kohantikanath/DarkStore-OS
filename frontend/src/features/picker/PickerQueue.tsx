import { useEffect } from "react";
import { Link } from "react-router-dom";

import { formatPaise } from "../../lib/cart";
import { useOrders } from "../../lib/queries";
import { subscribe } from "../../lib/realtime";

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
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  }

  if (orders.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-slate-600">Couldn't load orders.</p>
        <button
          type="button"
          onClick={() => orders.refetch()}
          className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-700"
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
    return <p className="text-slate-500">No orders waiting to be picked right now.</p>;
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-800">Picker queue</h1>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
        {actionable.map((order) => (
          <li key={order.id}>
            <Link
              to={`/picker/order/${order.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50"
            >
              <span className="font-mono text-xs text-slate-500">{order.id.slice(0, 8)}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {order.status}
              </span>
              <span className="text-slate-500">{order.itemCount} items</span>
              <span className="text-slate-800">{formatPaise(order.totalPaise)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
