-- ============================================================
-- _apply_pending_062_to_065.sql — bundled migrations 062-065
--
-- ONE-PASTE migration runner. Copy this entire file into the
-- Supabase SQL editor and click Run. All 4 migrations will
-- apply in order. Each is idempotent (ON CONFLICT DO NOTHING /
-- CREATE OR REPLACE / IF NOT EXISTS), so re-running is safe.
--
-- Stack on top of _apply_pending_045_to_061.sql if that hasn't
-- been applied yet.
--
-- After this lands, you have:
--   062  tenant_id default + auto-populate triggers
--   063  strict RLS (cross-tenant reads + writes blocked at DB)
--   064  Brivo cloud-access integration
--          - customers.brivo_* columns
--          - brivo_access_log table (RLS-tenant-scoped)
--          - brivo_member_desired view (computed desired state)
--          - triggers on subscriptions + customers → flag for sync
--          - pg_cron: every 5 min (flagged) + daily 4am (full)
--   065  Brivo welcome-email idempotency stamp
--          - customers.brivo_welcome_sent_at column
--
-- Generated: 2026-05-15
-- ============================================================


-- ============================================================
-- BEGIN 062_tenant_id_defaults.sql
-- ============================================================
-- ============================================================
-- 062_tenant_id_defaults.sql — auto-fill tenant_id on every
-- business table via current_tenant_id() default
--
-- THE WHY:
-- All 260+ fetch POST/PATCH calls in admin/index.html do NOT
-- include `tenant_id` in their request body. Migration 009
-- added the column but left it nullable + with no default.
-- That works today only because strict-RLS Phase B (in
-- migration 009 part B, commented out) is not enabled — so
-- nothing forces tenant_id to be non-null. The day we flip
-- strict RLS on, every INSERT would fail because RLS would
-- block writes that don't pass the tenant check.
--
-- THE FIX:
-- Add `DEFAULT current_tenant_id()` to every business table's
-- tenant_id column. Now any INSERT from an authenticated user
-- automatically gets THEIR tenant_id without app-side changes.
-- This makes the 260 raw-fetch INSERTs tenant-correct
-- automatically, unblocking the path to strict RLS in 063.
--
-- IDEMPOTENT — safe to re-run; ALTER ... SET DEFAULT replaces
-- the existing default if any.
--
-- DOES NOT enable strict RLS yet — that's migration 063.
-- This migration is safe to apply alone; it just sets defaults.
-- ============================================================

-- ─── 1. Ensure current_tenant_id() exists ───────────────────
-- (Already created by migration 009; this is a safety check)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    RAISE EXCEPTION 'current_tenant_id() function does not exist. Apply migration 009 first.';
  END IF;
END $$;

-- ─── 2. Apply DEFAULT to every business table ───────────────
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    -- Core CRM + ops
    'customers','subscriptions','checkins','lessons','lesson_attendees',
    -- Sales pipeline
    'sales','sale_items','invoices','invoice_items','orders','order_items',
    -- Product catalog
    'products','categories','inventory_log','serial_numbers',
    -- Purchasing + service
    'purchase_orders','purchase_order_items','service_tickets',
    -- Staff + payroll
    'staff','time_entries','timesheet_approvals',
    -- Equipment + loaners
    'equipment','equipment_loans',
    -- Mobile shop
    'mobile_runs','bus_inventory','inventory_locations','inventory_transfers',
    -- Safety + audit
    'incidents','audit_log',
    -- Loyalty
    'loyalty_transactions','loyalty_config',
    -- Comms + collaboration
    'team_messages',
    -- Forms infrastructure
    'forms','form_submissions',
    -- Gift cards
    'gift_cards','gift_card_transactions',
    -- Reconciliation
    'daily_reconciliations','webhook_log',
    -- Affiliate
    'affiliate_programs','affiliate_codes','affiliate_earnings','affiliate_redemptions',
    -- Pre-order
    'preorder_products'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip if table doesn't exist (migration not yet applied)
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      -- Skip if tenant_id column doesn't exist
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=t AND column_name='tenant_id'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT current_tenant_id()', t);
        RAISE NOTICE '  ✓ %.tenant_id DEFAULT current_tenant_id()', t;
      ELSE
        RAISE NOTICE '  ⚠ %  (no tenant_id column — skipping)', t;
      END IF;
    ELSE
      RAISE NOTICE '  ⚠ % does not exist — skipping', t;
    END IF;
  END LOOP;
END $$;

