-- ============================================================
-- 061_customer_pause_subscription.sql — customer self-serve pause
--
-- Lets a signed-in customer pause their own active monthly/annual
-- subscription for up to 90 days via the me.html portal. Pairs with
-- mig 030 (paused_until column + auto-resume daily cron). After the
-- pause window passes, the existing cron auto-flips status back to
-- 'active' so the customer doesn't have to manually un-pause.
--
-- Server-authoritative — gates on current_customer_id() (mig 019).
-- Refuses pauses on punch_card / day_pass plans (those don't bill on
-- a cycle so pause is meaningless). Refuses already-paused. Caps the
-- pause window at 90 days max to prevent indefinite-pause abuse.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customer_pause_subscription(
  p_subscription_id UUID,
  p_until DATE,
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
  v_max_until DATE;
BEGIN
  -- Resolve current customer (mig 019)
  v_customer_id := current_customer_id();
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Not authenticated as a customer');
  END IF;

  -- Look up subscription, verify ownership
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Subscription not found');
  END IF;
  IF v_sub.customer_id != v_customer_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'This subscription does not belong to you');
  END IF;

  -- Refuse uncancellable / unpausable types
  IF v_sub.status != 'active' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only active subscriptions can be paused (this one is ' || v_sub.status || ')');
  END IF;
  IF v_sub.plan_type NOT IN ('monthly', 'annual') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only monthly or annual memberships can be paused');
  END IF;

  -- Validate pause-until date — must be in future, max 90 days out
  IF p_until IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Pause-until date is required');
  END IF;
  IF p_until <= CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Pause-until date must be in the future');
  END IF;
  v_max_until := CURRENT_DATE + INTERVAL '90 days';
  IF p_until > v_max_until THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Maximum pause window is 90 days. Pick a date on or before ' || TO_CHAR(v_max_until, 'YYYY-MM-DD'));
  END IF;

  -- Sanitize reason
  v_clean_reason := REGEXP_REPLACE(COALESCE(p_reason, ''), '[[:cntrl:]]', '', 'g');
  IF LENGTH(v_clean_reason) > 300 THEN
    v_clean_reason := SUBSTRING(v_clean_reason FROM 1 FOR 300);
  END IF;
  IF v_clean_reason = '' THEN
    v_clean_reason := '(no reason provided)';
  END IF;

  v_audit_stamp := '[Customer-paused ' || TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') ||
                   ' UTC until ' || TO_CHAR(p_until, 'YYYY-MM-DD') || ': ' || v_clean_reason || ']';

  -- Flip to paused + set paused_until + audit stamp
  UPDATE subscriptions
  SET
    status = 'paused',
    paused_until = p_until,
    notes = COALESCE(NULLIF(TRIM(notes), ''), '') ||
            CASE WHEN COALESCE(NULLIF(TRIM(notes), ''), '') = '' THEN '' ELSE E'\n' END ||
            v_audit_stamp,
    updated_at = NOW()
  WHERE id = p_subscription_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'subscription_id', p_subscription_id,
    'paused_until', p_until,
    'will_auto_resume_at', p_until
  );
END $$;

GRANT EXECUTE ON FUNCTION customer_pause_subscription(UUID, DATE, TEXT) TO authenticated;
