package main

// product is the seed-time shape of a catalog item. pricePaise is written out
// in rupees in the comments next to each entry for readability; the stored
// value is always paise (rupees * 100), per the "money is always an integer"
// rule.
type product struct {
	name        string
	category    string
	subcategory string
	pricePaise  int
}

const (
	categoryDairy    = "Dairy"
	categoryBakery   = "Bakery"
	categoryProduce  = "Fruits & Vegetables"
	categorySnacks   = "Snacks"
	categoryBeverage = "Beverages"
)

// catalog is ~43 realistic Indian grocery items across 5 categories.
// Subcategories are true product types, not coarse groupings — Onion and
// Potato are not substitutes for each other just because both are
// vegetables, so each gets its own subcategory. Substitution only ever
// matches within a subcategory (no category-level fallback): a wrong
// substitute is worse than a refund. Milk, Curd, Bread, Chips & Namkeen,
// Biscuits, Soft Drinks, and Juice have real same-subcategory alternates;
// Butter, Paneer, and Water each get a second brand below so the demo has
// something to offer instead of an immediate refund; the rest (Rusk, Pav,
// Cake, Popcorn, Energy Drinks, and every single-SKU produce type) are
// deliberately singletons, so the no-candidates-found → refund path has
// real cases to exercise too, not just the happy path.
var catalog = []product{
	// Dairy
	{"Amul Toned Milk 500ml", categoryDairy, "Milk", 2700},
	{"Amul Gold Full Cream Milk 500ml", categoryDairy, "Milk", 3300},
	{"Mother Dairy Toned Milk 500ml", categoryDairy, "Milk", 2600},
	{"Nestle a+ Toned Milk 500ml", categoryDairy, "Milk", 2800},
	{"Amul Butter 100g", categoryDairy, "Butter", 5800},
	{"Mother Dairy Butter 100g", categoryDairy, "Butter", 5500},
	{"Mother Dairy Curd 400g", categoryDairy, "Curd", 4500},
	{"Amul Masti Dahi 400g", categoryDairy, "Curd", 4200},
	{"Amul Paneer 200g", categoryDairy, "Paneer", 9000},
	{"Mother Dairy Paneer 200g", categoryDairy, "Paneer", 8500},

	// Bakery
	{"Britannia White Bread 400g", categoryBakery, "Bread", 4500},
	{"Modern White Bread 400g", categoryBakery, "Bread", 4200},
	{"Britannia Brown Bread 400g", categoryBakery, "Bread", 5500},
	{"Harvest Gold Multigrain Bread 400g", categoryBakery, "Bread", 6000},
	{"English Oven Burger Buns 4pc", categoryBakery, "Buns", 4000},
	{"Britannia Rusk 200g", categoryBakery, "Rusk", 4500},
	{"Monginis Pav 6pc", categoryBakery, "Pav", 3000},
	{"Britannia Cake Slice 50g", categoryBakery, "Cake", 2500},

	// Fruits & Vegetables — each its own subcategory: an onion is not a
	// substitute for a potato just because both are vegetables.
	{"Onion 1kg", categoryProduce, "Onion", 3500},
	{"Potato 1kg", categoryProduce, "Potato", 3000},
	{"Carrot 500g", categoryProduce, "Carrot", 3000},
	{"Tomato 1kg", categoryProduce, "Tomato", 4000},
	{"Cucumber 500g", categoryProduce, "Cucumber", 2500},
	{"Spinach Bunch 250g", categoryProduce, "Spinach", 2000},
	{"Banana Robusta 1 Dozen", categoryProduce, "Banana", 5500},
	{"Apple Shimla 1kg", categoryProduce, "Apple", 16000},

	// Snacks
	{"Lays Classic Salted 52g", categorySnacks, "Chips & Namkeen", 2000},
	{"Lays Magic Masala 52g", categorySnacks, "Chips & Namkeen", 2000},
	{"Kurkure Masala Munch 55g", categorySnacks, "Chips & Namkeen", 2000},
	{"Haldiram Aloo Bhujia 200g", categorySnacks, "Chips & Namkeen", 5500},
	{"Bingo Mad Angles 72g", categorySnacks, "Chips & Namkeen", 2000},
	{"Parle-G Biscuits 200g", categorySnacks, "Biscuits", 2000},
	{"Britannia Good Day Biscuits 150g", categorySnacks, "Biscuits", 3000},
	{"Act II Popcorn Classic Salted 70g", categorySnacks, "Popcorn", 4000},

	// Beverages
	{"Coca-Cola 750ml", categoryBeverage, "Soft Drinks", 4000},
	{"Pepsi 750ml", categoryBeverage, "Soft Drinks", 4000},
	{"Sprite 750ml", categoryBeverage, "Soft Drinks", 4000},
	{"Real Mixed Fruit Juice 1L", categoryBeverage, "Juice", 11000},
	{"Tropicana Orange Juice 1L", categoryBeverage, "Juice", 11500},
	{"Paper Boat Aamras 200ml", categoryBeverage, "Juice", 3000},
	{"Bisleri Water 1L", categoryBeverage, "Water", 2000},
	{"Kinley Water 1L", categoryBeverage, "Water", 1900},
	{"Red Bull Energy Drink 250ml", categoryBeverage, "Energy Drinks", 12500},
}
