-- ============================================================
-- 064_brivo_integration.sql — Brivo cloud-access integration
-- ============================================================
-- Wires skateOS into Brivo for the park door (members-only).
-- Staff door is managed entirely in Brivo dashboard.
--
-- WHAT THIS DOES:
--   • customers gets brivo_* columns: user_id, credential state,
--     invite-sent timestamp, last-synced timestamp, sync-needed flag
--   • new table brivo_access_log: append-only door event audit trail
--   • view brivo_member_desired: computes who SHOULD be in the
--     active-members group based on subscriptions + waiver + bans
--   • trigger on subscriptions INSERT/UPDATE/DELETE → flags affected
--     customer for sync
--   • trigger on customers UPDATE (tags or waiver) → flags for sync
--   • pg_cron: brivo-sync-all every 5 min (catches flagged customers
--     + drift); daily 4am full reconcile via the same function
--
-- WHAT THIS DOES NOT DO:
--   • Does NOT touch Brivo from inside Postgres. The cron fires an
--     Edge Function (brivo-sync-all) which talks to Brivo via REST
--     and writes credential state back here.
--   • Does NOT bypass Brivo's own staff group management. Staff
--     credentials are managed by the locksmith / owner inside Brivo
--     dashboard and skateOS NEVER provisions them.
--
-- DEPENDENCIES:
--   • Migration 001 (customers, subscriptions tables)
--   • Migration 009 (tenants table, current_tenant_id())
--   • Migration 015 (webhook_log table — brivo-webhook writes here)
--   • Migration 026 (customers.waiver_expires_at)
--   • Migration 063 (strict RLS — new tables MUST have tenant_id)
--   • pg_cron + pg_net extensions (already enabled by migration 016)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ── 1. Customer-level Brivo state columns ────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS brivo_user_id           TEXT,
  ADD COLUMN IF NOT EXISTS brivo_credential_state  TEXT
    CHECK (brivo_credential_state IS NULL OR brivo_credential_state IN
      ('pending','active','suspended','revoked','error')),
  ADD COLUMN IF NOT EXISTS brivo_credential_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS brivo_last_synced_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS brivo_sync_needed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS brivo_sync_error         TEXT;

-- Partial index — only flagged rows (cheap sweep target)
CREATE INDEX IF NOT EXISTS idx_customers_brivo_sync_pending
  ON customers(brivo_sync_needed_at)
  WHERE brivo_sync_needed_at IS NOT NULL;

-- Lookup index for webhook customer matching
CREATE INDEX IF NOT EXISTS idx_customers_brivo_user_id
  ON customers(brivo_user_id)
  WHERE brivo_user_id IS NOT NULL;


-- ── 2. Brivo access event audit log ──────────────────────────
CREATE TABLE IF NOT EXISTS brivo_access_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  brivo_event_id  TEXT,                          -- Brivo's event identifier (unique per event)
  brivo_user_id   TEXT,                          -- Brivo user that triggered the event
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  access_point    TEXT,                          -- 'park_door' / 'shop_door' / etc.
  access_point_id TEXT,                          -- Brivo's numeric access point id
  event_type      TEXT NOT NULL,                 -- 'access_granted' / 'access_denied' / 'door_held_open' / 'door_forced'
  occurred_at     TIMESTAMPTZ NOT NULL,
  raw_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup against accidental webhook retries
CREATE UNIQUE INDEX IF NOT EXISTS idx_brivo_access_log_event_id
  ON brivo_access_log(brivo_event_id)
  WHERE brivo_event_id IS NOT NULL;

-- Per-customer history lookup (drives customer-detail panel)
CREATE INDEX IF NOT EXISTS idx_brivo_access_log_customer
  ON brivo_access_log(customer_id, occurred_at DESC);

-- Cross-tenant timeline lookup (drives Activity Log card)
CREATE INDEX IF NOT EXISTS idx_brivo_access_log_occurred
  ON brivo_access_log(occurred_at DESC);

