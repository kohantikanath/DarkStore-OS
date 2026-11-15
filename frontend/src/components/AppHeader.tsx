import { useNavigate } from "react-router-dom";

import { roleHome, roles } from "../lib/roles";
import { useRoleStore } from "../stores/role";
import { ConnectionBadge } from "./ConnectionBadge";

export function AppHeader() {
  const role = useRoleStore((s) => s.role);
  const setRole = useRoleStore((s) => s.setRole);
  const navigate = useNavigate();

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 bg-paper px-4 py-3 sm:px-6">
      <span className="text-lg font-semibold text-ink">DarkStore OS</span>

      {role && (
        <div
          role="group"
          aria-label="Switch role"
          className="inline-flex items-center gap-1 rounded-full bg-ink/5 p-1 order-3 w-full justify-center sm:order-none sm:w-auto"
        >
          {roles.map((r) => (
            <button
              key={r.role}
              type="button"
              aria-pressed={role === r.role}
              onClick={() => {
                setRole(r.role);
                navigate(roleHome[r.role]);
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition sm:px-3.5 ${
                role === r.role ? "bg-crate text-white shadow-sm" : "text-ink/70 hover:text-ink"
              }`}
            >
              <span className="sm:hidden">{r.shortLabel}</span>
              <span className="hidden sm:inline">{r.label}</span>
            </button>
          ))}
        </div>
      )}

      <ConnectionBadge />
    </header>
  );
}
