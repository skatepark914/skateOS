-- ============================================================
-- smoke-test.sql — verify migrations applied cleanly
--
-- Run this AFTER applying _apply_all_006_to_061.sql to verify
-- the database is in the expected end state. Reports any
-- missing tables, functions, triggers, or scheduled crons.
--
-- USAGE:
--   Paste into Supabase SQL editor → Run. Read the output rows
--   in the result panel. Anything with status='MISSING' needs
--   investigation before you let a customer near it.
--
-- IDEMPOTENT — read-only, safe to run anytime.
-- ============================================================

-- ─── 1. EXPECTED TABLES ──────────────────────────────────────
WITH expected_tables AS (
  SELECT unnest(ARRAY[
    'tenants','user_tenants',
    'customers','subscriptions','checkins','lessons','lesson_attendees',
    'sales','sale_items','invoices','invoice_items','orders','order_items',
    'products','categories','inventory_log','serial_numbers',
    'staff','time_entries','timesheet_approvals',
    'equipment','equipment_loans',
    'mobile_runs','bus_inventory','inventory_locations','inventory_transfers',
    'incidents','audit_log','app_settings',
    'loyalty_transactions','loyalty_config',
    'team_messages','forms','form_submissions',
    'gift_cards','gift_card_transactions',
    'daily_reconciliations','webhook_log',
    'affiliate_programs','affiliate_codes','affiliate_earnings','affiliate_redemptions',
    'preorder_products'
  ]) AS table_name
)
SELECT
  'TABLE' AS object_type,
  e.table_name AS object_name,
  CASE WHEN t.tablename IS NOT NULL THEN '✓ present' ELSE '✗ MISSING' END AS status
FROM expected_tables e
LEFT JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = e.table_name
ORDER BY status DESC, e.table_name;

-- ─── 2. EXPECTED RPC FUNCTIONS ───────────────────────────────
WITH expected_funcs AS (
  SELECT unnest(ARRAY[
    'search_customers',
    'search_notes',
    'current_tenant_id',
    'current_customer_id',
    'handle_new_user_skateos',
    'claim_customer_record',
    'customer_portal_summary',
    'loyalty_redeem',
    'loyalty_apply_delta',
    'loyalty_reverse_sale',
    'mark_lesson_no_shows',
    'reconcile_expected',
    'merge_customers',
    'auto_resume_paused_subs',
    'auto_checkout_lingering',
    'email_opt_out',
    'email_opt_in',
    'affiliate_code_lookup',
    'affiliate_attach_customer',
    'affiliate_program_public_list',
    'my_affiliate_dashboard',
    'gift_card_balance_lookup',
    'sum_payments_by_method',
    'customer_update_self',
    'customer_cancel_lesson',
    'transfer_to_bus',
    'transfer_from_bus',
    'provision_new_tenant',
    'seed_starter_data'
  ]) AS func_name
)
SELECT
  'FUNCTION' AS object_type,
  e.func_name AS object_name,
  CASE WHEN p.proname IS NOT NULL THEN '✓ present' ELSE '✗ MISSING' END AS status
FROM expected_funcs e
LEFT JOIN pg_proc p ON p.proname = e.func_name
ORDER BY status DESC, e.func_name;

-- ─── 3. EXPECTED TRIGGERS ────────────────────────────────────
WITH expected_triggers AS (
  SELECT unnest(ARRAY[
    'on_auth_user_created_skateos',
    'loyalty_apply_delta_trigger',
    'loyalty_reverse_sale_trigger',
    'apply_bus_sale_item',
    'audit_trigger',
    'waiver_set_expiry',
    'lesson_mirror_primary_attendee',
    'equipment_loan_status_sync',
    'affiliate_auto_earn',
    'affiliate_reverse_earnings'
  ]) AS trig_name
)
SELECT
  'TRIGGER' AS object_type,
  e.trig_name AS object_name,
  CASE WHEN t.tgname IS NOT NULL THEN '✓ present' ELSE '✗ MISSING' END AS status
FROM expected_triggers e
LEFT JOIN pg_trigger t ON t.tgname = e.trig_name
ORDER BY status DESC, e.trig_name;

-- ─── 4. pg_cron SCHEDULES ────────────────────────────────────
-- (Only present if pg_cron extension is enabled)
DO $$
DECLARE
  v_count INT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT COUNT(*) INTO v_count FROM cron.job;
    RAISE NOTICE 'pg_cron extension: ✓ enabled, % scheduled jobs', v_count;
  ELSE
    RAISE NOTICE 'pg_cron extension: ✗ NOT ENABLED (migration 016 may not have run)';
  END IF;
END $$;

