import { Navigate } from "react-router-dom";

import { roleHome, roles } from "../lib/roles";
import { useRoleStore } from "../stores/role";

const roleAccent = {
  customer: "border-l-crate",
  picker: "border-l-safety",
  manager: "border-l-fresh",
} as const;

export function RoleSwitcher() {
  const currentRole = useRoleStore((s) => s.role);
  const setRole = useRoleStore((s) => s.setRole);

  if (currentRole) {
    return <Navigate to={roleHome[currentRole]} replace />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-paper p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold text-ink">DarkStore OS</h1>
        <p className="mt-2 text-ink/70">Pick a role to continue — fake login, for the demo.</p>
      </div>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
        {roles.map(({ role, label, blurb }) => (
          <button
            key={role}
            type="button"
            onClick={() => setRole(role)}
            className={`flex flex-col gap-2 rounded-xl border-l-4 bg-white p-5 text-left ring-1 ring-ink/10 transition hover:ring-ink/20 hover:shadow-md ${roleAccent[role]}`}
          >
            <span className="text-lg font-semibold text-ink">{label}</span>
            <span className="text-sm text-ink/70">{blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
