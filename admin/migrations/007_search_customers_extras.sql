-- ============================================================
-- 007_search_customers_extras.sql
-- Extend search_customers RPC to return fields the UI is already
-- trying to consume but never received. Three pre-existing bugs:
--
--   1. Mobile + admin show a "no waiver" warning on search hits
--      based on `customer.waiver_signed_at` — but the RPC didn't
--      return it. Result: warning fired for ALL hits incorrectly
--      (mobile) or never fired (admin: undefined → falsy → no chip).
--
--   2. Admin shows a "minor" chip via `ciIsMinor(c)` which reads
--      `c.dob` — but the RPC didn't return dob. Result: minors
--      silently never tagged at the front desk.
--
--   3. Loyalty (migration 006) added points, but search hits
--      never carry the balance, so staff can't see member tier
--      until after check-in.
--
-- Fix: drop and recreate the function with the three additional
-- columns. Function body is otherwise identical to 003.
--
-- NOTE: Postgres won't let CREATE OR REPLACE change RETURNS TABLE
-- shape — must DROP FUNCTION first. Idempotent because of IF EXISTS.
-- ============================================================

DROP FUNCTION IF EXISTS search_customers(TEXT);

CREATE OR REPLACE FUNCTION search_customers(q TEXT)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  dob DATE,
  waiver_signed_at TIMESTAMPTZ,
  total_spent NUMERIC,
  last_visit_at TIMESTAMPTZ,
  loyalty_points INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id, first_name, last_name, name, email, phone,
    dob, waiver_signed_at,
    total_spent, last_visit_at,
    loyalty_points
  FROM customers
  WHERE
    q IS NULL OR q = ''
    OR lower(first_name)  LIKE lower(q) || '%'
    OR lower(last_name)   LIKE lower(q) || '%'
    OR lower(email)       LIKE '%' || lower(q) || '%'
    OR phone              LIKE '%' || regexp_replace(q, '\D', '', 'g') || '%'
    OR lower(name)        LIKE '%' || lower(q) || '%'
  ORDER BY
    CASE WHEN lower(first_name) = lower(q) THEN 0
         WHEN lower(first_name) LIKE lower(q) || '%' THEN 1
         WHEN lower(last_name)  = lower(q) THEN 2
         WHEN lower(last_name)  LIKE lower(q) || '%' THEN 3
         ELSE 4
    END,
    last_visit_at DESC NULLS LAST,
    name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_customers(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_customers(TEXT) TO authenticated, anon;
