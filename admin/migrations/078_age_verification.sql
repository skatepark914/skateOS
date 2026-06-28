-- ============================================================
-- 078_age_verification.sql — age-gated products + ID photo
--
-- NY law (PEN §145.65) bans aerosol spray paint sales to under-18s.
-- Doug's policy is stricter: 21+ at 2nd Nature Park. Each sale of a
-- restricted SKU needs:
--   1) Staff confirms the customer's date of birth from a government ID
--   2) Staff takes a photo of the customer holding their ID
--   3) Photo + metadata stamped onto the sale row for audit
--
-- The spray paint SKUs (MTN Hardcore + Water Based 100ml/400ml)
-- get tagged 21+ automatically by this migration.
--
-- Idempotent. Safe to re-run.
-- ============================================================

------------------------------------------------------------
-- 1. Product-level age gate
------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS age_restricted_min   INT,
  ADD COLUMN IF NOT EXISTS age_verify_required  BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.products.age_restricted_min IS
  'Minimum buyer age in years. NULL = no restriction. POS gates sales of this SKU.';
COMMENT ON COLUMN public.products.age_verify_required IS
  'When true, POS requires a photo of customer holding their ID before completing the sale.';

CREATE INDEX IF NOT EXISTS products_age_restricted_idx
  ON public.products(age_restricted_min)
  WHERE age_restricted_min IS NOT NULL;

------------------------------------------------------------
-- 2. Sale-level age verification record
------------------------------------------------------------
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS age_verification JSONB;

COMMENT ON COLUMN public.sales.age_verification IS
  $$JSONB blob — see schema below. Set when the cart had an age-restricted item.
  {
    "verified_by_staff_id": uuid,
    "verified_by_name":     "Doug Brown",
    "verified_at":          "2026-06-06T22:00:00Z",
    "min_age_required":     21,
    "id_type":              "driver_license" | "passport" | "state_id" | "military_id" | "other",
    "id_state_issuer":      "NY" | null,
    "dob_confirmed":        "1998-05-12",
    "computed_age":         28,
    "photo_url":            "https://....storage.../age-id-{sale_id}.jpg",
    "products":             [{"id": uuid, "name": "MTN Hardcore Spray Paint (400ml)", "min_age": 21}],
    "notes":                "ID looked legit, photo matches face"
  }$$;

CREATE INDEX IF NOT EXISTS sales_age_verified_idx
  ON public.sales((age_verification IS NOT NULL))
  WHERE age_verification IS NOT NULL;

------------------------------------------------------------
-- 3. Tag the spray paint SKUs as 21+
------------------------------------------------------------
UPDATE public.products
SET
  age_restricted_min = 21,
  age_verify_required = true
WHERE
  (name ILIKE '%spray paint%' OR name ILIKE '%aerosol%' OR name ILIKE '%mtn hardcore%' OR name ILIKE '%mtn water based%')
  AND status = 'active';

------------------------------------------------------------
-- 4. Helper RPC — list age-restricted products in a cart (for the POS)
--    Pass an array of product UUIDs, get back the restricted ones.
------------------------------------------------------------
DROP FUNCTION IF EXISTS public.products_age_restricted_in_list(UUID[]);
CREATE FUNCTION public.products_age_restricted_in_list(p_ids UUID[])
RETURNS TABLE(id UUID, name TEXT, age_restricted_min INT, age_verify_required BOOLEAN)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT p.id, p.name, p.age_restricted_min, p.age_verify_required
  FROM products p
  WHERE p.id = ANY(p_ids)
    AND p.age_restricted_min IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION public.products_age_restricted_in_list(UUID[]) TO anon, authenticated;

------------------------------------------------------------
-- 5. Verification probe
------------------------------------------------------------
DO $$
DECLARE
  prod_col_exists BOOLEAN;
  sale_col_exists BOOLEAN;
  tagged_count INT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='age_restricted_min') INTO prod_col_exists;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_name='sales' AND column_name='age_verification') INTO sale_col_exists;
  SELECT count(*) FROM products WHERE age_restricted_min IS NOT NULL INTO tagged_count;

  RAISE NOTICE '078 verification: products.age_restricted_min=% sales.age_verification=% tagged_products=%',
    prod_col_exists, sale_col_exists, tagged_count;
END $$;
