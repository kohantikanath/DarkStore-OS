-- +goose Up
-- gen_random_uuid() lives in pgcrypto; enabling it explicitly keeps this
-- migration portable across Postgres versions/hosts (local Docker and Neon).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE products (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    price_paise INTEGER NOT NULL CHECK (price_paise > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_category ON products (category);

CREATE TABLE stock (
    product_id UUID PRIMARY KEY REFERENCES products (id) ON DELETE CASCADE,
    available  INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0),
    reserved   INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0)
);

CREATE TABLE orders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- PLACED -> PICKING -> PACKED -> DISPATCHED (enforced in Go, checked again here
    -- as a last line of defense against a bad insert/update).
    status      TEXT NOT NULL DEFAULT 'PLACED'
                CHECK (status IN ('PLACED', 'PICKING', 'PACKED', 'DISPATCHED')),
    -- Bumped by 1 on every change to the order or any of its items; the frontend
    -- uses this to ignore out-of-order WebSocket events.
    version     INTEGER NOT NULL DEFAULT 1,
    total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_created_at ON orders (created_at DESC);

CREATE TABLE order_items (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id               UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id             UUID NOT NULL REFERENCES products (id),
    qty                    INTEGER NOT NULL CHECK (qty > 0),
    status                 TEXT NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN (
                               'PENDING', 'PICKED', 'AWAITING_SUBSTITUTE',
                               'SUBSTITUTED', 'REFUNDED'
                           )),
    substitute_product_id  UUID REFERENCES products (id),
    substitute_options     JSONB,
    expires_at             TIMESTAMPTZ
);

CREATE INDEX idx_order_items_order_id ON order_items (order_id);

-- Lets the 2-second expiry ticker (Phase 3) find due substitutions without a
-- full table scan; only rows actually waiting on a customer match this index.
CREATE INDEX idx_order_items_awaiting_substitute_expiry
    ON order_items (expires_at)
    WHERE status = 'AWAITING_SUBSTITUTE';

CREATE TABLE idempotency_keys (
    key           TEXT PRIMARY KEY,
    response_json JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE idempotency_keys;
DROP TABLE order_items;
DROP TABLE orders;
DROP TABLE stock;
DROP TABLE products;
