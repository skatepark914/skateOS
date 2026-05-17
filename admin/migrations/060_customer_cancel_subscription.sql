-- ============================================================
-- 060_customer_cancel_subscription.sql — customer self-serve cancel
--
-- Lets a signed-in customer cancel their own active subscription
-- via the me.html portal without calling the front desk.
--
-- Server-authoritative — gates on current_customer_id() = subscription
-- customer_id (mig 019). Refuses already-cancelled. Flips status to
-- 'cancelled' + audit-stamps notes with [Customer-cancelled YYYY-MM-DD:
-- REASON] for traceability. Does NOT issue any refund — that's an owner
-- decision (most skateparks: "ends at end of billing period, no refunds").
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customer_cancel_subscription(
  p_subscription_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_sub RECORD;
  v_audit_stamp TEXT;
  v_clean_reason TEXT;
BEGIN
  -- Resolve current customer (mig 019 helper)
  v_customer_id := current_customer_id();
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Not authenticated as a customer');
  END IF;

  -- Look up the subscription, verify ownership
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Subscription not found');
  END IF;
  IF v_sub.customer_id != v_customer_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'This subscription does not belong to you');
  END IF;

  -- Refuse non-cancellable states
  IF v_sub.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Already cancelled');
  END IF;
  IF v_sub.status = 'expired' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Already expired');
  END IF;

  -- Sanitize reason — strip control chars + cap at 300 chars
  v_clean_reason := REGEXP_REPLACE(COALESCE(p_reason, ''), '[[:cntrl:]]', '', 'g');
  IF LENGTH(v_clean_reason) > 300 THEN
    v_clean_reason := SUBSTRING(v_clean_reason FROM 1 FOR 300);
  END IF;
  IF v_clean_reason = '' THEN
    v_clean_reason := '(no reason provided)';
  END IF;

  -- Build audit stamp
  v_audit_stamp := '[Customer-cancelled ' || TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC: ' || v_clean_reason || ']';

  -- Flip status + append audit stamp to notes
  UPDATE subscriptions
  SET
    status = 'cancelled',
    notes = COALESCE(NULLIF(TRIM(notes), ''), '') ||
            CASE WHEN COALESCE(NULLIF(TRIM(notes), ''), '') = '' THEN '' ELSE E'\n' END ||
            v_audit_stamp,
    updated_at = NOW()
  WHERE id = p_subscription_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'subscription_id', p_subscription_id,
    'previous_status', v_sub.status,
    'cancelled_at', NOW()
  );
END $$;

GRANT EXECUTE ON FUNCTION customer_cancel_subscription(UUID, TEXT) TO authenticated;
