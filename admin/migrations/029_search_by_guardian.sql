-- ============================================================
-- 029_search_by_guardian.sql — front-desk search includes parent_name
--
-- Common scenario: parent calls and says "Hi, this is Sarah,
-- Tommy's mom" — front desk types "Sarah" but Sarah isn't a customer
-- (Tommy is). Without parent_name in the search predicate, the front
-- desk has to ask the kid's name, which slows everything.
--
-- This re-extends search_customers (last touched in migration 026)
-- to also match against `parent_name` on customers — same shape as the
-- name/email/phone match: prefix on lower(parent_name) plus a fuzzy
-- substring match.
--
-- Idempotent. Safe to re-run.
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
  waiver_expires_at TIMESTAMPTZ,
  total_spent NUMERIC,
  last_visit_at TIMESTAMPTZ,
  loyalty_points INT,
  photo_url TEXT,
  parent_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id, first_name, last_name, name, email, phone,
    dob, waiver_signed_at, waiver_expires_at,
    total_spent, last_visit_at,
    loyalty_points, photo_url, parent_name
  FROM customers
  WHERE
    q IS NULL OR q = ''
    OR lower(first_name)   LIKE lower(q) || '%'
    OR lower(last_name)    LIKE lower(q) || '%'
    OR lower(email)        LIKE '%' || lower(q) || '%'
    OR phone               LIKE '%' || regexp_replace(q, '\D', '', 'g') || '%'
    OR lower(name)         LIKE '%' || lower(q) || '%'
    OR lower(parent_name)  LIKE '%' || lower(q) || '%'
  ORDER BY
    CASE WHEN lower(first_name)  = lower(q) THEN 0
         WHEN lower(first_name)  LIKE lower(q) || '%' THEN 1
         WHEN lower(last_name)   = lower(q) THEN 2
         WHEN lower(last_name)   LIKE lower(q) || '%' THEN 3
         WHEN lower(parent_name) LIKE lower(q) || '%' THEN 4
         ELSE 5
    END,
    last_visit_at DESC NULLS LAST,
    name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_customers(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_customers(TEXT) TO authenticated, anon;