-- List active cron schedules (will error gracefully if pg_cron not installed)
SELECT
  'CRON' AS object_type,
  jobname AS object_name,
  schedule || ' · ' || CASE WHEN active THEN '✓ active' ELSE '✗ disabled' END AS status
FROM cron.job
ORDER BY jobname;

-- ─── 5. RLS ENABLEMENT CHECK ─────────────────────────────────
SELECT
  'RLS' AS object_type,
  tablename AS object_name,
  CASE WHEN rowsecurity THEN '✓ enforced' ELSE '⚠ disabled' END AS status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('customers','sales','lessons','subscriptions','loyalty_transactions','checkins','tenants','user_tenants','affiliate_codes','affiliate_earnings')
ORDER BY tablename;

-- ─── 6. TENANT + USER COUNTS ─────────────────────────────────
SELECT
  'STATE' AS object_type,
  'tenants count' AS object_name,
  COUNT(*)::text AS status
FROM tenants
UNION ALL
SELECT
  'STATE',
  'auth users count',
  COUNT(*)::text
FROM auth.users
UNION ALL
SELECT
  'STATE',
  'user_tenants links',
  COUNT(*)::text
FROM user_tenants
UNION ALL
SELECT
  'STATE',
  'app_settings rows',
  COUNT(*)::text
FROM app_settings
UNION ALL
SELECT
  'STATE',
  'audit_log rows (1d)',
  COUNT(*)::text
FROM audit_log
WHERE at > NOW() - INTERVAL '1 day';

-- ─── 7. PRINTABLE SUMMARY ───────────────────────────────────
DO $$
DECLARE
  v_missing_tables INT;
  v_missing_funcs INT;
  v_missing_triggers INT;
  v_cron_count INT := 0;
BEGIN
  SELECT COUNT(*) INTO v_missing_tables
  FROM unnest(ARRAY[
    'tenants','user_tenants','customers','subscriptions','checkins','lessons',
    'lesson_attendees','sales','sale_items','products','categories','staff',
    'time_entries','equipment','equipment_loans','mobile_runs','bus_inventory',
    'inventory_locations','incidents','audit_log','app_settings',
    'loyalty_transactions','loyalty_config','team_messages','forms','form_submissions',
    'gift_cards','gift_card_transactions','daily_reconciliations','webhook_log',
    'affiliate_programs','affiliate_codes','affiliate_earnings','affiliate_redemptions',
    'preorder_products'
  ]) AS tbl
  WHERE NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=tbl);

  SELECT COUNT(*) INTO v_missing_funcs
  FROM unnest(ARRAY[
    'search_customers','search_notes','current_tenant_id','current_customer_id',
    'handle_new_user_skateos','claim_customer_record','customer_portal_summary',
    'loyalty_redeem','mark_lesson_no_shows','reconcile_expected','merge_customers',
    'auto_resume_paused_subs','auto_checkout_lingering','email_opt_out',
    'affiliate_code_lookup','affiliate_attach_customer','gift_card_balance_lookup',
    'customer_update_self','customer_cancel_lesson','transfer_to_bus','transfer_from_bus',
    'provision_new_tenant','seed_starter_data'
  ]) AS fn
  WHERE NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname=fn);

  SELECT COUNT(*) INTO v_missing_triggers
  FROM unnest(ARRAY[
    'on_auth_user_created_skateos','audit_trigger','waiver_set_expiry'
  ]) AS tr
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=tr);

  BEGIN
    SELECT COUNT(*) INTO v_cron_count FROM cron.job;
  EXCEPTION WHEN OTHERS THEN
    v_cron_count := -1;
  END;

  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE 'SMOKE TEST SUMMARY';
  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE 'Missing tables    : %', v_missing_tables;
  RAISE NOTICE 'Missing functions : %', v_missing_funcs;
  RAISE NOTICE 'Missing triggers  : %', v_missing_triggers;
  IF v_cron_count >= 0 THEN
    RAISE NOTICE 'pg_cron schedules : %', v_cron_count;
  ELSE
    RAISE NOTICE 'pg_cron schedules : extension NOT enabled';
  END IF;
  RAISE NOTICE '════════════════════════════════════════════════════';
  IF v_missing_tables = 0 AND v_missing_funcs = 0 AND v_missing_triggers = 0 AND v_cron_count > 0 THEN
    RAISE NOTICE '✓ ALL CHECKS PASSED — schema is in expected state';
  ELSE
    RAISE NOTICE '✗ ISSUES FOUND — see SELECT result rows above for details';
    RAISE NOTICE '  Most common cause: not all migrations were applied,';
    RAISE NOTICE '  OR pg_cron / pg_net extensions not enabled in Supabase';
    RAISE NOTICE '  Dashboard → Database → Extensions → enable both.';
  END IF;
  RAISE NOTICE '════════════════════════════════════════════════════';
END $$;
