-- ============================================================
-- 052_public_retail_catalog.sql — public retail-shop RPC
--
-- Phase 1 of the Square Online replica: public-facing skateOS retail
-- shop at shop.skateos.com (or shop.<tenant>.com). Customers browse
-- in-stock products + check out via Helcim hosted invoice.
--
-- This migration adds a SECURITY DEFINER RPC that returns ONLY the
-- public-safe whitelist of product fields. RLS on `products` is staff-
-- only (mig 001) — keeping it that way + funneling anon access through
-- this RPC avoids accidentally exposing cost / internal notes / staff
-- audit data.
--
-- Returns ONLY: id, name, brand, price, retail (when discounted), image,
-- category, sku, description, in-stock band ('high'/'med'/'low'/'limited').
-- Excludes: cost, profit margin, internal notes, supplier, low_stock_threshold.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public_retail_catalog(
  p_category TEXT DEFAULT NULL,
  p_search   TEXT DEFAULT NULL,
  p_limit    INT  DEFAULT 200
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN p_limit := 200; END IF;

  WITH filtered AS (
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'active'
      AND COALESCE(p.quantity, 0) > 0
      AND (p_category IS NULL OR c.name ILIKE p_category)
      AND (p_search IS NULL OR (
        p.name ILIKE '%' || p_search || '%'
        OR p.brand ILIKE '%' || p_search || '%'
        OR p.sku ILIKE '%' || p_search || '%'
      ))
    ORDER BY
      CASE WHEN p.image_url IS NOT NULL AND LENGTH(p.image_url) > 0 THEN 0 ELSE 1 END,
      p.name
    LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',          id,
    'name',        name,
    'brand',       brand,
    'sku',         sku,
    'price',       price,
    'retail',      CASE WHEN retail_price > price THEN retail_price ELSE NULL END,
    'image',       image_url,
    'category',    category_name,
    'description', description,
    -- Stock-availability band (privacy: don't leak exact qty)
    'availability', CASE
      WHEN quantity > 10 THEN 'in_stock'
      WHEN quantity > 3  THEN 'low_stock'
      WHEN quantity > 0  THEN 'limited'
      ELSE 'sold_out'
    END
  )), '[]'::jsonb) INTO result
  FROM filtered;

  RETURN jsonb_build_object(
    'products',  result,
    'count',     COALESCE(jsonb_array_length(result), 0)
  );
END $$;

-- Public-readable categories list (so the storefront filter dropdown can render).
-- Categories are not sensitive — RLS already allows anon read on most installs,
-- but we add a focused RPC anyway to keep the public surface consistent.
CREATE OR REPLACE FUNCTION public_retail_categories()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  -- Only return categories that have at least one in-stock active product
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name), '[]'::jsonb)
    INTO result
    FROM categories
    WHERE id IN (
      SELECT DISTINCT category_id FROM products
      WHERE status = 'active' AND COALESCE(quantity, 0) > 0 AND category_id IS NOT NULL
    );
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public_retail_catalog(TEXT, TEXT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public_retail_categories() TO anon, authenticated;

-- Smoke test on apply: should return JSON shape
SELECT public_retail_catalog(NULL, NULL, 5);
