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
