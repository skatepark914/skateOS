-- ============================================================
-- 009_multi_tenant_part_a.sql — multi-tenant SCHEMA prep (additive only)
--
-- Skate-shaped port of BM's `migrate-multi-tenant.sql` PART A
-- (see _bm-reference/migrations/migrate-multi-tenant.sql).
-- skateOS is explicitly designed as a white-label product
-- (per CLAUDE.md + SKATEOS_VS_SQUARE.md). When a 2nd skatepark
-- is ready to onboard, we'll do Phase 2 (app code) + Phase 3
-- (RLS lock). This migration only does Phase 1 — additive only,
-- non-breaking, safe to run on production today.
--
-- WHAT THIS DOES (safe):
--   1. Creates `tenants` + `user_tenants` tables.
--   2. Seeds the 2nd Nature Park tenant.
--   3. Adds nullable `tenant_id` column to every business table.
--   4. Backfills existing rows → 2nd Nature's tenant_id.
--   5. Creates `current_tenant_id()` helper (used by RLS in Phase 3).
--   6. Adds auto-provisioning trigger on auth.users so a 2nd
--      skatepark signing up gets their own tenant automatically.
--
-- WHAT THIS DOES NOT DO (deferred to Phase 3):
--   - Does NOT enable strict RLS isolation (commented PART B).
--   - Does NOT change app code (Phase 2 — touch admin/index.html
--     to scope queries by tenant_id).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. tenants — one row per skatepark deployment
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT UNIQUE,                              -- "2ntr", "stoke-park", etc. — used in URLs / config keys
  owner_email  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','beta','disabled','archived')),
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,       -- white-label overrides (theme, hours, business name, etc.)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- ------------------------------------------------------------
-- 2. Seed the 2nd Nature Park tenant
-- ------------------------------------------------------------
INSERT INTO tenants (name, slug, owner_email, status)
SELECT '2nd Nature Park', '2ntr', 'info@2ntr.com', 'active'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE owner_email = 'info@2ntr.com');

-- ------------------------------------------------------------
-- 3. user_tenants — which auth user belongs to which tenant
--    (lets a single user have access to multiple skateparks
--    in a future regional-operator scenario; nullable role
--    for Phase 1 since we already use staff.role)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_tenants (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','staff','instructor','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_user_tenants_user ON user_tenants(user_id);

-- ------------------------------------------------------------
-- 4. Add nullable tenant_id to every business table
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    -- Core CRM + ops
    'customers','subscriptions','checkins','lessons',
    -- Sales pipeline
    'sales','sale_items','invoices','invoice_items','orders','order_items',
    -- Product catalog
    'products','categories','inventory_log','serial_numbers',
    -- Purchasing + service
    'purchase_orders','purchase_order_items','service_tickets',
    -- Loyalty (006)
    'loyalty_config','loyalty_transactions',
    -- Timesheets (008)
    'time_entries','timesheet_approvals',
    -- Staff + audit
    'staff','audit_log','app_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;', t);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_tenant ON %I(tenant_id);', t, t);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5. Backfill existing rows → 2nd Nature's tenant
-- ------------------------------------------------------------
DO $$
DECLARE
  seed_tid UUID;
  t        TEXT;
  tables   TEXT[] := ARRAY[
    'customers','subscriptions','checkins','lessons',
    'sales','sale_items','invoices','invoice_items','orders','order_items',
    'products','categories','inventory_log','serial_numbers',
    'purchase_orders','purchase_order_items','service_tickets',
    'loyalty_config','loyalty_transactions',
    'time_entries','timesheet_approvals',
    'staff','audit_log','app_settings'
  ];
BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NULL THEN
    RAISE EXCEPTION 'Seed tenant for info@2ntr.com not found — aborting backfill.';
  END IF;

  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t)
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id') THEN
      EXECUTE format('UPDATE %I SET tenant_id = $1 WHERE tenant_id IS NULL;', t) USING seed_tid;
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 6. Helper: current user's tenant_id (used by Phase 3 RLS)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION current_tenant_id() TO authenticated, anon;