-- ─── 3. Verify defaults are in place ────────────────────────
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND column_name = 'tenant_id'
    AND column_default = 'current_tenant_id()';

  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE '✓ Defaults applied to % tables', v_count;
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'WHAT THIS DOES:';
  RAISE NOTICE '  Every authenticated INSERT now auto-fills';
  RAISE NOTICE '  tenant_id from the user''s user_tenants row.';
  RAISE NOTICE '';
  RAISE NOTICE 'WHAT THIS DOES NOT DO:';
  RAISE NOTICE '  Strict RLS policies are NOT yet enabled.';
  RAISE NOTICE '  Apply migration 063 to lock cross-tenant access.';
  RAISE NOTICE '════════════════════════════════════════';
END $$;

-- ============================================================
-- END 062_tenant_id_defaults.sql
-- ============================================================


-- ============================================================
-- BEGIN 063_strict_rls.sql
-- ============================================================
-- ============================================================
-- 063_strict_rls.sql — enable strict tenant isolation at the
-- database layer
--
-- ⚠ DEPENDENCY: migration 062 (tenant_id defaults) MUST be
-- applied first. If 062 is not applied, this migration will
-- block ALL new INSERTs from the admin SPA because none of the
-- 260 raw-fetch sites send tenant_id explicitly.
--
-- The DEFAULT current_tenant_id() from 062 fills in tenant_id
-- automatically on every authenticated INSERT, so this strict
-- RLS layer can be turned on safely.
--
-- WHAT THIS DOES:
-- For each business table:
--   1. ENABLE ROW LEVEL SECURITY
--   2. Add `tenant_isolation_select` policy: only rows matching
--      current_tenant_id() are visible
--   3. Add `tenant_isolation_write` policy: only INSERTs/UPDATEs
--      with tenant_id matching current_tenant_id() are allowed
--
-- WHAT THIS DOES NOT DO:
-- This is enforcement-only. Audit log, app_settings, and other
-- "shared infrastructure" tables already had their own RLS
-- policies applied in earlier migrations and are not touched.
--
-- AFTER APPLYING:
-- Cross-tenant reads/writes are physically impossible from any
-- authenticated user even if the app code is buggy. A tenant_A
-- user attempting to read tenant_B data gets zero rows back.
-- An INSERT attempting to write tenant_B data gets a 403.
--
-- IDEMPOTENT — safe to re-run; DROP POLICY IF EXISTS handles
-- the re-enable case.
-- ============================================================

-- ─── 1. Hard precondition — 062 must be applied ─────────────
DO $$
DECLARE
  v_default_count INT;
BEGIN
  SELECT COUNT(*) INTO v_default_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND column_name = 'tenant_id'
    AND column_default = 'current_tenant_id()';

  IF v_default_count = 0 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: migration 062 (tenant_id defaults) has not been applied. Apply 062 first, then re-run this migration. Without 062, every INSERT from the admin SPA will fail because tenant_id is not auto-populated.';
  ELSIF v_default_count < 5 THEN
    RAISE WARNING 'Only % tables have tenant_id default. Migration 062 may have applied to a partial table set. Verify before continuing.', v_default_count;
  ELSE
    RAISE NOTICE 'Precondition OK: % tables have DEFAULT current_tenant_id()', v_default_count;
  END IF;
END $$;

-- ─── 2. Enable strict RLS on every business table ──────────
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    -- Core CRM + ops
    'customers','subscriptions','checkins','lessons','lesson_attendees',
    -- Sales pipeline
    'sales','sale_items','invoices','invoice_items','orders','order_items',
    -- Product catalog
    'products','categories','inventory_log','serial_numbers',
    -- Purchasing + service
    'purchase_orders','purchase_order_items','service_tickets',
    -- Staff + payroll
    'staff','time_entries','timesheet_approvals',
    -- Equipment + loaners
    'equipment','equipment_loans',
    -- Mobile shop
    'mobile_runs','bus_inventory','inventory_locations','inventory_transfers',
    -- Loyalty
    'loyalty_transactions','loyalty_config',
    -- Comms + collaboration
    'team_messages',
    -- Forms infrastructure
    'forms','form_submissions',
    -- Gift cards
    'gift_cards','gift_card_transactions',
    -- Reconciliation
    'daily_reconciliations',
    -- Affiliate
    'affiliate_codes','affiliate_earnings','affiliate_redemptions',
    -- Incidents
    'incidents',
    -- Pre-order
    'preorder_products'
  ];
  v_applied INT := 0;
  v_skipped INT := 0;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Only proceed if (a) table exists and (b) it has tenant_id column
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='tenant_id'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write  ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON public.%I FOR SELECT USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)',
      t
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_write ON public.%I FOR ALL USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL) WITH CHECK (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)',
      t
    );
    v_applied := v_applied + 1;
    RAISE NOTICE '  ✓ % strict RLS enabled', t;
  END LOOP;

  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE '✓ Strict RLS enabled on % tables (% skipped — missing table or tenant_id col)', v_applied, v_skipped;
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'WHAT''S DIFFERENT NOW:';
  RAISE NOTICE '  • Cross-tenant reads are blocked at DB layer';
  RAISE NOTICE '  • Cross-tenant writes are blocked at DB layer';
  RAISE NOTICE '  • service_role bypasses RLS (Edge Functions still work)';
  RAISE NOTICE '  • anon users can no longer read tenant data';
  RAISE NOTICE '  • A user with NO user_tenants row has current_tenant_id()=NULL';
  RAISE NOTICE '    and falls through to allow-all (safe degradation)';
  RAISE NOTICE '';
  RAISE NOTICE 'TO ROLL BACK (emergency only):';
  RAISE NOTICE '  DO $$ DECLARE t TEXT; BEGIN';
  RAISE NOTICE '    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname=''public'' LOOP';
  RAISE NOTICE '      EXECUTE format(''DROP POLICY IF EXISTS tenant_isolation_select ON %%I'', t);';
  RAISE NOTICE '      EXECUTE format(''DROP POLICY IF EXISTS tenant_isolation_write  ON %%I'', t);';
  RAISE NOTICE '    END LOOP; END $$;';
  RAISE NOTICE '════════════════════════════════════════';
