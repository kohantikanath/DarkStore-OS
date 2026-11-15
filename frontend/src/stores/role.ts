import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role = "customer" | "picker" | "manager";

interface RoleState {
  role: Role | null;
  setRole: (role: Role) => void;
  clearRole: () => void;
}

// Client-only state (the "fake login" role), not server state, so it lives
// in Zustand rather than TanStack Query — and persists across reloads so a
// refresh doesn't boot the picker back to the role switcher mid-shift.
export const useRoleStore = create<RoleState>()(
  persist(
    (set) => ({
      role: null,
      setRole: (role) => set({ role }),
      clearRole: () => set({ role: null }),
    }),
    { name: "darkstore-os-role" },
  ),
);
