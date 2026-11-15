import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";

import { useRoleStore, type Role } from "../stores/role";

// Route guard: a customer who types /ops into the address bar gets bounced
// to the role switcher rather than seeing the manager's screen. There's no
// real auth behind this (fake login, per the spec) — it's a UX guard, not a
// security boundary.
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const currentRole = useRoleStore((s) => s.role);

  if (currentRole !== role) {
    return <Navigate to="/" replace />;
  }

  return children;
}