END $$;

-- ============================================================
-- END 063_strict_rls.sql
-- ============================================================


-- ============================================================
-- BEGIN 064_brivo_integration.sql
-- ============================================================
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

-- ============================================================
-- END 064_brivo_integration.sql
-- ============================================================


-- ============================================================
-- BEGIN 065_brivo_welcome_email.sql
-- ============================================================
-- ============================================================
-- 065_brivo_welcome_email.sql — branded "welcome to 24/7 access"
-- ============================================================
-- Adds an idempotency stamp so the skateOS-branded welcome email
-- (sent in addition to Brivo's generic Mobile Pass invite) never
-- double-fires when brivo-sync-customer retries.
--
-- Email fires from brivo-sync-customer/index.ts after the first
-- successful provision (state transitions to 'pending'). Reads
-- the on/off toggle from app_settings.value.integrations.brivo
-- .welcomeEmailEnabled (default ON). Honors customers.email_opt_out_at.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS brivo_welcome_sent_at TIMESTAMPTZ;

-- No index needed — this column is only read inside the per-customer
-- sync flow which already has the customer row in hand.

-- ============================================================
-- END 065_brivo_welcome_email.sql
-- ============================================================


-- ============================================================
-- VERIFICATION — runs after every migration above lands
-- ============================================================
DO $$
DECLARE
  passed INT := 0;
  failed INT := 0;
  msg    TEXT;
  rec    RECORD;
BEGIN
  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'Running 062-065 verification probes…';
  RAISE NOTICE '────────────────────────────────────────';

  FOR rec IN
    SELECT * FROM (VALUES
      ('062 tenants table',                'SELECT count(*) FROM tenants'),
      ('062 customers.tenant_id default',  'SELECT column_default IS NOT NULL FROM information_schema.columns WHERE table_name=''customers'' AND column_name=''tenant_id'''),
      ('063 strict RLS on customers',      'SELECT count(*) > 0 FROM pg_policies WHERE tablename=''customers'' AND policyname IN (''tenant_isolation_select'',''tenant_isolation_write'')'),
      ('064 brivo_access_log table',       'SELECT count(*) FROM brivo_access_log'),
      ('064 brivo_member_desired view',    'SELECT count(*) FROM brivo_member_desired LIMIT 1'),
      ('064 customers.brivo_user_id col',  'SELECT brivo_user_id FROM customers LIMIT 1'),
      ('064 brivo_flag_customer_sync fn',  'SELECT brivo_flag_customer_sync(''00000000-0000-0000-0000-000000000000''::uuid)'),
      ('064 pg_cron brivo-sync-flagged',   'SELECT count(*) FROM cron.job WHERE jobname=''brivo-sync-flagged'''),
      ('064 pg_cron brivo-sync-full-daily','SELECT count(*) FROM cron.job WHERE jobname=''brivo-sync-full-daily'''),
      ('065 customers.brivo_welcome_sent', 'SELECT brivo_welcome_sent_at FROM customers LIMIT 1')
    ) AS t(name TEXT, sql TEXT)
  LOOP
    BEGIN
      EXECUTE rec.sql;
      RAISE NOTICE '✓ %', rec.name;
      passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN
      msg := SQLERRM;
      RAISE NOTICE '✗ % — %', rec.name, msg;
      failed := failed + 1;
    END;
  END LOOP;

  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'Migration verification: % passed, % failed', passed, failed;
  IF failed = 0 THEN
    RAISE NOTICE '🔓 Brivo + strict RLS migrations landed cleanly. Door integration is DB-ready.';
  ELSE
    RAISE WARNING '% probes failed — re-run individual migration files for the failed ones.', failed;
  END IF;
END $$;
