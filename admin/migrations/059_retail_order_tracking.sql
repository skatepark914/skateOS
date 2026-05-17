-- ============================================================
-- 059_retail_order_tracking.sql — extend retail_order_status_lookup
--                                   with tracking_number + carrier
--
-- The admin _retailMarkFulfilled flow now optionally captures a
-- tracking number + carrier on ship-orders (UPS / USPS / FedEx /
-- DHL / other). This migration extends the public status-lookup RPC
-- so the customer-facing order tracking page (shop/order.html) can
-- surface the tracking info + a deep-link to the carrier's site.
--
-- Pure RPC update (CREATE OR REPLACE). No table schema change —
-- tracking_number + carrier live inside the existing JSONB `data`
-- column on form_submissions, no migration needed for those.
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
    'oversold_count',       COALESCE((d->>'oversold_count')::int, 0),
    -- NEW: tracking info (ship-orders only, optional)
    'tracking_number',      d->>'tracking_number',
    'carrier',              d->>'carrier'
  );
END $$;

GRANT EXECUTE ON FUNCTION retail_order_status_lookup(UUID) TO anon, authenticated;
