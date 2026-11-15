import { AppHeader } from "../../components/AppHeader";

// Placeholder — the real catalog/cart/checkout/tracker screen lands in
// Phase 6. This exists now purely to prove the route/role/lazy-load
// plumbing works end to end.
export default function ShopApp() {
  return (
    <div>
      <AppHeader />
      <main className="p-8 text-slate-600">
        <h1 className="text-xl font-semibold text-slate-800">Shop</h1>
        <p className="mt-2">Catalog, cart, and checkout arrive in Phase 6.</p>
      </main>
    </div>
  );
}
