// Display-only — not part of the Product type the API/Zod schema defines
// (types/product.ts), so adding or changing an emoji here can never affect
// what's sent to or parsed from the backend. Keyed by category first (every
// product has one), with a couple of name-keyed overrides for items that
// read oddly under their category's default.
const CATEGORY_EMOJI: Record<string, string> = {
  Dairy: "🥛",
  Bakery: "🍞",
  "Fruits & Vegetables": "🥦",
  Snacks: "🍿",
  Beverages: "🥤",
};

const NAME_EMOJI: Record<string, string> = {
  "Amul Paneer 200g": "🧀",
  "Banana Robusta 1 Dozen": "🍌",
  "Apple Shimla 1kg": "🍎",
  "Onion 1kg": "🧅",
  "Potato 1kg": "🥔",
  "Tomato 1kg": "🍅",
  "Carrot 500g": "🥕",
  "Red Bull Energy Drink 250ml": "⚡",
  "Bisleri Water 1L": "💧",
};

export function productEmoji(name: string, category: string): string {
  return NAME_EMOJI[name] ?? CATEGORY_EMOJI[category] ?? "🛒";
}
