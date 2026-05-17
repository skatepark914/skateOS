-- ============================================================
-- 046_multi_tenant_part_b.sql — strict tenant isolation
--
-- This is the gate to onboarding a 2nd skatepark. Applies the
-- RLS isolation that 009_multi_tenant_part_a.sql deferred.
--
-- DESIGN — app-code DOESN'T have to change.
-- Instead of requiring every INSERT to populate tenant_id, this
-- migration adds a BEFORE INSERT trigger that auto-fills
-- tenant_id from current_tenant_id() when NULL. So existing
-- admin/index.html INSERTs work as-is.
--
-- WHAT THIS DOES:
--   1. Enhances handle_new_user_skateos: also creates a `staff`
--      row (role='owner') and an initial `app_settings` row from
--      auth.users.raw_user_meta_data so the new park has working
--      defaults the moment they log in.
--   2. Refactors `app_settings`: composite PK (tenant_id, key).
--      The existing key-only PK blocks 2nd tenant from creating
--      their own 'all' settings blob. (Admin app patched in same
--      sprint to use ?on_conflict=tenant_id,key.)
--   3. Patches `audit_trigger` to copy tenant_id from NEW/OLD
--      into audit_log so audit isolation works correctly.
--   4. Adds `auto_fill_tenant_id()` BEFORE INSERT trigger to
--      every business table — fills NULL tenant_id from
--      current_tenant_id() so admin code remains untouched.
--   5. Adds RESTRICTIVE RLS policies that require
--      tenant_id = current_tenant_id() on every business table.
--      Combined with the existing PERMISSIVE role policies
--      (is_staff()/is_owner()) via AND, giving us
--      "must be staff AND must be in the right tenant".
--
-- PREREQ: migration 009 must be applied. The function
-- current_tenant_id() and tenants/user_tenants tables must
-- already exist. This migration aborts if not.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Sanity check: migration 009 must have run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tenants')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_tenants') THEN
    RAISE EXCEPTION '046 requires migration 009 (multi-tenant part A). Apply it first.';
  END IF;
END $$;

