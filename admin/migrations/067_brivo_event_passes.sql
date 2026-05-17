-- ============================================================
-- 067_brivo_event_passes.sql — time-bounded Brivo passes
-- ============================================================
-- Use case: birthday party host needs 24/7 park-door access during
-- their party window (Sat 2pm–6pm). They're not a monthly/annual
-- member, but we still want to grant access without manually
-- adding them to Brivo + remembering to revoke afterward.
--
-- Schema:
--   - brivo_event_passes(customer_id, valid_from, valid_until, status,
--     reason, party_form_submission_id, issued_by, notes)
--
-- View update:
--   - brivo_member_desired now grants access if EITHER an active
--     monthly/annual sub exists OR an active event pass covers now().
--     The auto-revoke happens naturally when valid_until passes.
--
-- Cron:
--   - brivo-sync-all gets a new mode='expiring' that flags any
--     customer whose event pass just lapsed for immediate re-sync.
--     Added as a new pg_cron entry running every 5 min.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ── 1. Event passes table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS brivo_event_passes (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id              UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  valid_from               TIMESTAMPTZ NOT NULL,
  valid_until              TIMESTAMPTZ NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','revoked','expired')),
  reason                   TEXT,           -- 'birthday party', 'industry comp event', etc.
  party_form_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
  issued_by                UUID REFERENCES staff(id) ON DELETE SET NULL,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- valid_from must be before valid_until
  CHECK (valid_from < valid_until)
);

-- Lookup index for "is this customer currently inside an event pass window?"
CREATE INDEX IF NOT EXISTS idx_brivo_event_passes_customer_active
  ON brivo_event_passes(customer_id, valid_from, valid_until)
  WHERE status = 'active';

-- Sweep index for the 5-min expiry cron — find active passes whose
-- valid_until just lapsed.
CREATE INDEX IF NOT EXISTS idx_brivo_event_passes_expiring
  ON brivo_event_passes(valid_until)
  WHERE status = 'active';

-- Multi-tenant RLS (mirrors mig 063 pattern)
ALTER TABLE brivo_event_passes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON brivo_event_passes;
DROP POLICY IF EXISTS tenant_isolation_write  ON brivo_event_passes;
CREATE POLICY tenant_isolation_select ON brivo_event_passes
  FOR SELECT USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
CREATE POLICY tenant_isolation_write ON brivo_event_passes
  FOR ALL
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)
  WITH CHECK (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

-- updated_at trigger
CREATE OR REPLACE FUNCTION brivo_event_passes_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_brivo_event_passes_touch ON brivo_event_passes;
CREATE TRIGGER trg_brivo_event_passes_touch
BEFORE UPDATE ON brivo_event_passes
FOR EACH ROW EXECUTE FUNCTION brivo_event_passes_touch_updated_at();


-- ── 2. Extend brivo_member_desired view ───────────────────────
-- Replace the view with one that ALSO grants access during an
-- active event pass window. Reason 'event_pass' surfaces in admin
-- so owner sees WHY a non-member has access.
CREATE OR REPLACE VIEW brivo_member_desired AS
SELECT
  c.id                      AS customer_id,
  c.tenant_id               AS tenant_id,
  c.name                    AS name,
  c.email                   AS email,
  c.brivo_user_id           AS brivo_user_id,
  c.brivo_credential_state  AS brivo_credential_state,
  c.tags                    AS tags,
  c.waiver_signed_at        AS waiver_signed_at,
  c.waiver_expires_at       AS waiver_expires_at,
  CASE
    -- Banned overrides everything
    WHEN EXISTS (
      SELECT 1 FROM unnest(coalesce(c.tags, ARRAY[]::TEXT[])) AS t
      WHERE LOWER(REPLACE(REPLACE(t,'-','_'),' ','_'))
            IN ('banned','do_not_serve','donotserve','86d')
    ) THEN FALSE
    -- Waiver gate
    WHEN c.waiver_signed_at IS NULL THEN FALSE
    WHEN c.waiver_expires_at IS NOT NULL AND c.waiver_expires_at < NOW() THEN FALSE
    -- Eligible: has active monthly/annual sub OR has active event pass
    WHEN EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.customer_id = c.id
        AND s.status = 'active'
        AND s.plan_type IN ('monthly','annual')
        AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
        AND (s.paused_until IS NULL OR s.paused_until <= CURRENT_DATE)
    ) THEN TRUE
    WHEN EXISTS (
      SELECT 1 FROM brivo_event_passes p
      WHERE p.customer_id = c.id
        AND p.status = 'active'
        AND p.valid_from <= NOW()
        AND p.valid_until >  NOW()
    ) THEN TRUE
    ELSE FALSE
  END AS should_have_access,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM unnest(coalesce(c.tags, ARRAY[]::TEXT[])) AS t
      WHERE LOWER(REPLACE(REPLACE(t,'-','_'),' ','_'))
            IN ('banned','do_not_serve','donotserve','86d')
    ) THEN 'banned'
    WHEN c.waiver_signed_at IS NULL THEN 'no_waiver'
    WHEN c.waiver_expires_at IS NOT NULL AND c.waiver_expires_at < NOW() THEN 'waiver_expired'
    WHEN EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.customer_id = c.id
        AND s.status = 'active'
        AND s.plan_type IN ('monthly','annual')
        AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
        AND (s.paused_until IS NULL OR s.paused_until <= CURRENT_DATE)
    ) THEN 'eligible'
    WHEN EXISTS (
      SELECT 1 FROM brivo_event_passes p
      WHERE p.customer_id = c.id
        AND p.status = 'active'
        AND p.valid_from <= NOW()
        AND p.valid_until >  NOW()
    ) THEN 'event_pass'
    ELSE 'no_active_membership'
  END AS desired_reason
