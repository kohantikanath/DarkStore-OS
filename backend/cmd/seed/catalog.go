package main

// product is the seed-time shape of a catalog item. pricePaise is written out
// in rupees in the comments next to each entry for readability; the stored
// value is always paise (rupees * 100), per the "money is always an integer"
// rule.
type product struct {
	name       string
	category   string
	pricePaise int
}

const (
	categoryDairy    = "Dairy"
	categoryBakery   = "Bakery"
	categoryProduce  = "Fruits & Vegetables"
	categorySnacks   = "Snacks"
	categoryBeverage = "Beverages"
)

// catalog is ~40 realistic Indian grocery items across 5 categories, with at
// least 2 similarly priced items per category so the substitution rule
// (same category, price within ±30%) always has candidates to offer.
var catalog = []product{
	// Dairy
	{"Amul Toned Milk 500ml", categoryDairy, 2700},
	{"Amul Gold Full Cream Milk 500ml", categoryDairy, 3300},
	{"Mother Dairy Toned Milk 500ml", categoryDairy, 2600},
	{"Nestle a+ Toned Milk 500ml", categoryDairy, 2800},
	{"Amul Butter 100g", categoryDairy, 5800},
	{"Mother Dairy Curd 400g", categoryDairy, 4500},
	{"Amul Masti Dahi 400g", categoryDairy, 4200},
	{"Amul Paneer 200g", categoryDairy, 9000},

	// Bakery
	{"Britannia White Bread 400g", categoryBakery, 4500},
	{"Modern White Bread 400g", categoryBakery, 4200},
	{"Britannia Brown Bread 400g", categoryBakery, 5500},
	{"Harvest Gold Multigrain Bread 400g", categoryBakery, 6000},
	{"English Oven Burger Buns 4pc", categoryBakery, 4000},
	{"Britannia Rusk 200g", categoryBakery, 4500},
	{"Monginis Pav 6pc", categoryBakery, 3000},
	{"Britannia Cake Slice 50g", categoryBakery, 2500},

	// Fruits & Vegetables
	{"Onion 1kg", categoryProduce, 3500},
	{"Potato 1kg", categoryProduce, 3000},
	{"Tomato 1kg", categoryProduce, 4000},
	{"Banana Robusta 1 Dozen", categoryProduce, 5500},
	{"Apple Shimla 1kg", categoryProduce, 16000},
	{"Spinach Bunch 250g", categoryProduce, 2000},
	{"Cucumber 500g", categoryProduce, 2500},
	{"Carrot 500g", categoryProduce, 3000},

	// Snacks
	{"Lays Classic Salted 52g", categorySnacks, 2000},
	{"Lays Magic Masala 52g", categorySnacks, 2000},
	{"Kurkure Masala Munch 55g", categorySnacks, 2000},
	{"Haldiram Aloo Bhujia 200g", categorySnacks, 5500},
	{"Parle-G Biscuits 200g", categorySnacks, 2000},
	{"Britannia Good Day Biscuits 150g", categorySnacks, 3000},
	{"Bingo Mad Angles 72g", categorySnacks, 2000},
	{"Act II Popcorn Classic Salted 70g", categorySnacks, 4000},

	// Beverages
	{"Coca-Cola 750ml", categoryBeverage, 4000},
	{"Pepsi 750ml", categoryBeverage, 4000},
	{"Sprite 750ml", categoryBeverage, 4000},
	{"Real Mixed Fruit Juice 1L", categoryBeverage, 11000},
	{"Tropicana Orange Juice 1L", categoryBeverage, 11500},
	{"Bisleri Water 1L", categoryBeverage, 2000},
	{"Red Bull Energy Drink 250ml", categoryBeverage, 12500},
	{"Paper Boat Aamras 200ml", categoryBeverage, 3000},
}
