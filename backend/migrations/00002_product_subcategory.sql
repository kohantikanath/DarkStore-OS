-- +goose Up
-- Backing field for finer-grained substitute matching: two products in the
-- same broad category (e.g. "Dairy") can still be poor substitutes for each
-- other (butter for milk), so substitution now prefers a same-subcategory
-- match first, falling back to same-category only when that finds nothing.
--
-- NOT NULL with a DEFAULT of '' (rather than nullable) so existing rows
-- satisfy the constraint at migration time without needing a backfill
-- step here — cmd/seed always truncates and reinserts the whole catalog,
-- and the seed catalog is updated in this same change to fill in a real
-- subcategory for every product, so '' never actually persists past the
-- next `go run ./cmd/seed`.
ALTER TABLE products ADD COLUMN subcategory TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_products_subcategory ON products (subcategory);

-- +goose Down
DROP INDEX idx_products_subcategory;
ALTER TABLE products DROP COLUMN subcategory;
