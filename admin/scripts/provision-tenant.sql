-- ============================================================
-- provision-tenant.sql — onboard a new skateOS customer
--
-- ONE-PASTE tenant provisioning. Edit the variables at the top
-- of the bottom DO block with the new customer's info, then
-- paste the whole file into the Supabase SQL editor.
--
-- TWO WORKFLOWS supported:
--
-- (A) Hosted-trial / hosted-customer (we run their tenant):
--     Run this script in OUR Supabase project. The new tenant
--     is created here; we invite the owner via Supabase Auth
--     (Dashboard → Authentication → Invite User) using the same
--     email. The handle_new_user_skateos trigger sees the
--     existing tenant by email and skips creating a duplicate.
--
-- (B) Deploy-your-own (customer runs their own Supabase):
--     The customer first pastes `_apply_all_006_to_061.sql` into
--     THEIR Supabase. They sign up as the first user (which
--     auto-provisions a tenant via the trigger with default
--     name/slug). Then run this script in THEIR Supabase to
--     reconfigure the auto-created tenant with the agreed
--     branding/business config.
--
-- IDEMPOTENT — safe to re-run. If a tenant already exists with
-- the same owner_email, this updates the existing row.
-- ============================================================

-- ─── HELPER FUNCTIONS ─────────────────────────────────────────

