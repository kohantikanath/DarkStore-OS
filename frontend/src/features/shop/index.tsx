import { Route, Routes } from "react-router-dom";

import { AppHeader } from "../../components/AppHeader";
import { CatalogPage } from "./CatalogPage";
import { OrderTrackerPage } from "./OrderTrackerPage";

// Mounted at "/shop/*" (see App.tsx), so paths here are relative to /shop.
export default function ShopApp() {
  return (
    <div>
      <AppHeader />
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <Routes>
          <Route path="/" element={<CatalogPage />} />
          <Route path="order/:orderId" element={<OrderTrackerPage />} />
        </Routes>
      </main>
    </div>
  );
}
