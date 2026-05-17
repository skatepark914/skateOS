-- ============================================================
-- 055_retail_order_status_lookup.sql — public retail-order status RPC
--
-- Customer-facing order tracking page (shop.skateos.com/order.html?id=…)
-- needs to read a single retail-order submission by its UUID without
-- exposing the entire form_submissions table to anon.
--
-- The submission UUID is the access token — 36 random hex chars,
-- unguessable. We share it in the order confirmation email + Helcim
-- payment success redirect; customer visits to track their order.
--
-- Same pattern as mig 048 (preorder_status_lookup).
-- Returns ONLY public-safe whitelist fields.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION retail_order_status_lookup(p_id UUID)
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
  -- Look up the submission. Refuse non-retail-order so this RPC can't be
  -- abused to read other form types (privilege escalation guard).
  SELECT s.*, f.slug AS form_slug
    INTO s
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_id
      AND f.slug = 'retail-order'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  d := COALESCE(s.data, '{}'::jsonb);
  contact_name := d->'contact'->>'name';
  first_name := SPLIT_PART(COALESCE(contact_name, ''), ' ', 1);

  RETURN jsonb_build_object(
    'found',                TRUE,
    'submitted_at',         s.created_at,
    'first_name',           first_name,
    'items',                COALESCE(d->'items', '[]'::jsonb),
    'totals',               COALESCE(d->'totals', '{}'::jsonb),
    'payment_status',       COALESCE(d->>'payment_status', 'pending'),
    'payment_paid_at',      d->>'payment_paid_at',
    'fulfillment',          COALESCE(d->>'fulfillment', 'pickup'),
    'shipping_address',     d->>'shipping_address',
    'fulfilled_at',         d->>'fulfilled_at',
    'helcim_payment_url',   d->>'helcim_payment_url',
    'oversold_count',       COALESCE((d->>'oversold_count')::int, 0)
  );
END $$;

GRANT EXECUTE ON FUNCTION retail_order_status_lookup(UUID) TO anon, authenticated;
