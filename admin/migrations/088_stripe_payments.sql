-- ============================================================
-- 088_stripe_payments.sql
--
-- Stripe Tap-to-Pay infrastructure. POS opens a Stripe Checkout
-- link → customer taps with Apple/Google Pay on their phone →
-- webhook flips the sale to paid. Same columns work for the M2
-- reader path if/when it's added.
--
-- Mirrors the helcim-* pattern: payment_url for resend, ref ids
-- for reconciliation. Idempotent.
-- ============================================================

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id   TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_url         TEXT,
  ADD COLUMN IF NOT EXISTS stripe_paid_at             TIMESTAMPTZ;

-- Unique partial indexes so the webhook can dedupe on session_id /
-- payment_intent_id without colliding with NULLs from non-Stripe sales.
CREATE UNIQUE INDEX IF NOT EXISTS sales_stripe_session_uniq
  ON public.sales(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_stripe_pi_uniq
  ON public.sales(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE '088 applied: stripe payment columns on sales';
END $$;