-- Multi-tenant RLS (mirrors mig 063 pattern)
ALTER TABLE brivo_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON brivo_access_log;
DROP POLICY IF EXISTS tenant_isolation_write  ON brivo_access_log;
CREATE POLICY tenant_isolation_select ON brivo_access_log
  FOR SELECT USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
CREATE POLICY tenant_isolation_write ON brivo_access_log
  FOR ALL
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)
  WITH CHECK (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);


-- ── 3. Desired-state view ────────────────────────────────────
-- For every customer with brivo_user_id OR with any subscription,
-- compute whether they SHOULD have park-door access right now.
--
-- Rules (in order):
--   1. Banned tag set → NEVER (immediate revoke)
--   2. Waiver missing OR expired → NEVER
--   3. No active subscription of an eligible plan type → NEVER
--   4. Subscription paused (paused_until > now) → NEVER
--   5. Subscription past end_date → NEVER
--   6. Otherwise → YES, in active members group
--
-- Eligible plan types default to monthly + annual (settings.brivo
-- .eligible_plan_types overrides via the Edge Function, not in SQL).
CREATE OR REPLACE VIEW brivo_member_desired AS
SELECT
  c.id                              AS customer_id,
  c.tenant_id                       AS tenant_id,
  c.name                            AS name,
  c.email                           AS email,
  c.brivo_user_id                   AS brivo_user_id,
  c.brivo_credential_state          AS brivo_credential_state,
  c.tags                            AS tags,
  c.waiver_signed_at                AS waiver_signed_at,
  c.waiver_expires_at               AS waiver_expires_at,
  -- Computed: should this customer have access?
  CASE
    -- Banned (case + separator insensitive — matches _isBanned() in JS)
    WHEN EXISTS (
      SELECT 1 FROM unnest(coalesce(c.tags, ARRAY[]::TEXT[])) AS t
      WHERE LOWER(REPLACE(REPLACE(t,'-','_'),' ','_'))
            IN ('banned','do_not_serve','donotserve','86d')
    ) THEN FALSE
    -- Waiver gate
    WHEN c.waiver_signed_at IS NULL THEN FALSE
    WHEN c.waiver_expires_at IS NOT NULL AND c.waiver_expires_at < NOW() THEN FALSE
    -- Active eligible subscription required
    WHEN NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.customer_id = c.id
        AND s.status = 'active'
        AND s.plan_type IN ('monthly','annual')
        AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
        AND (s.paused_until IS NULL OR s.paused_until <= CURRENT_DATE)
    ) THEN FALSE
    ELSE TRUE
  END AS should_have_access,
  -- Why (debug aid for admin UI)
  CASE
    WHEN EXISTS (
      SELECT 1 FROM unnest(coalesce(c.tags, ARRAY[]::TEXT[])) AS t
      WHERE LOWER(REPLACE(REPLACE(t,'-','_'),' ','_'))
            IN ('banned','do_not_serve','donotserve','86d')
    ) THEN 'banned'
    WHEN c.waiver_signed_at IS NULL THEN 'no_waiver'
    WHEN c.waiver_expires_at IS NOT NULL AND c.waiver_expires_at < NOW() THEN 'waiver_expired'
    WHEN NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.customer_id = c.id
        AND s.status = 'active'
        AND s.plan_type IN ('monthly','annual')
        AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
        AND (s.paused_until IS NULL OR s.paused_until <= CURRENT_DATE)
    ) THEN 'no_active_membership'
    ELSE 'eligible'
  END AS desired_reason
FROM customers c
WHERE c.brivo_user_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.customer_id = c.id);


