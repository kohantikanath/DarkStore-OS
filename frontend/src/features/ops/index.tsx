import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { ConnectionBadge } from "../../components/ConnectionBadge";
import { simulateOrder } from "../../lib/api";
import { useOrders } from "../../lib/queries";
import { subscribe } from "../../lib/realtime";
import { useOpsFiltersStore, type StatusFilter } from "../../stores/opsFilters";
import { OrdersTable } from "./OrdersTable";

const statusOptions: StatusFilter[] = ["ALL", "PLACED", "PICKING", "PACKED", "DISPATCHED"];
const SIMULATE_INTERVAL_MS = 3000;

export default function OpsApp() {
  const orders = useOrders();

  const status = useOpsFiltersStore((s) => s.status);
  const setStatus = useOpsFiltersStore((s) => s.setStatus);
  const search = useOpsFiltersStore((s) => s.search);
  const setSearch = useOpsFiltersStore((s) => s.setSearch);

  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    subscribe("ops");
  }, []);

  useEffect(() => {
    if (!simulating) return;

    const id = setInterval(() => {
      simulateOrder().catch((err: unknown) => {
        console.error("simulate: failed to create a demo order", err);
      });
    }, SIMULATE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [simulating]);

  const filtered = useMemo(() => {
    let list = orders.data ?? [];
    if (status !== "ALL") list = list.filter((o) => o.status === status);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((o) => o.id.toLowerCase().includes(q));
    }
    return list;
  }, [orders.data, status, search]);

  return (
    <div>
      <AppHeader />
      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-800">Store Manager — Ops</h1>
          <ConnectionBadge />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search by order id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />

          <span className="text-sm text-slate-500">
            {orders.data ? `${filtered.length} / ${orders.data.length} orders` : null}
          </span>

          <button
            type="button"
            onClick={() => setSimulating((s) => !s)}
            className={`ml-auto rounded-md px-4 py-1.5 text-sm font-medium text-white ${
              simulating ? "bg-red-600 hover:bg-red-700" : "bg-slate-800 hover:bg-slate-700"
            }`}
          >
            {simulating ? "Stop simulating" : "Simulate"}
          </button>
        </div>

        {orders.isPending && <p className="text-slate-500">Loading orders…</p>}

        {orders.isError && (
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
        )}

        {orders.isSuccess && filtered.length === 0 && (
          <p className="text-slate-500">No orders match these filters.</p>
        )}

        {orders.isSuccess && filtered.length > 0 && <OrdersTable orders={filtered} />}
      </main>
    </div>
  );
}
