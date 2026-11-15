// A standalone mock catalog, not literally shared with the backend's seed
// data — but deliberately shaped the same way (5 categories, ≥2
// similarly-priced items per category) so the substitution flow has real
// candidates to find, same as the real backend.
import type { Product } from "../types/product";

function id(n: number): string {
  return `mock-product-${n.toString().padStart(2, "0")}`;
}

export const catalog: Product[] = [
  // Dairy
  { id: id(1), name: "Amul Toned Milk 500ml", category: "Dairy", pricePaise: 2700 },
  { id: id(2), name: "Mother Dairy Toned Milk 500ml", category: "Dairy", pricePaise: 2600 },
  { id: id(3), name: "Nestle a+ Toned Milk 500ml", category: "Dairy", pricePaise: 2800 },
  { id: id(4), name: "Amul Butter 100g", category: "Dairy", pricePaise: 5800 },
  { id: id(5), name: "Amul Masti Dahi 400g", category: "Dairy", pricePaise: 4200 },
  { id: id(6), name: "Amul Paneer 200g", category: "Dairy", pricePaise: 9000 },
  { id: id(7), name: "Mother Dairy Curd 400g", category: "Dairy", pricePaise: 4500 },
  { id: id(8), name: "Amul Gold Full Cream Milk 500ml", category: "Dairy", pricePaise: 3300 },

  // Bakery
  { id: id(9), name: "Britannia White Bread 400g", category: "Bakery", pricePaise: 4500 },
  { id: id(10), name: "Modern White Bread 400g", category: "Bakery", pricePaise: 4200 },
  { id: id(11), name: "Britannia Brown Bread 400g", category: "Bakery", pricePaise: 5500 },
  { id: id(12), name: "Harvest Gold Multigrain Bread 400g", category: "Bakery", pricePaise: 6000 },
  { id: id(13), name: "English Oven Burger Buns 4pc", category: "Bakery", pricePaise: 4000 },
  { id: id(14), name: "Britannia Rusk 200g", category: "Bakery", pricePaise: 4500 },
  { id: id(15), name: "Monginis Pav 6pc", category: "Bakery", pricePaise: 3000 },
  { id: id(16), name: "Britannia Cake Slice 50g", category: "Bakery", pricePaise: 2500 },

  // Fruits & Vegetables
  { id: id(17), name: "Onion 1kg", category: "Fruits & Vegetables", pricePaise: 3500 },
  { id: id(18), name: "Potato 1kg", category: "Fruits & Vegetables", pricePaise: 3000 },
  { id: id(19), name: "Tomato 1kg", category: "Fruits & Vegetables", pricePaise: 4000 },
  { id: id(20), name: "Banana Robusta 1 Dozen", category: "Fruits & Vegetables", pricePaise: 5500 },
  { id: id(21), name: "Apple Shimla 1kg", category: "Fruits & Vegetables", pricePaise: 16000 },
  { id: id(22), name: "Spinach Bunch 250g", category: "Fruits & Vegetables", pricePaise: 2000 },
  { id: id(23), name: "Cucumber 500g", category: "Fruits & Vegetables", pricePaise: 2500 },
  { id: id(24), name: "Carrot 500g", category: "Fruits & Vegetables", pricePaise: 3000 },

  // Snacks
  { id: id(25), name: "Lays Classic Salted 52g", category: "Snacks", pricePaise: 2000 },
  { id: id(26), name: "Lays Magic Masala 52g", category: "Snacks", pricePaise: 2000 },
  { id: id(27), name: "Kurkure Masala Munch 55g", category: "Snacks", pricePaise: 2000 },
  { id: id(28), name: "Haldiram Aloo Bhujia 200g", category: "Snacks", pricePaise: 5500 },
  { id: id(29), name: "Parle-G Biscuits 200g", category: "Snacks", pricePaise: 2000 },
  { id: id(30), name: "Britannia Good Day Biscuits 150g", category: "Snacks", pricePaise: 3000 },
  { id: id(31), name: "Bingo Mad Angles 72g", category: "Snacks", pricePaise: 2000 },
  { id: id(32), name: "Act II Popcorn Classic Salted 70g", category: "Snacks", pricePaise: 4000 },

  // Beverages
  { id: id(33), name: "Coca-Cola 750ml", category: "Beverages", pricePaise: 4000 },
  { id: id(34), name: "Pepsi 750ml", category: "Beverages", pricePaise: 4000 },
  { id: id(35), name: "Sprite 750ml", category: "Beverages", pricePaise: 4000 },
  { id: id(36), name: "Real Mixed Fruit Juice 1L", category: "Beverages", pricePaise: 11000 },
  { id: id(37), name: "Tropicana Orange Juice 1L", category: "Beverages", pricePaise: 11500 },
  { id: id(38), name: "Bisleri Water 1L", category: "Beverages", pricePaise: 2000 },
  { id: id(39), name: "Red Bull Energy Drink 250ml", category: "Beverages", pricePaise: 12500 },
  { id: id(40), name: "Paper Boat Aamras 200ml", category: "Beverages", pricePaise: 3000 },
];

export function findProduct(productId: string): Product | undefined {
  return catalog.find((p) => p.id === productId);
}
