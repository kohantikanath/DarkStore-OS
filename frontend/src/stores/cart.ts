import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CartState {
  // productId -> qty only — never a price. Prices always come from the
  // products query cache (lib/cart.ts's computeCartSummary), so the cart
  // can't ever drift from the catalog's current prices.
  items: Record<string, number>;
  setQty: (productId: string, qty: number) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: {},

      setQty: (productId, qty) =>
        set((state) => {
          if (qty <= 0) {
            const next = { ...state.items };
            delete next[productId];
            return { items: next };
          }
          return { items: { ...state.items, [productId]: qty } };
        }),

      increment: (productId) => {
        get().setQty(productId, (get().items[productId] ?? 0) + 1);
      },

      decrement: (productId) => {
        get().setQty(productId, (get().items[productId] ?? 0) - 1);
      },

      clear: () => set({ items: {} }),
    }),
    { name: "darkstore-os-cart" },
  ),
);
