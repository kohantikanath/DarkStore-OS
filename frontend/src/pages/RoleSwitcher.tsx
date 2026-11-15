import { Navigate } from "react-router-dom";

import { useRoleStore, type Role } from "../stores/role";

const roleHome: Record<Role, string> = {
  customer: "/shop",
  picker: "/picker",
  manager: "/ops",
};

const roles: { role: Role; label: string; blurb: string }[] = [
  { role: "customer", label: "Customer", blurb: "Browse the shop and track an order" },
  { role: "picker", label: "Picker", blurb: "Pick items for incoming orders" },
  { role: "manager", label: "Store Manager", blurb: "Watch the live order queue" },
];

export function RoleSwitcher() {
  const currentRole = useRoleStore((s) => s.role);
  const setRole = useRoleStore((s) => s.setRole);

  if (currentRole) {
    return <Navigate to={roleHome[currentRole]} replace />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-slate-800">DarkStore OS</h1>
        <p className="mt-1 text-slate-500">Pick a role to continue (fake login, for the demo)</p>
      </div>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
        {roles.map(({ role, label, blurb }) => (
          <button
            key={role}
            type="button"
            onClick={() => setRole(role)}
            className="flex flex-col gap-2 rounded-lg border border-slate-200 p-5 text-left transition hover:border-slate-400 hover:shadow-md"
          >
            <span className="text-lg font-medium text-slate-800">{label}</span>
            <span className="text-sm text-slate-500">{blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
