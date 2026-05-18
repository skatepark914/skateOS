-- ============================================================
-- Migration 070 — products.brand + products.retail_price columns
--
-- Fixes a long-standing gap: admin/index.html references both
-- columns extensively (brand filter, retail-price "compare-at"
-- discount display, top-products-by-margin reports) but no prior
-- migration ever added them to the products table. Migration 052
-- (public_retail_catalog RPC) JOINs against products.brand and
-- references retail_price — it failed on fresh applies until now.
--
-- Both columns are nullable to stay backward-compatible with the
-- existing 100% null state. The admin treats null/0 as "not set"
-- everywhere.
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS retail_price NUMERIC(10,2);

-- Optional brand index for the inventory page's brand filter (uses
-- DISTINCT against this column to populate the dropdown).
CREATE INDEX IF NOT EXISTS products_brand_idx ON products(brand)
  WHERE brand IS NOT NULL;

-- Smoke probe so the migration leaves a visible trace
DO $$
BEGIN
  RAISE NOTICE 'Migration 070 applied: products.brand + products.retail_price are present';
END $$;
