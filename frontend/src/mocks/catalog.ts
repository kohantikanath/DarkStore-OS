// A standalone mock catalog, not literally shared with the backend's seed
// data — but deliberately shaped the same way (5 categories, subcategories
// within each, ≥2 similarly-priced items per subcategory in most cases) so
// the substitution flow has real candidates to find, same as the real
// backend. Subcategory values match backend/cmd/seed/catalog.go's one for
// one, so the two don't quietly drift apart.
import type { Product } from "../types/product";

function id(n: number): string {
  return `mock-product-${n.toString().padStart(2, "0")}`;
}

export const catalog: Product[] = [
  // Dairy
  { id: id(1), name: "Amul Toned Milk 500ml", category: "Dairy", subcategory: "Milk", pricePaise: 2700 },
  { id: id(2), name: "Mother Dairy Toned Milk 500ml", category: "Dairy", subcategory: "Milk", pricePaise: 2600 },
  { id: id(3), name: "Nestle a+ Toned Milk 500ml", category: "Dairy", subcategory: "Milk", pricePaise: 2800 },
  { id: id(4), name: "Amul Butter 100g", category: "Dairy", subcategory: "Butter", pricePaise: 5800 },
  { id: id(5), name: "Amul Masti Dahi 400g", category: "Dairy", subcategory: "Curd", pricePaise: 4200 },
  { id: id(6), name: "Amul Paneer 200g", category: "Dairy", subcategory: "Paneer", pricePaise: 9000 },
  { id: id(7), name: "Mother Dairy Curd 400g", category: "Dairy", subcategory: "Curd", pricePaise: 4500 },
  { id: id(8), name: "Amul Gold Full Cream Milk 500ml", category: "Dairy", subcategory: "Milk", pricePaise: 3300 },

  // Bakery
  { id: id(9), name: "Britannia White Bread 400g", category: "Bakery", subcategory: "Bread", pricePaise: 4500 },
  { id: id(10), name: "Modern White Bread 400g", category: "Bakery", subcategory: "Bread", pricePaise: 4200 },
  { id: id(11), name: "Britannia Brown Bread 400g", category: "Bakery", subcategory: "Bread", pricePaise: 5500 },
  {
    id: id(12),
    name: "Harvest Gold Multigrain Bread 400g",
    category: "Bakery",
    subcategory: "Bread",
    pricePaise: 6000,
  },
  { id: id(13), name: "English Oven Burger Buns 4pc", category: "Bakery", subcategory: "Buns", pricePaise: 4000 },
  { id: id(14), name: "Britannia Rusk 200g", category: "Bakery", subcategory: "Rusk", pricePaise: 4500 },
  { id: id(15), name: "Monginis Pav 6pc", category: "Bakery", subcategory: "Pav", pricePaise: 3000 },
  { id: id(16), name: "Britannia Cake Slice 50g", category: "Bakery", subcategory: "Cake", pricePaise: 2500 },

  // Fruits & Vegetables
  { id: id(17), name: "Onion 1kg", category: "Fruits & Vegetables", subcategory: "Root Vegetables", pricePaise: 3500 },
  {
    id: id(18),
    name: "Potato 1kg",
    category: "Fruits & Vegetables",
    subcategory: "Root Vegetables",
    pricePaise: 3000,
  },
  {
    id: id(19),
    name: "Tomato 1kg",
    category: "Fruits & Vegetables",
    subcategory: "Salad Vegetables",
    pricePaise: 4000,
  },
  { id: id(20), name: "Banana Robusta 1 Dozen", category: "Fruits & Vegetables", subcategory: "Fruits", pricePaise: 5500 },
  { id: id(21), name: "Apple Shimla 1kg", category: "Fruits & Vegetables", subcategory: "Fruits", pricePaise: 16000 },
  {
    id: id(22),
    name: "Spinach Bunch 250g",
    category: "Fruits & Vegetables",
    subcategory: "Leafy Greens",
    pricePaise: 2000,
  },
  {
    id: id(23),
    name: "Cucumber 500g",
    category: "Fruits & Vegetables",
    subcategory: "Salad Vegetables",
    pricePaise: 2500,
  },
  {
    id: id(24),
    name: "Carrot 500g",
    category: "Fruits & Vegetables",
    subcategory: "Root Vegetables",
    pricePaise: 3000,
  },

  // Snacks
  { id: id(25), name: "Lays Classic Salted 52g", category: "Snacks", subcategory: "Chips & Namkeen", pricePaise: 2000 },
  { id: id(26), name: "Lays Magic Masala 52g", category: "Snacks", subcategory: "Chips & Namkeen", pricePaise: 2000 },
  {
    id: id(27),
    name: "Kurkure Masala Munch 55g",
    category: "Snacks",
    subcategory: "Chips & Namkeen",
    pricePaise: 2000,
  },
  {
    id: id(28),
    name: "Haldiram Aloo Bhujia 200g",
    category: "Snacks",
    subcategory: "Chips & Namkeen",
    pricePaise: 5500,
  },
  { id: id(29), name: "Parle-G Biscuits 200g", category: "Snacks", subcategory: "Biscuits", pricePaise: 2000 },
  {
    id: id(30),
    name: "Britannia Good Day Biscuits 150g",
    category: "Snacks",
    subcategory: "Biscuits",
    pricePaise: 3000,
  },
  { id: id(31), name: "Bingo Mad Angles 72g", category: "Snacks", subcategory: "Chips & Namkeen", pricePaise: 2000 },
  {
    id: id(32),
    name: "Act II Popcorn Classic Salted 70g",
    category: "Snacks",
    subcategory: "Popcorn",
    pricePaise: 4000,
  },

  // Beverages
  { id: id(33), name: "Coca-Cola 750ml", category: "Beverages", subcategory: "Soft Drinks", pricePaise: 4000 },
  { id: id(34), name: "Pepsi 750ml", category: "Beverages", subcategory: "Soft Drinks", pricePaise: 4000 },
  { id: id(35), name: "Sprite 750ml", category: "Beverages", subcategory: "Soft Drinks", pricePaise: 4000 },
  {
    id: id(36),
    name: "Real Mixed Fruit Juice 1L",
    category: "Beverages",
    subcategory: "Juice",
    pricePaise: 11000,
  },
  {
    id: id(37),
    name: "Tropicana Orange Juice 1L",
    category: "Beverages",
    subcategory: "Juice",
    pricePaise: 11500,
  },
  { id: id(38), name: "Bisleri Water 1L", category: "Beverages", subcategory: "Water", pricePaise: 2000 },
  {
    id: id(39),
    name: "Red Bull Energy Drink 250ml",
    category: "Beverages",
    subcategory: "Energy Drinks",
    pricePaise: 12500,
  },
  { id: id(40), name: "Paper Boat Aamras 200ml", category: "Beverages", subcategory: "Juice", pricePaise: 3000 },
];

export function findProduct(productId: string): Product | undefined {
  return catalog.find((p) => p.id === productId);
}
