import { create } from "zustand";

import type { OrderStatus } from "../types/order";

// "AWAITING_SUBSTITUTE" isn't an OrderStatus (the order itself stays
// PICKING while one of its items is) — it's a separate filter mode that
// matches on the summary's derived awaitingSubstitution flag instead.
export type StatusFilter = "ALL" | OrderStatus | "AWAITING_SUBSTITUTE";

interface OpsFiltersState {
  status: StatusFilter;
  search: string;
  setStatus: (status: StatusFilter) => void;
  setSearch: (search: string) => void;
}

// Client-only UI state (not persisted — a filter set while looking at a
// live table isn't something worth remembering across visits).
export const useOpsFiltersStore = create<OpsFiltersState>((set) => ({
  status: "ALL",
  search: "",
  setStatus: (status) => set({ status }),
  setSearch: (search) => set({ search }),
}));
