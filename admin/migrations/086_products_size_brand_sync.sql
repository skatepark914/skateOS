-- 086_products_size_brand_sync.sql
-- ============================================================
-- Closes the Square catalog parity gaps:
--  1. Adds a structured `size` column (deck width etc.) — previously
--     size only lived inside the product name.
--  2. Ensures `brand` exists (it already does; no-op if so).
--  3. Adds a UNIQUE index on square_catalog_id so square-import can
--     UPSERT (update price / stock / name on existing items) instead
--     of being insert-only. This is what makes ongoing sync work.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS size  text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand text;

-- Plain unique index (NOT partial) so it satisfies ON CONFLICT in square-import's
-- upsert. Postgres treats NULLs as distinct, so the many non-Square / manually-added
-- products (NULL square_catalog_id) are still allowed — only non-null IDs are unique.
CREATE UNIQUE INDEX IF NOT EXISTS products_square_catalog_uniq
  ON products (square_catalog_id);

-- Helpful for the storefront size filter + admin size lookups.
CREATE INDEX IF NOT EXISTS products_size_idx ON products (size) WHERE size IS NOT NULL;

DO $$ BEGIN RAISE NOTICE '086 applied: size + brand columns + square_catalog_id unique index ready'; END $$;
