-- ============================================================
-- 048_preorder_status_lookup.sql — public pre-order status RPC
--
-- Customer-facing self-serve status page (preorder.skateos.com/status.html)
-- needs to read a single form_submissions row by its UUID without exposing
-- the entire form_submissions table to anon (which would let attackers
-- enumerate other people's orders).
--
-- The submission UUID is the access token — 36 random hex chars, ~10^36
-- keyspace, unguessable. We share it with the customer in their confirmation
-- email, and they visit /status.html?id=<uuid> to see their order status.
--
-- This RPC is SECURITY DEFINER + GRANTed to anon, but returns ONLY the
-- safe-for-public fields:
--   • items list
--   • totals
--   • deposit_status / balance_status
--   • supplier_ordered_at (so customer sees "yes, we placed the supplier order")
--   • fulfillment + is_shipping
--   • submitted_at + first name only (privacy — no email/phone leaked back)
--
-- Internal admin fields (notes, full email, full phone, supplier_ordered_by
-- staff UUID, status workflow strings) are NEVER returned.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION preorder_status_lookup(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  d JSONB;
  contact_name TEXT;
  first_name TEXT;
BEGIN
  -- Look up the submission. Refuse non-preorder submissions (cross-form
  -- access via this RPC would be a privilege escalation).
  SELECT s.*, f.slug AS form_slug
    INTO s
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_id
      AND f.slug = 'preorder-2026'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  d := COALESCE(s.data, '{}'::jsonb);
  contact_name := d->'contact'->>'name';
  -- First name only — privacy. If "Tommy K" they see "Tommy". If single name
  -- "Tommy" they see the full thing. Nothing past the first whitespace.
  first_name := SPLIT_PART(COALESCE(contact_name, ''), ' ', 1);

  -- Build the public-safe response. Whitelist approach so future fields
  -- added to data JSONB don't leak by accident.
  RETURN jsonb_build_object(
    'found',                TRUE,
    'submitted_at',         s.created_at,
    'first_name',           first_name,
    'items',                COALESCE(d->'items', '[]'::jsonb),
    'totals',               COALESCE(d->'totals', '{}'::jsonb),
    'deposit_status',       COALESCE(d->>'deposit_status', 'pending'),
    'balance_status',       COALESCE(d->>'balance_status', 'pending'),
    'deposit_paid_at',      d->>'deposit_paid_at',
    'balance_paid_at',      d->>'balance_paid_at',
    'supplier_ordered_at',  d->>'supplier_ordered_at',
    'fulfillment',          COALESCE(d->>'fulfillment', 'pickup'),
    'is_shipping',          COALESCE((d->>'is_shipping')::boolean, FALSE),
    'pulled_early',         COALESCE((d->>'pulled_early')::boolean, FALSE)
  );
END $$;

-- Anon role needs EXECUTE to call this from the public status page.
-- The function's SECURITY DEFINER guarantee + the form_slug check inside
-- mean anon can only read preorder-2026 submissions (not other forms).
GRANT EXECUTE ON FUNCTION preorder_status_lookup(UUID) TO anon, authenticated;

-- Smoke-test note: anon-callable means the URL pattern is
--   POST /rest/v1/rpc/preorder_status_lookup
--   { "p_id": "<uuid>" }
-- Returns { found:false } when the UUID doesn't match — never leaks
-- whether the UUID exists in some OTHER form (cross-form enumeration
-- guard via the explicit slug check).