-- Sanity check: confirm no NULL tenant_id in business tables (009 should have backfilled).
DO $$
DECLARE
  t        TEXT;
  bad_cnt  INT;
  tables   TEXT[] := ARRAY[
    'customers','subscriptions','checkins','lessons',
    'sales','sale_items','invoices','invoice_items','orders','order_items',
    'products','categories','inventory_log','serial_numbers',
    'purchase_orders','purchase_order_items','service_tickets',
    'loyalty_config','loyalty_transactions',
    'time_entries','timesheet_approvals',
    'staff','app_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
      EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id IS NULL', t) INTO bad_cnt;
      IF bad_cnt > 0 THEN
        RAISE WARNING '% has % rows with NULL tenant_id — they will be invisible after RLS turns on. Run a backfill UPDATE first.', t, bad_cnt;
      END IF;
    END IF;
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 1. Auto-fill trigger (shared across all business tables)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_fill_tenant_id() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only auto-fill on INSERT, only when NULL.
  IF TG_OP = 'INSERT' AND NEW.tenant_id IS NULL THEN
    NEW.tenant_id := current_tenant_id();
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_fill_tenant_id() TO authenticated, anon, service_role;

DO $$
DECLARE
  t      TEXT;
  tables TEXT[] := ARRAY[
    'customers','subscriptions','checkins','lessons',
    'sales','sale_items','invoices','invoice_items','orders','order_items',
    'products','categories','inventory_log','serial_numbers',
    'purchase_orders','purchase_order_items','service_tickets',
    'loyalty_config','loyalty_transactions',
    'time_entries','timesheet_approvals',
    'staff','app_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_auto_tenant_%I ON %I;', t, t);
      EXECUTE format('CREATE TRIGGER trg_auto_tenant_%I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION auto_fill_tenant_id();', t, t);
    END IF;
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 2. Refactor app_settings — composite PK (tenant_id, key)
--    Existing PK on key alone blocks 2nd-tenant signup.
-- ------------------------------------------------------------

-- Ensure tenant_id has a value on every row (009 backfilled, but defensively).
UPDATE app_settings
   SET tenant_id = (SELECT id FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1)
 WHERE tenant_id IS NULL;

ALTER TABLE app_settings ALTER COLUMN tenant_id SET NOT NULL;

-- Drop the existing key-only PK, then add the composite (tenant_id, key) PK.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_pkey') THEN
    ALTER TABLE app_settings DROP CONSTRAINT app_settings_pkey;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not drop app_settings_pkey: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_pkey') THEN
    ALTER TABLE app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (tenant_id, key);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add composite app_settings_pkey: %', SQLERRM;
END $$;


-- ------------------------------------------------------------
-- 3. Patch audit_trigger to populate audit_log.tenant_id
-- ------------------------------------------------------------

-- Ensure audit_log has tenant_id (009 should have added it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_log' AND column_name='tenant_id') THEN
    ALTER TABLE audit_log ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION audit_trigger() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_email TEXT;
  v_row_id      TEXT;
  v_tenant_id   UUID;
BEGIN
  SELECT email INTO v_actor_email FROM auth.users WHERE id = auth.uid();
  v_row_id := COALESCE(NEW.id::text, OLD.id::text);

  -- Copy tenant_id from the row being audited so audit isolation
  -- matches the source table's isolation.
  BEGIN
    v_tenant_id := COALESCE(
      (CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW)->>'tenant_id' ELSE NULL END)::uuid,
      (CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD)->>'tenant_id' ELSE NULL END)::uuid,
      current_tenant_id()
    );
  EXCEPTION WHEN OTHERS THEN
    v_tenant_id := current_tenant_id();
  END;

  INSERT INTO audit_log (actor_id, actor_email, action, tbl, row_id, old_values, new_values, tenant_id)
  VALUES (
    auth.uid(),
    v_actor_email,
    TG_OP,
    TG_TABLE_NAME,
    v_row_id,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    v_tenant_id
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- audit_log itself needs a RESTRICTIVE tenant-isolation policy
-- on top of the existing is_owner() read policy from migration 001.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit ON audit_log;
CREATE POLICY tenant_isolation_audit ON audit_log
  AS RESTRICTIVE
  FOR ALL
  USING (tenant_id = current_tenant_id());


-- ------------------------------------------------------------
-- 4. RESTRICTIVE tenant isolation policies on every business table
--    These combine with AND against existing role-based policies
--    from migration 001, so the final rule is:
--      "must be staff/owner AND row.tenant_id = current_tenant_id()"
-- ------------------------------------------------------------
DO $$
DECLARE
  t      TEXT;
  tables TEXT[] := ARRAY[
    -- Core
    'customers','subscriptions','checkins','lessons',
    -- Sales pipeline
    'sales','sale_items','invoices','invoice_items','orders','order_items',
    -- Catalog
    'products','categories','inventory_log','serial_numbers',
    -- Purchasing + service
    'purchase_orders','purchase_order_items','service_tickets',
    -- Loyalty
    'loyalty_config','loyalty_transactions',
    -- Timesheets
    'time_entries','timesheet_approvals',
    -- Staff + settings
    'staff','app_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t)
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN

      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I AS RESTRICTIVE FOR ALL '
        'USING (tenant_id = current_tenant_id()) '
        'WITH CHECK (tenant_id = current_tenant_id());',
        t
      );
    END IF;
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 5. Enhance handle_new_user_skateos:
--    On signup, also create the `staff` row (role='owner') and
--    a starter `app_settings` row from the user's metadata
--    so the new park can log in and immediately have a working
--    Settings page.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user_skateos() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  new_tid    UUID;
  biz_name   TEXT;
  biz_slug   TEXT;
  meta       JSONB;
BEGIN
  -- Skip if user already has a tenant (e.g., already provisioned).
  IF EXISTS (SELECT 1 FROM user_tenants WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  biz_name := COALESCE(
    meta->>'business_name',
    split_part(NEW.email, '@', 1) || ' Skatepark'
  );
  biz_slug := lower(regexp_replace(biz_name, '[^a-zA-Z0-9]+', '-', 'g'));

  -- Create the tenant with config seeded from signup metadata.
  INSERT INTO tenants (name, slug, owner_email, status, config)
  VALUES (
    biz_name,
    biz_slug,
    NEW.email,
    'beta',
    jsonb_build_object(
      'bizName',      biz_name,
      'bizShortName', biz_name,
      'bizShortAccent', '',
      'bizEmail',     NEW.email,
      'bizPhone',     COALESCE(meta->>'phone', ''),
      'bizAddr',      COALESCE(meta->>'address', ''),
      'bizWebsite',   COALESCE(meta->>'website', '')
    )
  )
  RETURNING id INTO new_tid;

  -- Link user to tenant as owner.
  INSERT INTO user_tenants (user_id, tenant_id, role)
  VALUES (NEW.id, new_tid, 'owner')
  ON CONFLICT DO NOTHING;

  -- Create the staff row so is_owner()/is_staff() return true.
  INSERT INTO staff (id, email, display_name, role, active, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(meta->>'display_name', biz_name || ' Owner'),
    'owner',
    true,
    new_tid
  )
  ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

  -- Seed a starter app_settings 'all' blob with biz info so the
  -- admin SPA has working defaults on first login.
  INSERT INTO app_settings (tenant_id, key, value)
  VALUES (
    new_tid,
    'all',
    jsonb_build_object(
      'bizName',      biz_name,
      'bizEmail',     NEW.email,
      'bizPhone',     COALESCE(meta->>'phone', ''),
      'bizAddr',      COALESCE(meta->>'address', ''),
      'bizWebsite',   COALESCE(meta->>'website', '')
    )
  )
  ON CONFLICT (tenant_id, key) DO NOTHING;

  RETURN NEW;
END;
$$;


-- ------------------------------------------------------------
-- 6. Drop redundant staff.email UNIQUE constraint
--    Already-PK-on-id; UNIQUE on email blocked some edge cases
--    (same person owning multiple parks would collide). Not
--    strictly required, but cleaner.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.staff'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) ILIKE '%(email)%'
  ) THEN
    -- Find and drop the unique constraint on email
    EXECUTE (
      SELECT 'ALTER TABLE staff DROP CONSTRAINT ' || quote_ident(conname)
        FROM pg_constraint
       WHERE conrelid = 'public.staff'::regclass
         AND contype = 'u'
         AND pg_get_constraintdef(oid) ILIKE '%(email)%'
       LIMIT 1
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not drop staff email UNIQUE constraint: %', SQLERRM;
END $$;


-- ------------------------------------------------------------
-- 7. Confirm 2ntr's existing data is still visible (smoke test
--    only logs a notice, doesn't fail the migration).
-- ------------------------------------------------------------
DO $$
DECLARE
  seed_tid  UUID;
  cust_cnt  INT;
BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*) FROM customers WHERE tenant_id = $1' INTO cust_cnt USING seed_tid;
    RAISE NOTICE '2ntr customers visible after 046: %', cust_cnt;
  END IF;
END $$;

-- ------------------------------------------------------------
-- END 046_multi_tenant_part_b.sql
-- ------------------------------------------------------------