-- ------------------------------------------------------------
-- 7. RLS on tenants + user_tenants (read-only for non-owner;
--    owner can manage). This is safe to enable now because the
--    helper relations are tenant-aware by definition.
-- ------------------------------------------------------------
ALTER TABLE tenants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_read       ON tenants;
DROP POLICY IF EXISTS tenants_owner_edit ON tenants;
CREATE POLICY tenants_read       ON tenants FOR SELECT
  USING (id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()));
CREATE POLICY tenants_owner_edit ON tenants FOR UPDATE
  USING (
    id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() AND role = 'owner')
  ) WITH CHECK (TRUE);

DROP POLICY IF EXISTS user_tenants_read       ON user_tenants;
DROP POLICY IF EXISTS user_tenants_owner_edit ON user_tenants;
CREATE POLICY user_tenants_read ON user_tenants FOR SELECT
  USING (user_id = auth.uid()
      OR tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() AND role = 'owner'));
CREATE POLICY user_tenants_owner_edit ON user_tenants FOR ALL
  USING (
    tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() AND role = 'owner')
  ) WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() AND role = 'owner')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON tenants      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_tenants TO authenticated;
GRANT ALL ON tenants      TO service_role;
GRANT ALL ON user_tenants TO service_role;

-- ------------------------------------------------------------
-- 8. PART C — auto-provision tenant on signup
--    (Safe to run now — fires only on NEW auth.users inserts.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user_skateos() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_tid    UUID;
  biz_name   TEXT;
  biz_slug   TEXT;
BEGIN
  -- Skip if user already has a tenant (e.g., invited via user_tenants insert elsewhere)
  IF EXISTS (SELECT 1 FROM user_tenants WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  biz_name := COALESCE(
    NEW.raw_user_meta_data->>'business_name',
    split_part(NEW.email, '@', 1) || ' Skatepark'
  );
  biz_slug := lower(regexp_replace(biz_name, '[^a-zA-Z0-9]+', '-', 'g'));

  INSERT INTO tenants (name, slug, owner_email, status)
  VALUES (biz_name, biz_slug, NEW.email, 'beta')
  RETURNING id INTO new_tid;

  INSERT INTO user_tenants (user_id, tenant_id, role)
  VALUES (NEW.id, new_tid, 'owner');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_skateos ON auth.users;
CREATE TRIGGER on_auth_user_created_skateos
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_skateos();

-- ------------------------------------------------------------
-- 9. Link the existing info@2ntr.com user to the seed tenant
-- ------------------------------------------------------------
DO $$
DECLARE
  doug_uid UUID;
  seed_tid UUID;
BEGIN
  SELECT id INTO doug_uid FROM auth.users WHERE email = 'info@2ntr.com' LIMIT 1;
  SELECT id INTO seed_tid FROM tenants    WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF doug_uid IS NOT NULL AND seed_tid IS NOT NULL THEN
    INSERT INTO user_tenants (user_id, tenant_id, role)
    VALUES (doug_uid, seed_tid, 'owner')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ============================================================
-- PART B — STRICT RLS — DO NOT RUN UNTIL PHASE 2 (APP CODE) IS DONE
--
-- When ready to enforce isolation, copy the block below into
-- a new migration `010_multi_tenant_part_b.sql` and apply it.
-- Doing this BEFORE updating admin/index.html to send tenant_id
-- on every INSERT will block ALL new writes.
-- ============================================================
--
-- DO $$
-- DECLARE
--   t TEXT;
--   tables TEXT[] := ARRAY[
--     'customers','subscriptions','checkins','lessons',
--     'sales','sale_items','invoices','invoice_items','orders','order_items',
--     'products','categories','inventory_log','serial_numbers',
--     'purchase_orders','purchase_order_items','service_tickets',
--     'loyalty_config','loyalty_transactions',
--     'time_entries','timesheet_approvals',
--     'staff','audit_log','app_settings'
--   ];
-- BEGIN
--   FOREACH t IN ARRAY tables LOOP
--     IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
--       EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
--       EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I;', t);
--       EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write  ON %I;', t);
--       EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (tenant_id = current_tenant_id());', t);
--       EXECUTE format('CREATE POLICY tenant_isolation_write  ON %I FOR ALL    USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());', t);
--     END IF;
--   END LOOP;
-- END $$;

-- ------------------------------------------------------------
-- END 009_multi_tenant_part_a.sql
-- ------------------------------------------------------------