-- ── 4. Helper: flag a customer for sync ──────────────────────
CREATE OR REPLACE FUNCTION brivo_flag_customer_sync(p_customer_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE customers
    SET brivo_sync_needed_at = NOW(),
        brivo_sync_error     = NULL
  WHERE id = p_customer_id;
END;
$$;


-- ── 5. Triggers — flag for sync on relevant state changes ────

-- Subscription INSERT / UPDATE / DELETE → flag the owning customer
CREATE OR REPLACE FUNCTION brivo_trg_subscription_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Flag the new customer (INSERT, UPDATE) and the old customer
  -- (UPDATE moving to a different customer_id, or DELETE)
  IF TG_OP IN ('INSERT','UPDATE') THEN
    PERFORM brivo_flag_customer_sync(NEW.customer_id);
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.customer_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR OLD.customer_id <> NEW.customer_id THEN
      PERFORM brivo_flag_customer_sync(OLD.customer_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_brivo_subscription_sync ON subscriptions;
CREATE TRIGGER trg_brivo_subscription_sync
AFTER INSERT OR UPDATE OR DELETE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION brivo_trg_subscription_change();


-- Customer UPDATE → flag when tags or waiver fields change
CREATE OR REPLACE FUNCTION brivo_trg_customer_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Skip if the sync columns themselves changed (avoid feedback loop)
  IF NEW.brivo_sync_needed_at IS DISTINCT FROM OLD.brivo_sync_needed_at
     AND NEW.tags                  IS NOT DISTINCT FROM OLD.tags
     AND NEW.waiver_signed_at      IS NOT DISTINCT FROM OLD.waiver_signed_at
     AND NEW.waiver_expires_at     IS NOT DISTINCT FROM OLD.waiver_expires_at
     AND NEW.brivo_user_id         IS NOT DISTINCT FROM OLD.brivo_user_id THEN
    RETURN NEW;
  END IF;
  -- Flag on any of: tag change, waiver change, manual brivo_user_id set
  IF NEW.tags              IS DISTINCT FROM OLD.tags
     OR NEW.waiver_signed_at  IS DISTINCT FROM OLD.waiver_signed_at
     OR NEW.waiver_expires_at IS DISTINCT FROM OLD.waiver_expires_at
     OR NEW.brivo_user_id     IS DISTINCT FROM OLD.brivo_user_id THEN
    NEW.brivo_sync_needed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brivo_customer_sync ON customers;
CREATE TRIGGER trg_brivo_customer_sync
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION brivo_trg_customer_change();


-- ── 6. pg_cron schedules ─────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Every 5 min: process flagged customers via brivo-sync-all
DO $$ BEGIN
  PERFORM cron.unschedule('brivo-sync-flagged');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'brivo-sync-flagged',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/brivo-sync-all',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
    ),
    body    := '{"mode":"flagged"}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);

-- Daily 04:00 UTC (~midnight ET): full reconcile (catches drift)
DO $$ BEGIN
  PERFORM cron.unschedule('brivo-sync-full-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'brivo-sync-full-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/brivo-sync-all',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
    ),
    body    := '{"mode":"full"}'::jsonb,
    timeout_milliseconds := 300000
  ) AS request_id;
  $$
);


-- ============================================================
-- Notes for the cashier / owner:
--
-- VIEW SCHEDULED JOBS:
--   SELECT jobid, schedule, command FROM cron.job WHERE jobname LIKE 'brivo-%';
--
-- VIEW RECENT RUNS:
--   SELECT * FROM cron.job_run_details
--    WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'brivo-%')
--    ORDER BY end_time DESC LIMIT 20;
--
-- MANUALLY FIRE A SYNC (admin SQL editor):
--   SELECT cron.run('brivo-sync-flagged');
--
-- FLAG ONE CUSTOMER FOR IMMEDIATE SYNC:
--   SELECT brivo_flag_customer_sync('00000000-...');
--
-- INSPECT WHO SHOULD HAVE ACCESS RIGHT NOW:
--   SELECT name, should_have_access, desired_reason
--   FROM brivo_member_desired
--   ORDER BY should_have_access DESC, name;
-- ============================================================
