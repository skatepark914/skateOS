-- ============================================================
-- 035_email_opt_out.sql — CAN-SPAM compliance
--
-- Every commercial email sent (lesson reminders, daily digest,
-- birthday greetings, marketing campaigns) needs a working
-- one-click unsubscribe per CAN-SPAM Act §7704(a)(5).
--
-- This adds:
--   * customers.email_opt_out_at — set when they hit unsubscribe
--   * email_opt_out(p_customer_id UUID) — public RPC the static
--     unsubscribe.html page calls (anon key + SECURITY DEFINER
--     so the customer doesn't need an account to opt out)
--   * email_opt_in(...) — for staff who want to reverse on request
--
-- Unsubscribe link shape:
--   https://app.skateos.com/admin/unsubscribe.html?cid=<customer_uuid>
-- The customer UUID is a 128-bit secret — unguessable enough to
-- prevent malicious cross-skater unsubscribes.
--
-- Edge functions read customers.email_opt_out_at IS NULL before
-- sending. Marketing campaign builder also filters this out.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email_opt_out_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_opted_out
  ON customers(email_opt_out_at)
  WHERE email_opt_out_at IS NOT NULL;

-- Public-callable opt-out RPC. SECURITY DEFINER + minimal write,
-- one column on one row, keyed by UUID — safe to expose to anon.
-- We rate-limit implicitly by the UUID being unguessable.
CREATE OR REPLACE FUNCTION email_opt_out(p_customer_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cust_email TEXT;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_id required');
  END IF;
  UPDATE customers
     SET email_opt_out_at = NOW()
   WHERE id = p_customer_id
     AND email_opt_out_at IS NULL
   RETURNING email INTO cust_email;
  IF NOT FOUND THEN
    -- Either already opted out, or unknown UUID — return success
    -- either way to avoid revealing whether the UUID maps to a real
    -- record (prevents enum attacks).
    RETURN json_build_object('ok', true, 'already_opted_out', true);
  END IF;
  RETURN json_build_object('ok', true, 'email', cust_email);
END;
$$;

-- Staff-only re-opt-in (e.g. customer asks to be put back on the list
-- after manual review). is_staff() check inside.
CREATE OR REPLACE FUNCTION email_opt_in(p_customer_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;
  UPDATE customers SET email_opt_out_at = NULL WHERE id = p_customer_id;
  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION email_opt_out(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION email_opt_in(UUID)  TO authenticated;
