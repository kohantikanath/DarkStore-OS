import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { simulateOrder } from "../../lib/api";
import { useOrders } from "../../lib/queries";
import { subscribe } from "../../lib/realtime";
import { useOpsFiltersStore, type StatusFilter } from "../../stores/opsFilters";
import { OrdersTable } from "./OrdersTable";

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PLACED", label: "Placed" },
  { value: "PICKING", label: "Picking" },
  { value: "PACKED", label: "Packed" },
  { value: "DISPATCHED", label: "Dispatched" },
  { value: "AWAITING_SUBSTITUTE", label: "Awaiting substitution" },
];
const SIMULATE_INTERVAL_MS = 3000;

export default function OpsApp() {
  const orders = useOrders();

  const status = useOpsFiltersStore((s) => s.status);
  const setStatus = useOpsFiltersStore((s) => s.setStatus);
  const search = useOpsFiltersStore((s) => s.search);
  const setSearch = useOpsFiltersStore((s) => s.setSearch);

  const [simulating, setSimulating] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);

  useEffect(() => {
    subscribe("ops");
  }, []);

  useEffect(() => {
    if (!simulating) return;

    const id = setInterval(() => {
      simulateOrder().catch((err: unknown) => {
        console.error("simulate: failed to create a demo order", err);
        setSimulateError("Couldn't create a demo order — stopped simulating.");
        setSimulating(false);
      });
    }, SIMULATE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [simulating]);

  const searched = useMemo(() => {
    const list = orders.data ?? [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((o) => o.id.toLowerCase().includes(q));
  }, [orders.data, search]);

  // Counts for the filter chips are computed from the search results, not
  // the full list — so typing a search narrows the counts shown on each
  // chip too, rather than showing stale totals for filters that no longer
  // apply to what's on screen.
  const countByStatus = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      ALL: searched.length,
      PLACED: 0,
      PICKING: 0,
      PACKED: 0,
      DISPATCHED: 0,
      AWAITING_SUBSTITUTE: 0,
    };
    for (const order of searched) {
      counts[order.status] += 1;
      if (order.awaitingSubstitution) counts.AWAITING_SUBSTITUTE += 1;
    }
    return counts;
  }, [searched]);

  const filtered = useMemo(() => {
    if (status === "ALL") return searched;
    // AWAITING_SUBSTITUTE isn't an order status (the order itself stays
    // PICKING) — it filters on the derived flag instead.
    if (status === "AWAITING_SUBSTITUTE") return searched.filter((o) => o.awaitingSubstitution);
    return searched.filter((o) => o.status === status);
  }, [searched, status]);

  return (
    <div>
      <AppHeader />
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="mb-4 text-2xl font-semibold text-ink">Store Manager — Ops</h1>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatus(option.value)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                status === option.value
                  ? "bg-crate text-white shadow-sm"
                  : "bg-ink/5 text-ink/70 hover:text-ink"
              }`}
            >
              {option.value === "AWAITING_SUBSTITUTE" && (
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-safety" />
              )}
              {option.label} <span className="tabular-nums">{countByStatus[option.value]}</span>
            </button>
          ))}

          <input
            type="text"
            placeholder="Search by order id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-full border border-ink/15 px-3.5 py-1.5 text-sm focus-visible:border-crate"
          />

          <button
            type="button"
            onClick={() => {
              setSimulateError(null);
              setSimulating((s) => !s);
            }}
            className={`ml-auto rounded-full px-4 py-1.5 text-sm font-medium text-white ${
              simulating ? "bg-alert hover:bg-alert/90" : "bg-crate hover:bg-crate-dark"
            }`}
          >
            {simulating ? "Stop simulating" : "Simulate"}
          </button>
        </div>

        {simulateError && <p className="mb-4 text-sm text-alert-dark">{simulateError}</p>}

        {orders.isPending && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-ink/5" />
            ))}
          </div>
        )}

        {orders.isError && (
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
        )}

        {orders.isSuccess && filtered.length === 0 && (
          <p className="text-ink/70">
            {orders.data.length === 0
              ? "No orders yet — place one from the shop, or hit Simulate above."
              : "No orders match these filters."}
          </p>
        )}

        {orders.isSuccess && filtered.length > 0 && <OrdersTable orders={filtered} />}
      </main>
    </div>
  );
}