FROM customers c
WHERE c.brivo_user_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM subscriptions s        WHERE s.customer_id = c.id)
   OR EXISTS (SELECT 1 FROM brivo_event_passes p   WHERE p.customer_id = c.id);


-- ── 3. RPC: sweep expired event passes ────────────────────────
-- Called by pg_cron every 5 min via the brivo-sync-all Edge Function.
-- Marks any 'active' pass whose valid_until has lapsed → 'expired'
-- AND flags the customer for sync so the cron re-evaluates.
CREATE OR REPLACE FUNCTION brivo_sweep_expired_event_passes()
RETURNS TABLE (passes_expired INT, customers_flagged INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass_count INT := 0;
  v_cust_count INT := 0;
BEGIN
  -- Get distinct customer_ids whose passes are about to expire
  WITH expiring AS (
    UPDATE brivo_event_passes
       SET status     = 'expired',
           updated_at = NOW()
     WHERE status = 'active'
       AND valid_until <= NOW()
    RETURNING customer_id
  )
  SELECT COUNT(*), COUNT(DISTINCT customer_id) INTO v_pass_count, v_cust_count FROM expiring;

  -- Flag each affected customer for re-sync so brivo-sync-all picks them up
  UPDATE customers
    SET brivo_sync_needed_at = NOW()
  WHERE id IN (
    SELECT DISTINCT customer_id FROM brivo_event_passes
    WHERE status = 'expired' AND updated_at > NOW() - INTERVAL '1 minute'
  );

  RETURN QUERY SELECT v_pass_count, v_cust_count;
END;
$$;


-- ── 4. pg_cron schedule for the expiry sweep ──────────────────
-- Runs every 5 min, in sync with the brivo-sync-flagged schedule.
DO $$ BEGIN
  PERFORM cron.unschedule('brivo-event-pass-sweep');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'brivo-event-pass-sweep',
  '*/5 * * * *',
  $$ SELECT brivo_sweep_expired_event_passes() $$
);

-- ============================================================
-- Notes:
--
-- ISSUE AN EVENT PASS (admin SQL editor):
--   INSERT INTO brivo_event_passes (customer_id, valid_from, valid_until, reason)
--   VALUES ('<uuid>', '2026-06-15 14:00:00-04', '2026-06-15 18:00:00-04', 'Tommy K birthday party');
--   SELECT brivo_flag_customer_sync('<uuid>');
--
-- VIEW ACTIVE PASSES:
--   SELECT c.name, p.valid_from, p.valid_until, p.reason
--   FROM brivo_event_passes p JOIN customers c ON c.id = p.customer_id
--   WHERE p.status = 'active' AND p.valid_until > NOW()
--   ORDER BY p.valid_from;
--
-- MANUALLY REVOKE A PASS (early-end a party):
--   UPDATE brivo_event_passes SET status='revoked' WHERE id='<uuid>';
--   SELECT brivo_flag_customer_sync((SELECT customer_id FROM brivo_event_passes WHERE id='<uuid>'));
--
-- VIEW SCHEDULE:
--   SELECT jobid, schedule FROM cron.job WHERE jobname = 'brivo-event-pass-sweep';
-- ============================================================
