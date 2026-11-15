import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { RequireRole } from "./components/RequireRole";
import { RoleSwitcher } from "./pages/RoleSwitcher";

// Lazy-loaded per role (frontend rule 12) — a customer's browser never
// downloads the picker or ops bundles, and vice versa.
const ShopApp = lazy(() => import("./features/shop"));
const PickerApp = lazy(() => import("./features/picker"));
const OpsApp = lazy(() => import("./features/ops"));

function RouteFallback() {
  return <div className="p-8 text-slate-500">Loading…</div>;
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<RoleSwitcher />} />
          <Route
            path="/shop/*"
            element={
              <RequireRole role="customer">
                <ShopApp />
              </RequireRole>
            }
          />
          <Route
            path="/picker/*"
            element={
              <RequireRole role="picker">
                <PickerApp />
              </RequireRole>
            }
          />
          <Route
            path="/ops/*"
            element={
              <RequireRole role="manager">
                <OpsApp />
              </RequireRole>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