-- ------------------------------------------------------------
-- provision_new_tenant: create or update a tenant + apply
-- business defaults to app_settings. Returns the tenant_id.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION provision_new_tenant(
  p_business_name  TEXT,
  p_slug           TEXT,
  p_owner_email    TEXT,
  p_business_phone TEXT DEFAULT NULL,
  p_business_addr  TEXT DEFAULT NULL,
  p_tax_rate       NUMERIC DEFAULT 0.08375,           -- 8.375% NY Westchester default
  p_status         TEXT DEFAULT 'beta',
  p_industry       TEXT DEFAULT 'skatepark'            -- skatepark | tree_care | other
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id  UUID;
  v_existing   UUID;
BEGIN
  -- Look for existing tenant by owner_email
  SELECT id INTO v_existing FROM tenants WHERE owner_email = p_owner_email;

  IF v_existing IS NOT NULL THEN
    -- Update existing tenant in place
    UPDATE tenants SET
      name = p_business_name,
      slug = p_slug,
      status = p_status,
      config = config || jsonb_build_object(
        'industry', p_industry,
        'businessPhone', p_business_phone,
        'businessAddress', p_business_addr,
        'salesTaxRate', p_tax_rate,
        'provisioned_at', NOW()::text
      )
    WHERE id = v_existing;
    v_tenant_id := v_existing;
    RAISE NOTICE 'Updated existing tenant % for %', v_tenant_id, p_owner_email;
  ELSE
    -- Create fresh tenant
    INSERT INTO tenants (name, slug, owner_email, status, config)
    VALUES (
      p_business_name,
      p_slug,
      p_owner_email,
      p_status,
      jsonb_build_object(
        'industry', p_industry,
        'businessPhone', p_business_phone,
        'businessAddress', p_business_addr,
        'salesTaxRate', p_tax_rate,
        'provisioned_at', NOW()::text
      )
    )
    RETURNING id INTO v_tenant_id;
    RAISE NOTICE 'Created tenant % for %', v_tenant_id, p_owner_email;
  END IF;

  -- Apply business-config defaults to app_settings (if app_settings
  -- is tenant-scoped per future migrations, this should be scoped
  -- with tenant_id; for now we upsert a global "all" config row).
  INSERT INTO app_settings (key, value)
  VALUES ('all', jsonb_build_object(
    'bizName', p_business_name,
    'bizPhone', p_business_phone,
    'bizAddress', p_business_addr,
    'salesTaxRate', p_tax_rate,
    'industry', p_industry,
    'operations', jsonb_build_object(
      'calDayStart', '9:00',
      'calDayEnd', '21:00',
      'tipPresets', ARRAY[15, 20, 25],
      'noShowWindowMin', 30,
      'lowPunchThreshold', 2,
      'renewalThreshold', 2,
      'voidWindowMin', 10,
      'mobileBusChecklist', ARRAY[
        'Gear loaded',
        'Fuel topped',
        'iPad charged',
        'Cash float counted',
        'Backup phone'
      ]
    ),
    'loyalty', jsonb_build_object(
      'enabled', true,
      'pointsPerDollar', 1,
      'pointsPerCheckin', 5,
      'pointsToDollar', 100
    ),
    'features', jsonb_build_object(
      'mobileBus', false,
      'rentals', false,
      'giftCards', true,
      'partyBooker', true,
      'affiliateProgram', false
    )
  ))
  ON CONFLICT (key) DO UPDATE SET
    value = app_settings.value || EXCLUDED.value;

  RETURN v_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION provision_new_tenant TO service_role;

-- ------------------------------------------------------------
-- seed_starter_data: create starter categories + sample
-- products + sample staff for a fresh tenant. Skip if any
-- products already exist (customer has done their own setup).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_starter_data(
  p_tenant_id UUID,
  p_industry  TEXT DEFAULT 'skatepark'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cat_passes   UUID;
  v_cat_retail   UUID;
  v_cat_rental   UUID;
  v_cat_lessons  UUID;
BEGIN
  -- Skip if products already exist for this tenant
  IF EXISTS (SELECT 1 FROM products WHERE tenant_id = p_tenant_id LIMIT 1) THEN
    RAISE NOTICE 'Skipping seed: products already exist for tenant %', p_tenant_id;
    RETURN;
  END IF;

  -- Categories
  INSERT INTO categories (tenant_id, name, sort_order) VALUES
    (p_tenant_id, 'Passes', 1) RETURNING id INTO v_cat_passes;
  INSERT INTO categories (tenant_id, name, sort_order) VALUES
    (p_tenant_id, 'Retail', 2) RETURNING id INTO v_cat_retail;
  INSERT INTO categories (tenant_id, name, sort_order) VALUES
    (p_tenant_id, 'Rentals', 3) RETURNING id INTO v_cat_rental;
  INSERT INTO categories (tenant_id, name, sort_order) VALUES
    (p_tenant_id, 'Lessons', 4) RETURNING id INTO v_cat_lessons;

  IF p_industry = 'skatepark' THEN
    INSERT INTO products (tenant_id, name, sku, price, quantity, category_id, status) VALUES
      (p_tenant_id, 'Day Pass — Adult',   'PASS-ADULT',  25.00, 9999, v_cat_passes, 'active'),
      (p_tenant_id, 'Day Pass — Youth',   'PASS-YOUTH',  20.00, 9999, v_cat_passes, 'active'),
      (p_tenant_id, '10-Pack Punch Card', 'PUNCH-10',   200.00, 9999, v_cat_passes, 'active'),
      (p_tenant_id, 'Monthly Unlimited',  'MEMB-MONTH',  85.00, 9999, v_cat_passes, 'active'),
      (p_tenant_id, 'Helmet Rental',      'RENT-HELM',    5.00, 9999, v_cat_rental, 'active'),
      (p_tenant_id, 'Pad Set Rental',     'RENT-PAD',     5.00, 9999, v_cat_rental, 'active'),
      (p_tenant_id, 'Private Lesson',     'LSN-PRIVATE',  60.00, 9999, v_cat_lessons,'active'),
      (p_tenant_id, 'Group Lesson',       'LSN-GROUP',    30.00, 9999, v_cat_lessons,'active');
  ELSIF p_industry = 'tree_care' THEN
    INSERT INTO products (tenant_id, name, sku, price, quantity, category_id, status) VALUES
      (p_tenant_id, 'Tree Removal — Standard', 'JOB-REMOVAL',  800.00, 9999, v_cat_passes, 'active'),
      (p_tenant_id, 'Pruning — Half Day',      'JOB-PRUNE-H',  400.00, 9999, v_cat_passes, 'active'),
      (p_tenant_id, 'Stump Grinding',          'JOB-STUMP',    250.00, 9999, v_cat_passes, 'active'),
      (p_tenant_id, 'Emergency Storm Call',    'JOB-STORM',    600.00, 9999, v_cat_passes, 'active');
  END IF;

  RAISE NOTICE 'Seeded starter data for tenant % (industry: %)', p_tenant_id, p_industry;
END;
$$;

GRANT EXECUTE ON FUNCTION seed_starter_data TO service_role;

-- ─── ACTUAL PROVISIONING — EDIT THE VALUES BELOW ──────────────
-- ============================================================
-- Edit these variables for the new customer, then run the
-- whole block.
-- ============================================================

DO $$
DECLARE
  -- ─── EDIT THESE FOR EACH NEW CUSTOMER ─────────────────────
  v_business_name  TEXT := 'Acme Skatepark';
  v_slug           TEXT := 'acme-skatepark';            -- URL-safe, lowercase, hyphens
  v_owner_email    TEXT := 'owner@acmeskatepark.com';
  v_business_phone TEXT := '(555) 123-4567';
  v_business_addr  TEXT := '123 Main St, Anytown, NY 10000';
  v_tax_rate       NUMERIC := 0.08375;                  -- 8.375% NY Westchester
  v_status         TEXT := 'beta';                      -- beta | active | disabled
  v_industry       TEXT := 'skatepark';                 -- skatepark | tree_care
  v_seed_data      BOOLEAN := true;                     -- Seed starter products?
  -- ──────────────────────────────────────────────────────────

  v_tenant_id UUID;
BEGIN
  v_tenant_id := provision_new_tenant(
    v_business_name,
    v_slug,
    v_owner_email,
    v_business_phone,
    v_business_addr,
    v_tax_rate,
    v_status,
    v_industry
  );

  IF v_seed_data THEN
    PERFORM seed_starter_data(v_tenant_id, v_industry);
  END IF;

  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE '✓ Provisioning complete';
  RAISE NOTICE '  Tenant: %', v_tenant_id;
  RAISE NOTICE '  Business: %', v_business_name;
  RAISE NOTICE '  Owner email: %', v_owner_email;
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'NEXT STEPS:';
  RAISE NOTICE '1. Invite the owner via Supabase Dashboard:';
  RAISE NOTICE '   Authentication → Users → Invite User → %', v_owner_email;
  RAISE NOTICE '2. Owner receives magic-link email, clicks to sign up';
  RAISE NOTICE '3. handle_new_user_skateos trigger sees existing tenant';
  RAISE NOTICE '   by email and links them as owner role';
  RAISE NOTICE '4. Owner logs in to admin SPA; can immediately operate';
  RAISE NOTICE '════════════════════════════════════════';
END;
$$;
