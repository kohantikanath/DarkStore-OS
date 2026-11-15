import { useNavigate } from "react-router-dom";

import { useRoleStore } from "../stores/role";

const roleLabel = {
  customer: "Customer",
  picker: "Picker",
  manager: "Store Manager",
} as const;

export function AppHeader() {
  const role = useRoleStore((s) => s.role);
  const clearRole = useRoleStore((s) => s.clearRole);
  const navigate = useNavigate();

  return (
    <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
      <span className="font-semibold text-slate-800">DarkStore OS</span>
      <div className="flex items-center gap-3 text-sm text-slate-500">
        {role && <span>{roleLabel[role]}</span>}
        <button
          type="button"
          onClick={() => {
            clearRole();
            navigate("/");
          }}
          className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
        >
          Switch role
        </button>
      </div>
    </header>
  );
}
