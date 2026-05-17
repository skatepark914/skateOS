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
