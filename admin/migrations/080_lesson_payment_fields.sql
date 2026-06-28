-- ============================================================
-- 080_lesson_payment_fields.sql
--
-- Adds online-payment fields to lessons so customers can pay at
-- booking via Square Online Checkout.
--
-- Flow:
--   1. Customer picks type + instructor + time on /2ntr/lessons
--   2. Edge Function `square-lesson-checkout` inserts a lesson row
--      with status='pending_payment' + Square checkout URL
--   3. Customer redirects to Square's hosted payment page
--   4. On success, Square redirects to /2ntr/lessons/thanks?lesson=<uuid>
--   5. Thanks page calls public_confirm_lesson_payment to flip
--      status to 'scheduled' + stamp paid_at
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS square_checkout_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_url TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS lessons_square_checkout_id_idx
  ON public.lessons(square_checkout_id)
  WHERE square_checkout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lessons_pending_payment_idx
  ON public.lessons(created_at)
  WHERE status = 'pending_payment';

------------------------------------------------------------
-- public_confirm_lesson_payment
-- Called by the thanks page after Square redirects the customer
-- back from the hosted payment page. Validates the lesson is
-- pending + has the matching checkout_id, then flips status to
-- 'scheduled' + stamps paid_at.
-- Anon-callable so the public thanks page can call it.
------------------------------------------------------------
DROP FUNCTION IF EXISTS public_confirm_lesson_payment(UUID, TEXT);
CREATE OR REPLACE FUNCTION public_confirm_lesson_payment(
  p_lesson_id UUID,
  p_checkout_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row RECORD;
BEGIN
  SELECT id, status, scheduled_at, instructor, type, square_checkout_id
    INTO _row
    FROM lessons
    WHERE id = p_lesson_id;

  IF _row IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lesson not found');
  END IF;

  IF _row.status = 'scheduled' THEN
    -- Already confirmed — return success (idempotent on re-loads of the thanks page)
    RETURN jsonb_build_object('ok', true, 'already_confirmed', true, 'lesson_id', p_lesson_id);
  END IF;

  IF _row.status <> 'pending_payment' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Lesson is in status "' || _row.status || '" — cannot confirm.');
  END IF;

  -- If a checkout_id was given, validate it matches what we stored at booking
  IF p_checkout_id IS NOT NULL AND _row.square_checkout_id IS NOT NULL
     AND _row.square_checkout_id <> p_checkout_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Checkout ID mismatch');
  END IF;

  UPDATE lessons
    SET status = 'scheduled',
        paid_at = NOW(),
        notes = COALESCE(notes, '') ||
          E'\n[Paid online via Square ' || to_char(NOW(),'YYYY-MM-DD HH24:MI') || ']'
  WHERE id = p_lesson_id;

  RETURN jsonb_build_object(
    'ok', true,
    'lesson_id', p_lesson_id,
    'instructor', _row.instructor,
    'scheduled_at', _row.scheduled_at,
    'type', _row.type,
    'confirmation', UPPER(SUBSTRING(p_lesson_id::TEXT, 1, 8))
  );
END $$;

GRANT EXECUTE ON FUNCTION public_confirm_lesson_payment(UUID, TEXT) TO anon, authenticated;

DO $$ BEGIN
  RAISE NOTICE '080 applied: lessons payment columns + public_confirm_lesson_payment RPC';
END $$;
