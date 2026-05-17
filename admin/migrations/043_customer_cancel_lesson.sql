-- ============================================================
-- 043_customer_cancel_lesson.sql — customer self-serve cancellation
--
-- Lets a signed-in customer cancel their own upcoming lesson via the
-- self-serve portal (admin/me.html). SECURITY DEFINER bypasses RLS so
-- we can flip lessons.status + insert the late-cancel fee sale (if
-- the policy applies) — but the function gates on
-- `current_customer_id() = lesson.customer_id` so a customer can only
-- cancel their own lessons.
--
-- Fee logic mirrors the admin cancelLesson() flow:
--   • Reads cancellation policy from `app_settings` key='all'.value.cancellationPolicy
--     (enabled / windowHours / feePercent), defaults: enabled=false, 24h, 50%
--   • If enabled AND lesson is within window AND has a price > 0:
--     creates a sale row "Late cancellation fee" tagged Pending
--   • Otherwise no fee
--
-- Returns JSON { ok, fee_charged, fee_amount } so the customer-facing
-- portal can render the right confirmation message.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customer_cancel_lesson(p_lesson_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id        UUID;
  v_lesson             lessons%ROWTYPE;
  v_settings           JSONB;
  v_policy             JSONB;
  v_policy_enabled     BOOLEAN := false;
  v_policy_window_h    INT     := 24;
  v_policy_fee_pct     INT     := 50;
  v_hours_until        NUMERIC;
  v_fee_amount         NUMERIC := 0;
  v_fee_charged        BOOLEAN := false;
  v_fee_sale_id        UUID;
  v_note_stamp         TEXT;
  v_combined_notes     TEXT;
BEGIN
  v_customer_id := current_customer_id();
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated as a customer';
  END IF;

  SELECT * INTO v_lesson FROM lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lesson not found';
  END IF;

  -- Gate: customer can only cancel their own lesson (solo path). Group
  -- lessons where they're a non-primary attendee should use a different
  -- flow (drop themselves from lesson_attendees) — out of scope here.
  IF v_lesson.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'Not authorized to cancel this lesson';
  END IF;

  IF v_lesson.status = 'cancelled' THEN
    RAISE EXCEPTION 'Lesson is already cancelled';
  END IF;

  IF v_lesson.scheduled_at IS NOT NULL
     AND v_lesson.scheduled_at < NOW() THEN
    RAISE EXCEPTION 'Cannot cancel a lesson that has already started';
  END IF;

  -- Read cancellation policy from app_settings
  BEGIN
    SELECT value INTO v_settings FROM app_settings WHERE key = 'all';
    IF v_settings IS NOT NULL THEN
      v_policy := v_settings->'cancellationPolicy';
      IF v_policy IS NOT NULL THEN
        v_policy_enabled  := COALESCE((v_policy->>'enabled')::boolean, false);
        v_policy_window_h := COALESCE((v_policy->>'windowHours')::int, 24);
        v_policy_fee_pct  := COALESCE((v_policy->>'feePercent')::int, 50);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- app_settings table missing or malformed → treat as policy disabled
    v_policy_enabled := false;
  END;

  -- Compute fee if applicable
  IF v_policy_enabled
     AND v_lesson.scheduled_at IS NOT NULL
     AND v_lesson.price IS NOT NULL
     AND v_lesson.price > 0 THEN
    v_hours_until := EXTRACT(EPOCH FROM (v_lesson.scheduled_at - NOW())) / 3600.0;
    IF v_hours_until >= 0 AND v_hours_until < v_policy_window_h THEN
      v_fee_amount := ROUND((v_lesson.price * v_policy_fee_pct / 100.0)::numeric, 2);
      v_fee_charged := (v_fee_amount > 0);
    END IF;
  END IF;

  -- Stamp the lesson notes
  v_note_stamp := '[Cancelled '|| TO_CHAR(NOW(),'YYYY-MM-DD') ||' by customer (self-serve)'
                || CASE WHEN v_fee_charged
                        THEN ': '|| v_policy_fee_pct ||'% fee $'|| v_fee_amount ||' applied'
                        ELSE '' END
                || ']';
  v_combined_notes := COALESCE(v_lesson.notes || E'\n', '') || v_note_stamp;

  -- Flip the lesson
  UPDATE lessons
     SET status = 'cancelled',
         notes  = v_combined_notes,
         updated_at = NOW()
   WHERE id = p_lesson_id;

  -- Create the fee sale (if applicable). Status='completed', payment='Pending'
  -- so the front desk knows to collect at next visit.
  IF v_fee_charged THEN
    INSERT INTO sales (
      customer_id, customer_name, product_id, product_name,
      quantity, subtotal, tax, discount, total,
      payment_method, status, notes
    )
    SELECT v_lesson.customer_id, c.name, NULL,
           'Late cancellation fee — '|| COALESCE(v_lesson.type,'lesson'),
           1, v_fee_amount, 0, 0, v_fee_amount,
           'Pending', 'completed',
           '[Self-serve cancellation late-fee · '|| v_policy_fee_pct ||'% of $'|| v_lesson.price ||' lesson · '|| TO_CHAR(NOW(),'YYYY-MM-DD') ||']'
      FROM customers c
     WHERE c.id = v_lesson.customer_id
    RETURNING id INTO v_fee_sale_id;
  END IF;

  -- Best-effort: mirror cancellation onto lesson_attendees if migration 032
  -- has been applied. Silent if not.
  BEGIN
    UPDATE lesson_attendees SET status = 'cancelled'
     WHERE lesson_id = p_lesson_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;  -- migration 032 not applied
  END;

  RETURN json_build_object(
    'ok',           true,
    'lesson_id',    p_lesson_id,
    'fee_charged',  v_fee_charged,
    'fee_amount',   v_fee_amount,
    'fee_sale_id',  v_fee_sale_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION customer_cancel_lesson(UUID) TO authenticated;

-- Inspection:
--   SELECT customer_cancel_lesson('<lesson_id>');  -- as the auth'd customer
