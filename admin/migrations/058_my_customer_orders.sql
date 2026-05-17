-- ============================================================
-- 058_my_customer_orders.sql — customer-portal RPC for retail + lesson bookings
--
-- Phase 3 polish: extends the customer self-serve me.html portal to surface
-- a customer's online retail orders + lesson bookings alongside their
-- existing pre-orders + visits + loyalty data.
--
-- Without this RPC the portal can't read form_submissions directly (RLS is
-- staff-only). Same SECURITY DEFINER pattern as mig 050 (my_preorders).
--
-- Returns ONLY the public-safe whitelist of fields. Match by email or
-- phone last-7-digits (forgiving of country-code formatting).
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION my_retail_orders()
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

  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'submitted_at') DESC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT jsonb_build_object(
        'id',                 s.id,
        'submitted_at',       s.created_at,
        'items',              COALESCE(s.data->'items', '[]'::jsonb),
        'totals',             COALESCE(s.data->'totals', '{}'::jsonb),
        'payment_status',     COALESCE(s.data->>'payment_status', 'pending'),
        'fulfillment',        COALESCE(s.data->>'fulfillment', 'pickup'),
        'fulfilled_at',       s.data->>'fulfilled_at',
        'helcim_payment_url', s.data->>'helcim_payment_url'
      ) AS payload
      FROM form_submissions s
      JOIN forms f ON f.id = s.form_id
      WHERE f.slug = 'retail-order'
        AND (
          (cust_email IS NOT NULL AND LOWER(s.data->'contact'->>'email') = LOWER(cust_email))
          OR (LENGTH(cust_phone_digits) >= 7
              AND RIGHT(regexp_replace(COALESCE(s.data->'contact'->>'phone', ''), '[^0-9]', '', 'g'), 7)
                  = RIGHT(cust_phone_digits, 7))
        )
      LIMIT 50
    ) AS sub;

  RETURN jsonb_build_object('found', TRUE, 'orders', result);
END $$;

GRANT EXECUTE ON FUNCTION my_retail_orders() TO authenticated;

-- Online lesson bookings — same shape, slug='lesson-booking'
CREATE OR REPLACE FUNCTION my_lesson_bookings()
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

  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'scheduled_at') ASC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT jsonb_build_object(
        'id',                 s.id,
        'submitted_at',       s.created_at,
        'lesson_type',        s.data->>'lesson_type',
        'instructor',         s.data->>'instructor',
        'scheduled_at',       s.data->>'scheduled_at',
        'duration_min',       (s.data->>'duration_min')::int,
        'price',              s.data->>'price',
        'payment_status',     COALESCE(s.data->>'payment_status', 'pending'),
        'helcim_payment_url', s.data->>'helcim_payment_url',
        'lesson_id',          s.data->>'lesson_id',
        'skater_name',        s.data->'skater'->>'name'
      ) AS payload
      FROM form_submissions s
      JOIN forms f ON f.id = s.form_id
      WHERE f.slug = 'lesson-booking'
        AND (
          (cust_email IS NOT NULL AND LOWER(s.data->'contact'->>'email') = LOWER(cust_email))
          OR (LENGTH(cust_phone_digits) >= 7
              AND RIGHT(regexp_replace(COALESCE(s.data->'contact'->>'phone', ''), '[^0-9]', '', 'g'), 7)
                  = RIGHT(cust_phone_digits, 7))
        )
      LIMIT 50
    ) AS sub;

  RETURN jsonb_build_object('found', TRUE, 'bookings', result);
END $$;

GRANT EXECUTE ON FUNCTION my_lesson_bookings() TO authenticated;
