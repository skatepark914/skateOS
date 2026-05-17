-- ============================================================
-- 050_my_preorders_rpc.sql — customer self-serve preorder list
--
-- The customer portal (admin/me.html) calls customer_portal_summary at load
-- to get points + visits + active passes + recent purchases + recent lessons.
-- This migration adds a complementary `my_preorders()` RPC so the portal can
-- ALSO surface the signed-in customer's preorder submissions alongside
-- everything else.
--
-- Without this, customers see the public status page (status.html?id=<uuid>)
-- only via an email link — they have no logged-in dashboard view of all
-- their orders at once.
--
-- Security model:
--   • SECURITY DEFINER + uses current_customer_id() (mig 019) to resolve
--     the auth'd customer
--   • Matches submissions where data.contact.email = customer.email (case-
--     insensitive) OR last 7 digits of data.contact.phone = customer.phone
--     (forgiving of country-code formatting)
--   • Returns ONLY the public-safe whitelist (same shape as
--     preorder_status_lookup from mig 048)
--   • GRANT EXECUTE TO authenticated only (anon can't call it)
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION my_preorders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cust_id UUID;
  cust_email TEXT;
  cust_phone_digits TEXT;
  result JSONB := '[]'::jsonb;
BEGIN
  cust_id := current_customer_id();
  IF cust_id IS NULL THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'not_authenticated_as_customer');
  END IF;

  SELECT email, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
    INTO cust_email, cust_phone_digits
    FROM customers
    WHERE id = cust_id;

  IF cust_email IS NULL AND (cust_phone_digits IS NULL OR LENGTH(cust_phone_digits) < 7) THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'no_contact_match_keys');
  END IF;

  -- Build the JSON array of matching submissions, newest-first
  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'submitted_at') DESC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT jsonb_build_object(
        'id',                  s.id,
        'submitted_at',        s.created_at,
        'items',               COALESCE(s.data->'items', '[]'::jsonb),
        'totals',              COALESCE(s.data->'totals', '{}'::jsonb),
        'deposit_status',      COALESCE(s.data->>'deposit_status', 'pending'),
        'balance_status',      COALESCE(s.data->>'balance_status', 'pending'),
        'deposit_paid_at',     s.data->>'deposit_paid_at',
        'balance_paid_at',     s.data->>'balance_paid_at',
        'supplier_ordered_at', s.data->>'supplier_ordered_at',
        'fulfillment',         COALESCE(s.data->>'fulfillment', 'pickup'),
        'is_shipping',         COALESCE((s.data->>'is_shipping')::boolean, FALSE),
        'helcim_payment_url',  s.data->>'helcim_payment_url'
      ) AS payload
      FROM form_submissions s
      JOIN forms f ON f.id = s.form_id
      WHERE f.slug = 'preorder-2026'
        AND (
          (cust_email IS NOT NULL AND LOWER(s.data->'contact'->>'email') = LOWER(cust_email))
          OR (LENGTH(cust_phone_digits) >= 7
              AND RIGHT(regexp_replace(COALESCE(s.data->'contact'->>'phone', ''), '[^0-9]', '', 'g'), 7)
                  = RIGHT(cust_phone_digits, 7))
        )
      LIMIT 50
    ) AS sub;

  RETURN jsonb_build_object('found', TRUE, 'preorders', result);
END $$;

-- Authenticated only — anon should NOT be able to enumerate preorders
GRANT EXECUTE ON FUNCTION my_preorders() TO authenticated;
