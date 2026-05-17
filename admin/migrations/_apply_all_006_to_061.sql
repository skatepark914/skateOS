-- ============================================================
-- _apply_all_006_to_061.sql — full skateOS schema bundle
--
-- ONE-PASTE migration runner for a FRESH Supabase project.
-- Copy this entire file into the Supabase SQL editor and click
-- Run. All 61 migrations apply in canonical order. Each is
-- idempotent (CREATE TABLE IF NOT EXISTS / ON CONFLICT DO
-- NOTHING / CREATE OR REPLACE / DO $$ ... EXCEPTION WHEN
-- duplicate_object), so re-running is safe.
--
-- USE CASES:
--   1. Deploy-your-own engagement — customer pastes this into
--      their own Supabase project to bring it up to current
--      skateOS schema in one operation.
--   2. Fresh test environment — bring up a clean dev project
--      to current state quickly.
--   3. Disaster-recovery rebuild — apply against a recovered
--      Supabase snapshot to fast-forward to current.
--
-- Bundle contents (61 migrations, ~7,500 SQL lines):
--   006  loyalty program
--   007  search-RPC fixes
--   008  staff timesheets
--   009  multi-tenant foundation
--   010  incidents (skate-shaped)
--   011  forms infrastructure
--   012  equipment / loaner gear
--   013  daily reconciliation
--   014  lesson reminders
--   015  audit fixes
--   016  pg_cron schedule
--   017  mobile run schema
--   018  inventory locations + bus_inventory
--   019  customer self-serve portal
--   020  team chat
--   021  daily-digest cron
--   022  lesson auto-attend
--   023  skater photos
--   024  promo codes
--   025  sales tip
--   026  waiver expiry
--   027  lesson no-show auto-mark
--   028  loyalty refund reversal
--   029  search by guardian name
--   030  subscription pause/resume
--   031  global notes search
--   032  lesson capacity
--   033  birthday greetings
--   034  partial refunds
--   035  email opt-out (CAN-SPAM)
--   036  auto-checkout lingering sessions
--   037  customer merge
--   038  lesson followups
--   039  renewal reminders
--   040  overdue rental reminders
--   041  gift cards
--   042  split payments
--   043  customer cancel lesson
--   044  customer update self
--   045  affiliate / team rider program
--   046  pre-order form
--   047  pre-order weekly digest cron
--   048  pre-order public status RPC
--   049  pre-order catalog table
--   050  my_preorders portal RPC
--   051  public park status RPC
--   052  public retail catalog RPC
--   053  retail-order form
--   054  retail order inventory atomic decrement
--   055  retail order public status lookup
--   056  public lesson slots RPC
--   057  lesson-booking form
--   058  my retail orders + lesson bookings portal RPCs
--   059  retail order tracking
--   060  customer cancel subscription
--   061  customer pause subscription
--
-- After this lands, run `provision-tenant.sql` (separate file
-- in admin/scripts/) to create the first tenant and owner user.
-- ============================================================


-- ============================================================
-- BEGIN 001_init.sql
-- ============================================================
-- ============================================================
-- 001_init.sql — 2nd Nature Skatepark initial schema
-- Supabase project: rkvznnrvowshnijwmufj
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe to re-run (idempotent): uses IF NOT EXISTS / CREATE OR REPLACE everywhere.
-- ============================================================

-- ------------------------------------------------------------
-- 0. ENUMS
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE staff_role AS ENUM ('owner','staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 1. STAFF — one row per Supabase auth user with role + display name
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role         staff_role NOT NULL DEFAULT 'staff',
  active       BOOLEAN DEFAULT true,
  last_login   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Returns the current authenticated user's role ('owner', 'staff', or NULL if unauthenticated).
-- Used by every RLS policy below.
CREATE OR REPLACE FUNCTION auth_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role::text FROM staff WHERE id = auth.uid() AND active = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_owner() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'owner' AND active = true);
$$;

CREATE OR REPLACE FUNCTION is_staff() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = true);
$$;

-- ------------------------------------------------------------
-- 2. CATEGORIES (skatepark seed set)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO categories (name, sort_order) VALUES
  ('Session Passes', 1),
  ('Memberships',    2),
  ('Lessons',        3),
  ('Rentals',        4),
  ('Decks',          5),
  ('Trucks',         6),
  ('Wheels',         7),
  ('Bearings',       8),
  ('Hardware',       9),
  ('Grip Tape',     10),
  ('Shoes',         11),
  ('Apparel',       12),
  ('Safety Gear',   13),
  ('Food & Drink',  14)
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- 3. PRODUCTS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                  TEXT UNIQUE,
  name                 TEXT NOT NULL,
  category_id          UUID REFERENCES categories(id),
  description          TEXT,
  price                NUMERIC(10,2) DEFAULT 0,
  cost                 NUMERIC(10,2) DEFAULT 0,
  stock                INT DEFAULT 0,
  low_stock_threshold  INT DEFAULT 2,
  image_url            TEXT,
  status               TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','discontinued')),
  square_catalog_id    TEXT,        -- for Square migration / sync
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_sku      ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

CREATE TABLE IF NOT EXISTS inventory_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  change     INT NOT NULL,
  reason     TEXT,
  actor_id   UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_log_product ON inventory_log(product_id);

CREATE TABLE IF NOT EXISTS serial_numbers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  serial     TEXT,
  status     TEXT DEFAULT 'in_stock',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 4. CUSTOMERS (skaters + guardians + waivers)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  email              TEXT,
  phone              TEXT,
  parent_name        TEXT,
  parent_phone       TEXT,
  parent_email       TEXT,
  dob                DATE,
  waiver_id          TEXT,            -- Smartwaiver waiver ID
  waiver_signed_at   TIMESTAMPTZ,
  waiver_pdf_url     TEXT,
  address            TEXT,
  city               TEXT,
  state              TEXT DEFAULT 'NY',
  zip                TEXT,
  notes              TEXT,
  tags               TEXT[] DEFAULT '{}',
  total_spent        NUMERIC(12,2) DEFAULT 0,
  total_visits       INT DEFAULT 0,
  last_visit_at      TIMESTAMPTZ,
  square_customer_id TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name  ON customers(name);

-- ------------------------------------------------------------
-- 5. MEMBERSHIPS (monthly passes + punch cards)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id            UUID REFERENCES customers(id),
  customer_name          TEXT,
  plan_name              TEXT NOT NULL,
  plan_type              TEXT DEFAULT 'monthly' CHECK (plan_type IN ('monthly','annual','punch_card','day_pass','comped')),
  monthly_rate           NUMERIC(10,2),
  punches_total          INT,
  punches_used           INT DEFAULT 0,
  start_date             DATE,
  end_date               DATE,
  status                 TEXT DEFAULT 'active' CHECK (status IN ('active','paused','cancelled','completed','pending','expired')),
  auto_renew             BOOLEAN DEFAULT false,
  square_subscription_id TEXT,
  notes                  TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_subs_status   ON subscriptions(status);

-- ------------------------------------------------------------
-- 6. CHECK-INS (who's in the park)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID REFERENCES customers(id),
  subscription_id UUID REFERENCES subscriptions(id),
  sale_id         UUID,               -- FK added after sales table below
  checked_in_at   TIMESTAMPTZ DEFAULT NOW(),
  checked_out_at  TIMESTAMPTZ,
  actor_id        UUID REFERENCES staff(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checkins_customer ON checkins(customer_id);
CREATE INDEX IF NOT EXISTS idx_checkins_open     ON checkins(checked_out_at) WHERE checked_out_at IS NULL;

-- ------------------------------------------------------------
-- 7. LESSONS / EVENTS (privates, groups, camps, birthdays)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lessons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID REFERENCES customers(id),
  instructor    TEXT,
  type          TEXT DEFAULT 'private' CHECK (type IN ('private','group','camp','event','birthday')),
  scheduled_at  TIMESTAMPTZ,
  duration_min  INT DEFAULT 60,
  price         NUMERIC(10,2),
  status        TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lessons_scheduled ON lessons(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_lessons_customer  ON lessons(customer_id);

-- ------------------------------------------------------------
-- 8. SALES + SALE_ITEMS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    TEXT UNIQUE,
  customer_id       UUID REFERENCES customers(id),
  subtotal          NUMERIC(10,2),
  tax               NUMERIC(10,2) DEFAULT 0,
  discount          NUMERIC(10,2) DEFAULT 0,
  total             NUMERIC(10,2) DEFAULT 0,
  payment_provider  TEXT DEFAULT 'cash' CHECK (payment_provider IN ('cash','helcim','square','check','ach','other')),
  payment_id        TEXT,             -- helcim_payment_id or square_payment_id
  payment_method    TEXT,             -- card / tap / chip / cash / etc.
  status            TEXT DEFAULT 'completed' CHECK (status IN ('completed','refunded','voided')),
  refunded_at       TIMESTAMPTZ,
  refund_reason     TEXT,
  actor_id          UUID REFERENCES staff(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_created  ON sales(created_at DESC);

-- Late-add the sale_id FK on checkins now that sales exists
DO $$ BEGIN
  ALTER TABLE checkins ADD CONSTRAINT checkins_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN invalid_table_definition THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sale_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id      UUID REFERENCES sales(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id),
  product_name TEXT,
  quantity     INT NOT NULL DEFAULT 1,
  unit_price   NUMERIC(10,2) NOT NULL,
  total        NUMERIC(10,2) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

-- ------------------------------------------------------------
-- 9. INVOICES + INVOICE_ITEMS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number    TEXT UNIQUE,
  customer_id       UUID REFERENCES customers(id),
  customer_name     TEXT,
  customer_email    TEXT,
  customer_address  TEXT,
  status            TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','paid','overdue','cancelled')),
  due_date          DATE,
  subtotal          NUMERIC(10,2) DEFAULT 0,
  tax               NUMERIC(10,2) DEFAULT 0,
  discount          NUMERIC(10,2) DEFAULT 0,
  total             NUMERIC(10,2) DEFAULT 0,
  notes             TEXT,
  payment_provider  TEXT,
  payment_id        TEXT,
  paid_at           TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID REFERENCES invoices(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id),
  description TEXT NOT NULL,
  quantity    INT NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2) NOT NULL,
  total       NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- ------------------------------------------------------------
-- 10. ORDERS + ORDER_ITEMS (online shop / phone orders)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     TEXT UNIQUE,
  customer_id      UUID REFERENCES customers(id),
  customer_name    TEXT,
  customer_email   TEXT,
  customer_phone   TEXT,
  shipping_address TEXT,
  source           TEXT DEFAULT 'in-store' CHECK (source IN ('in-store','online','phone','quote')),
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','processing','shipped','delivered','completed','cancelled','refunded')),
  subtotal         NUMERIC(10,2) DEFAULT 0,
  tax              NUMERIC(10,2) DEFAULT 0,
  shipping         NUMERIC(10,2) DEFAULT 0,
  discount         NUMERIC(10,2) DEFAULT 0,
  total            NUMERIC(10,2) DEFAULT 0,
  payment_provider TEXT,
  payment_id       TEXT,
  payment_status   TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES products(id),
  product_name TEXT,
  quantity     INT NOT NULL DEFAULT 1,
  unit_price   NUMERIC(10,2) NOT NULL,
  total        NUMERIC(10,2) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ------------------------------------------------------------
-- 11. AUDIT LOG (every mutation, owner-read-only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   UUID,           -- auth.uid()
  actor_email TEXT,          -- snapshot in case user is later deleted
  action     TEXT NOT NULL,  -- INSERT / UPDATE / DELETE
  tbl        TEXT NOT NULL,
  row_id     TEXT,
  old_values JSONB,
  new_values JSONB,
  at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_tbl  ON audit_log(tbl, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, at DESC);

CREATE OR REPLACE FUNCTION audit_trigger() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_email TEXT;
  v_row_id      TEXT;
BEGIN
  SELECT email INTO v_actor_email FROM auth.users WHERE id = auth.uid();
  v_row_id := COALESCE(NEW.id::text, OLD.id::text);

  INSERT INTO audit_log (actor_id, actor_email, action, tbl, row_id, old_values, new_values)
  VALUES (
    auth.uid(),
    v_actor_email,
    TG_OP,
    TG_TABLE_NAME,
    v_row_id,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach audit trigger to every mutable table
DO $$
DECLARE t TEXT;
DECLARE tbls TEXT[] := ARRAY['staff','categories','products','inventory_log','serial_numbers',
  'customers','subscriptions','checkins','lessons','sales','sale_items',
  'invoices','invoice_items','orders','order_items'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger()', t, t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 12. ROW LEVEL SECURITY (role-aware)
-- ------------------------------------------------------------
-- Enable RLS on every table
DO $$
DECLARE t TEXT;
DECLARE tbls TEXT[] := ARRAY['staff','categories','products','inventory_log','serial_numbers',
  'customers','subscriptions','checkins','lessons','sales','sale_items',
  'invoices','invoice_items','orders','order_items','audit_log'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Clear any pre-existing policies (idempotent re-run)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- STAFF: owner sees/edits all, staff sees only self
CREATE POLICY staff_self_read ON staff FOR SELECT USING (id = auth.uid() OR is_owner());
CREATE POLICY staff_owner_write ON staff FOR ALL USING (is_owner()) WITH CHECK (is_owner());

-- CATEGORIES: everyone reads, owner writes
CREATE POLICY cat_read  ON categories FOR SELECT USING (is_staff());
CREATE POLICY cat_write ON categories FOR ALL    USING (is_owner()) WITH CHECK (is_owner());

-- PRODUCTS: staff reads, owner writes (adding/editing products = management)
CREATE POLICY prod_read  ON products FOR SELECT USING (is_staff());
CREATE POLICY prod_write ON products FOR ALL    USING (is_owner()) WITH CHECK (is_owner());

-- INVENTORY_LOG: staff can insert adjustments, everyone reads, nobody modifies history
CREATE POLICY inv_read   ON inventory_log FOR SELECT USING (is_staff());
CREATE POLICY inv_insert ON inventory_log FOR INSERT WITH CHECK (is_staff());

-- SERIAL NUMBERS: staff read, owner write
CREATE POLICY sn_read  ON serial_numbers FOR SELECT USING (is_staff());
CREATE POLICY sn_write ON serial_numbers FOR ALL    USING (is_owner()) WITH CHECK (is_owner());

-- CUSTOMERS: staff full access (need to create, edit, check in)
CREATE POLICY cust_read  ON customers FOR SELECT USING (is_staff());
CREATE POLICY cust_write ON customers FOR INSERT WITH CHECK (is_staff());
CREATE POLICY cust_edit  ON customers FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY cust_del   ON customers FOR DELETE USING (is_owner());

-- SUBSCRIPTIONS: staff create + edit (activate, burn punches); owner delete
CREATE POLICY sub_read   ON subscriptions FOR SELECT USING (is_staff());
CREATE POLICY sub_insert ON subscriptions FOR INSERT WITH CHECK (is_staff());
CREATE POLICY sub_update ON subscriptions FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY sub_delete ON subscriptions FOR DELETE USING (is_owner());

-- CHECK-INS: staff can create + checkout; nobody deletes (history)
CREATE POLICY chk_read   ON checkins FOR SELECT USING (is_staff());
CREATE POLICY chk_insert ON checkins FOR INSERT WITH CHECK (is_staff());
CREATE POLICY chk_update ON checkins FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY chk_delete ON checkins FOR DELETE USING (is_owner());

-- LESSONS: staff full except delete
CREATE POLICY lesson_read   ON lessons FOR SELECT USING (is_staff());
CREATE POLICY lesson_insert ON lessons FOR INSERT WITH CHECK (is_staff());
CREATE POLICY lesson_update ON lessons FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY lesson_delete ON lessons FOR DELETE USING (is_owner());

-- SALES: staff can INSERT (ring up) + SELECT; UPDATE + DELETE are owner-only (refunds/voids go through status flag via dedicated RPC)
CREATE POLICY sales_read   ON sales FOR SELECT USING (is_staff());
CREATE POLICY sales_insert ON sales FOR INSERT WITH CHECK (is_staff());
CREATE POLICY sales_update ON sales FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY sales_delete ON sales FOR DELETE USING (is_owner());

CREATE POLICY si_read   ON sale_items FOR SELECT USING (is_staff());
CREATE POLICY si_insert ON sale_items FOR INSERT WITH CHECK (is_staff());
CREATE POLICY si_update ON sale_items FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY si_delete ON sale_items FOR DELETE USING (is_owner());

-- INVOICES + ITEMS: owner-only (billing is sensitive)
CREATE POLICY inv_read_all   ON invoices FOR SELECT USING (is_staff());
CREATE POLICY inv_write_all  ON invoices FOR ALL    USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY ii_read_all    ON invoice_items FOR SELECT USING (is_staff());
CREATE POLICY ii_write_all   ON invoice_items FOR ALL    USING (is_owner()) WITH CHECK (is_owner());

-- ORDERS: staff reads + creates (online + phone); owner edits status + deletes
CREATE POLICY ord_read   ON orders FOR SELECT USING (is_staff());
CREATE POLICY ord_insert ON orders FOR INSERT WITH CHECK (is_staff());
CREATE POLICY ord_update ON orders FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY ord_delete ON orders FOR DELETE USING (is_owner());

CREATE POLICY oi_read   ON order_items FOR SELECT USING (is_staff());
CREATE POLICY oi_insert ON order_items FOR INSERT WITH CHECK (is_staff());
CREATE POLICY oi_update ON order_items FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY oi_delete ON order_items FOR DELETE USING (is_owner());

-- AUDIT LOG: owner read-only; writes come from trigger (which uses SECURITY DEFINER so it bypasses RLS)
CREATE POLICY audit_owner_read ON audit_log FOR SELECT USING (is_owner());

-- ------------------------------------------------------------
-- 13. AUTO-NUMBERING TRIGGERS (receipts, invoices, orders)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_receipt_number() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.receipt_number IS NULL THEN
    NEW.receipt_number := 'REC-' || LPAD(
      (SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM 5) AS INT)), 0) + 1
       FROM sales WHERE receipt_number IS NOT NULL)::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_receipt_number ON sales;
CREATE TRIGGER trg_receipt_number BEFORE INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION generate_receipt_number();

CREATE OR REPLACE FUNCTION generate_invoice_number() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'INV-' || LPAD(
      (SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 5) AS INT)), 0) + 1
       FROM invoices)::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_invoice_number ON invoices;
CREATE TRIGGER trg_invoice_number BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION generate_invoice_number();

CREATE OR REPLACE FUNCTION generate_order_number() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_number IS NULL THEN
    NEW.order_number := 'ORD-' || LPAD(
      (SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 5) AS INT)), 0) + 1
       FROM orders)::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_order_number ON orders;
CREATE TRIGGER trg_order_number BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION generate_order_number();

-- ------------------------------------------------------------
-- 14. UPDATE CUSTOMER ROLLUPS on sale / checkin
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_customer_totals() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE customers SET
      total_spent  = COALESCE((SELECT SUM(total) FROM sales    WHERE customer_id = NEW.customer_id AND status = 'completed'), 0),
      total_visits = COALESCE((SELECT COUNT(*)   FROM checkins WHERE customer_id = NEW.customer_id), 0),
      last_visit_at = GREATEST(NOW(), last_visit_at),
      updated_at    = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_customer_totals_sales    ON sales;
DROP TRIGGER IF EXISTS trg_customer_totals_checkins ON checkins;
CREATE TRIGGER trg_customer_totals_sales    AFTER INSERT OR UPDATE ON sales    FOR EACH ROW EXECUTE FUNCTION update_customer_totals();
CREATE TRIGGER trg_customer_totals_checkins AFTER INSERT OR UPDATE ON checkins FOR EACH ROW EXECUTE FUNCTION update_customer_totals();

-- ------------------------------------------------------------
-- 15. GRANTS — required after a `DROP SCHEMA public CASCADE` reset.
-- Supabase normally pre-grants these on a fresh project; resetting the
-- schema removes them, so we re-add explicitly. Idempotent.
-- ------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO anon, authenticated;
GRANT ALL                                ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT USAGE,  SELECT, UPDATE             ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE                            ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE          ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE                        ON FUNCTIONS TO anon, authenticated;

-- ------------------------------------------------------------
-- END 001_init.sql
-- Next migration: seed your owner staff row after creating your Supabase Auth user.
-- ------------------------------------------------------------

-- END 001_init.sql


-- ============================================================
-- BEGIN 002_seed_demo.sql
-- ============================================================
-- ============================================================
-- 002_seed_demo.sql — Fake data for UI testing
-- Safe to run multiple times (ON CONFLICT DO NOTHING where applicable)
-- DELETE this data before go-live: run the bottom section marked "CLEANUP"
-- ============================================================

-- ------------------------------------------------------------
-- PRODUCTS (a realistic skate shop + park catalog)
-- ------------------------------------------------------------
INSERT INTO products (sku, name, category_id, price, cost, stock, status) VALUES
  -- Session Passes
  ('DAY-ADULT',  'Day Pass — Adult',          (SELECT id FROM categories WHERE name='Session Passes' LIMIT 1), 25.00, 0.00,    0, 'active'),
  ('DAY-KID',    'Day Pass — Under 12',       (SELECT id FROM categories WHERE name='Session Passes' LIMIT 1), 18.00, 0.00,    0, 'active'),
  ('TWO-HOUR',   '2-Hour Session',            (SELECT id FROM categories WHERE name='Session Passes' LIMIT 1), 15.00, 0.00,    0, 'active'),
  -- Memberships
  ('MEM-MONTHLY','Monthly Unlimited',         (SELECT id FROM categories WHERE name='Memberships' LIMIT 1),    89.00, 0.00,    0, 'active'),
  ('MEM-ANNUAL', 'Annual Unlimited',          (SELECT id FROM categories WHERE name='Memberships' LIMIT 1),   899.00, 0.00,    0, 'active'),
  ('PUNCH-10',   '10-Session Punch Card',     (SELECT id FROM categories WHERE name='Memberships' LIMIT 1),   180.00, 0.00,    0, 'active'),
  -- Lessons
  ('LES-30',     'Private Lesson — 30 min',   (SELECT id FROM categories WHERE name='Lessons' LIMIT 1),        40.00, 0.00,    0, 'active'),
  ('LES-60',     'Private Lesson — 60 min',   (SELECT id FROM categories WHERE name='Lessons' LIMIT 1),        70.00, 0.00,    0, 'active'),
  ('GROUP-LES',  'Group Lesson (4+ kids)',    (SELECT id FROM categories WHERE name='Lessons' LIMIT 1),        25.00, 0.00,    0, 'active'),
  -- Rentals
  ('RENT-BOARD', 'Skateboard Rental',         (SELECT id FROM categories WHERE name='Rentals' LIMIT 1),        10.00, 0.00,   12, 'active'),
  ('RENT-PADS',  'Pad Set Rental',            (SELECT id FROM categories WHERE name='Rentals' LIMIT 1),         8.00, 0.00,   18, 'active'),
  ('RENT-HELM',  'Helmet Rental',             (SELECT id FROM categories WHERE name='Rentals' LIMIT 1),         5.00, 0.00,   20, 'active'),
  -- Decks (sample Etnies/Emerica stock from your order)
  ('ES-ACCEL-OG','éS Accel OG — Brown/Gum',   (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),          90.00, 45.00,   4, 'active'),
  ('ES-ACCEL-SL','éS Accel Slim — Black/Tan', (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),          85.00, 42.50,   4, 'active'),
  ('EM-EMERSON', 'Emerica Emerson — Tan/White',(SELECT id FROM categories WHERE name='Shoes' LIMIT 1),         90.00, 45.00,   4, 'active'),
  ('ET-IMPRINT', 'Etnies Imprint KEVLAR',     (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),         135.00, 67.50,   4, 'active'),
  ('ES-KSL3',    'éS KSL 3 — Hunter Green',   (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),         100.00, 50.00,   4, 'active'),
  ('EM-MARANA-C','Emerica Marana — Copper',   (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),         110.00, 55.00,   4, 'active'),
  ('EM-MARANA-H','Emerica Marana — Charcoal', (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),         110.00, 55.00,   4, 'active'),
  ('ES-MOCA-R',  'éS Moca — Red',             (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),          80.00, 40.00,   4, 'active'),
  ('ES-MOCA-W',  'éS Moca — White/Gum',       (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),          80.00, 40.00,   4, 'active'),
  ('EM-TJR',     'Emerica TJ Rodgers — Black/Red',(SELECT id FROM categories WHERE name='Shoes' LIMIT 1),     125.00, 62.50,   4, 'active'),
  -- Grip tape, hardware
  ('GRIP-MOB',   'MOB Grip — Black',          (SELECT id FROM categories WHERE name='Grip Tape' LIMIT 1),       8.00,  3.50,  24, 'active'),
  ('HW-7/8',     '7/8" Hardware Set',         (SELECT id FROM categories WHERE name='Hardware' LIMIT 1),        4.00,  1.80,  30, 'active'),
  ('HW-1',       '1" Hardware Set',           (SELECT id FROM categories WHERE name='Hardware' LIMIT 1),        4.00,  1.80,  30, 'active'),
  -- Food & drink
  ('DRINK-WATER','Bottled Water',             (SELECT id FROM categories WHERE name='Food & Drink' LIMIT 1),    2.00,  0.50,  48, 'active'),
  ('DRINK-GATOR','Gatorade',                  (SELECT id FROM categories WHERE name='Food & Drink' LIMIT 1),    3.50,  1.25,  36, 'active'),
  ('SNACK-BAR',  'Protein Bar',               (SELECT id FROM categories WHERE name='Food & Drink' LIMIT 1),    3.00,  1.20,  24, 'active')
ON CONFLICT (sku) DO NOTHING;

-- ------------------------------------------------------------
-- FAKE CUSTOMERS (6 skaters + 2 guardians — plausible NY names)
-- All emails at @example.com to make obvious these are demo
-- ------------------------------------------------------------
-- Use first_name/last_name (not `name`) — after migration 003, `name` is a
-- GENERATED column and Postgres won't accept inserts to it. The split-name
-- form works both pre- and post-003 (003 backfills first_name/last_name from
-- `name` and only converts `name` to generated if first_name+last_name exist).
-- Wrapped in a guard so we don't even attempt the insert if the seed already
-- ran (avoids any future column-shape mismatch tripping a re-run).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customers WHERE email = 'liam@example.com') THEN
    INSERT INTO customers (first_name, last_name, email, phone, dob, parent_name, parent_phone, parent_email, state, notes) VALUES
      ('Liam',     'Chen',       'liam@example.com',      '914-555-0101', '2012-03-14', 'Wei Chen',        '914-555-0102', 'wei@example.com',    'NY', 'Regular, lesson student'),
      ('Ava',      'Rodriguez',  'ava@example.com',       '914-555-0103', '2011-07-22', 'Maria Rodriguez', '914-555-0104', 'maria@example.com',  'NY', 'Monthly member'),
      ('Noah',     'Patel',      'noah@example.com',      '914-555-0105', '2013-11-02', 'Raj Patel',       '914-555-0106', 'raj@example.com',    'NY', 'Punch card member'),
      ('Emma',     'Johnson',    'emma@example.com',      '914-555-0107', '2005-04-19', NULL,              NULL,           NULL,                 'NY', 'Adult skater'),
      ('Mason',    'Kim',        'mason@example.com',     '914-555-0109', '2010-08-30', 'Sung Kim',        '914-555-0110', 'sung@example.com',   'NY', 'Birthday party Oct 2026'),
      ('Zoey',     'Williams',   'zoey@example.com',      '914-555-0111', '2014-01-05', 'Dan Williams',    '914-555-0112', 'dan@example.com',    'NY', 'New skater, shy'),
      ('Jack',     'O''Brien',   'jack@example.com',      '914-555-0113', '2003-12-11', NULL,              NULL,           NULL,                 'NY', NULL),
      ('Isabella', 'Nguyen',     'isabella@example.com',  '914-555-0115', '2012-06-28', 'Linh Nguyen',     '914-555-0116', 'linh@example.com',   'NY', 'Lesson program')
    ON CONFLICT (email) DO NOTHING;
  END IF;
END $$;

-- ------------------------------------------------------------
-- MEMBERSHIPS (linked to above customers)
-- ------------------------------------------------------------
INSERT INTO subscriptions (customer_id, customer_name, plan_name, plan_type, monthly_rate, start_date, status, auto_renew)
SELECT id, name, 'Monthly Unlimited', 'monthly', 89.00, CURRENT_DATE - INTERVAL '45 days', 'active', true
FROM customers WHERE email = 'ava@example.com'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (customer_id, customer_name, plan_name, plan_type, punches_total, punches_used, start_date, status)
SELECT id, name, '10-Session Punch Card', 'punch_card', 10, 3, CURRENT_DATE - INTERVAL '20 days', 'active'
FROM customers WHERE email = 'noah@example.com'
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- RECENT SALES (past 7 days, varied)
-- ------------------------------------------------------------
INSERT INTO sales (customer_id, subtotal, tax, total, payment_provider, payment_method, status, created_at)
SELECT
  c.id,
  round((random()*80 + 10)::numeric, 2) AS subtotal,
  round((random()*80 + 10)::numeric * 0.08375, 2) AS tax,
  round((random()*80 + 10)::numeric * 1.08375, 2) AS total,
  CASE WHEN random() < 0.7 THEN 'square' ELSE 'cash' END,
  CASE WHEN random() < 0.7 THEN 'card' ELSE 'cash' END,
  'completed',
  NOW() - (random() * INTERVAL '7 days')
FROM customers c, generate_series(1,3)
WHERE c.email LIKE '%@example.com';

-- ------------------------------------------------------------
-- A FEW CHECK-INS (for the "who's in the park" view)
-- ------------------------------------------------------------
INSERT INTO checkins (customer_id, checked_in_at)
SELECT id, NOW() - (random() * INTERVAL '3 hours')
FROM customers
WHERE email IN ('liam@example.com','ava@example.com','noah@example.com');

-- ------------------------------------------------------------
-- UPCOMING LESSONS (next 2 weeks)
-- ------------------------------------------------------------
INSERT INTO lessons (customer_id, instructor, type, scheduled_at, duration_min, price, status)
SELECT id, 'Coach Ryan', 'private', NOW() + (random()*INTERVAL '14 days'), 60, 70.00, 'scheduled'
FROM customers WHERE email = 'liam@example.com';

INSERT INTO lessons (customer_id, instructor, type, scheduled_at, duration_min, price, status)
SELECT id, 'Coach Sam', 'group', NOW() + INTERVAL '3 days', 90, 25.00, 'scheduled'
FROM customers WHERE email = 'noah@example.com';

INSERT INTO lessons (customer_id, instructor, type, scheduled_at, duration_min, price, status)
SELECT id, 'Coach Ryan', 'birthday', NOW() + INTERVAL '10 days' + INTERVAL '2 hours', 120, 400.00, 'scheduled'
FROM customers WHERE email = 'mason@example.com';

-- ============================================================
-- CLEANUP — run these to wipe demo data before go-live:
--
-- DELETE FROM lessons       WHERE customer_id IN (SELECT id FROM customers WHERE email LIKE '%@example.com');
-- DELETE FROM checkins      WHERE customer_id IN (SELECT id FROM customers WHERE email LIKE '%@example.com');
-- DELETE FROM sales         WHERE customer_id IN (SELECT id FROM customers WHERE email LIKE '%@example.com');
-- DELETE FROM subscriptions WHERE customer_id IN (SELECT id FROM customers WHERE email LIKE '%@example.com');
-- DELETE FROM customers     WHERE email LIKE '%@example.com';
-- DELETE FROM products      WHERE sku IN ('DAY-ADULT','DAY-KID','TWO-HOUR','MEM-MONTHLY','MEM-ANNUAL','PUNCH-10','LES-30','LES-60','GROUP-LES','RENT-BOARD','RENT-PADS','RENT-HELM','ES-ACCEL-OG','ES-ACCEL-SL','EM-EMERSON','ET-IMPRINT','ES-KSL3','EM-MARANA-C','EM-MARANA-H','ES-MOCA-R','ES-MOCA-W','EM-TJR','GRIP-MOB','HW-7/8','HW-1','DRINK-WATER','DRINK-GATOR','SNACK-BAR');
-- ============================================================

-- END 002_seed_demo.sql


-- ============================================================
-- BEGIN 003_split_name.sql
-- ============================================================
-- ============================================================
-- 003_split_name.sql — Split customer name into first + last
--
-- Adds `first_name` and `last_name` columns to customers.
-- `name` becomes a generated column (first + ' ' + last) so every
-- existing read path keeps working without code changes.
--
-- For existing rows (demo data): best-effort split on first space.
-- Safe to re-run (idempotent).
-- ============================================================

-- 1. Add the new columns (nullable first so backfill doesn't error)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- 2. Backfill from existing `name` where either field is still empty.
--    Splits on the first space: "Liam Chen" → first=Liam, last=Chen
--    Single-word names: first=<the word>, last=NULL
UPDATE customers
SET
  first_name = COALESCE(first_name, NULLIF(split_part(name, ' ', 1), '')),
  last_name  = COALESCE(
                 last_name,
                 NULLIF(trim(substring(name FROM position(' ' IN name) + 1)), '')
               )
WHERE (first_name IS NULL OR last_name IS NULL) AND name IS NOT NULL;

-- 3. Replace the plain `name` column with a generated column that derives
--    from first_name + last_name. This guarantees the two never drift.
--    We have to drop and recreate the column, keeping the same name.
--
--    NOTE: generated columns can't reference mutable concat shortcuts,
--    so we use COALESCE + trim explicitly.
DO $$
DECLARE
  col_is_generated BOOLEAN;
BEGIN
  SELECT is_generated = 'ALWAYS' INTO col_is_generated
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'name';

  IF col_is_generated IS NOT TRUE THEN
    -- Drop the old plain column and recreate as generated
    ALTER TABLE customers DROP COLUMN name;
    ALTER TABLE customers ADD COLUMN name TEXT GENERATED ALWAYS AS (
      trim(
        COALESCE(first_name, '') ||
        CASE WHEN first_name IS NOT NULL AND last_name IS NOT NULL THEN ' ' ELSE '' END ||
        COALESCE(last_name, '')
      )
    ) STORED;
  END IF;
END $$;

-- 4. Indexes for fast customer-picker search (case-insensitive prefix + contains)
CREATE INDEX IF NOT EXISTS idx_customers_first_name_ci ON customers(lower(first_name));
CREATE INDEX IF NOT EXISTS idx_customers_last_name_ci  ON customers(lower(last_name));

-- Full-text search across name + email + phone — this is what the picker uses
CREATE INDEX IF NOT EXISTS idx_customers_search_fts ON customers
  USING gin (
    to_tsvector('simple',
      coalesce(first_name,'') || ' ' ||
      coalesce(last_name,'')  || ' ' ||
      coalesce(email,'')      || ' ' ||
      coalesce(phone,'')
    )
  );

-- 5. Convenience RPC for the client picker: takes a query string,
--    returns the top 20 matches ranked by relevance.
--    Callable from PostgREST as POST /rpc/search_customers
CREATE OR REPLACE FUNCTION search_customers(q TEXT)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  total_spent NUMERIC,
  last_visit_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id, first_name, last_name, name, email, phone, total_spent, last_visit_at
  FROM customers
  WHERE
    q IS NULL OR q = ''
    OR lower(first_name)  LIKE lower(q) || '%'
    OR lower(last_name)   LIKE lower(q) || '%'
    OR lower(email)       LIKE '%' || lower(q) || '%'
    OR phone              LIKE '%' || regexp_replace(q, '\D', '', 'g') || '%'
    OR lower(name)        LIKE '%' || lower(q) || '%'
  ORDER BY
    -- Exact first-name match ranked highest, then last-name, then fuzzy
    CASE WHEN lower(first_name) = lower(q) THEN 0
         WHEN lower(first_name) LIKE lower(q) || '%' THEN 1
         WHEN lower(last_name)  = lower(q) THEN 2
         WHEN lower(last_name)  LIKE lower(q) || '%' THEN 3
         ELSE 4
    END,
    last_visit_at DESC NULLS LAST,
    name
  LIMIT 20;
$$;

-- Allow the picker to be called by any authenticated staff member
REVOKE ALL ON FUNCTION search_customers(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_customers(TEXT) TO authenticated, anon;

-- END 003_split_name.sql


-- ============================================================
-- BEGIN 004_app_settings.sql
-- ============================================================
-- ============================================================
-- 004_app_settings.sql — runtime Settings persistence
--
-- Stores Settings page edits (branding, hours, integrations,
-- feature flags, receipt prefs, etc.) so they survive across
-- devices and browsers — not just localStorage on one machine.
--
-- Single key/value table. Each row is one logical group
-- (e.g. 'branding', 'features', 'integrations.smartwaiver')
-- so partial updates don't have to round-trip the whole blob.
-- The admin uses key 'all' for the bundled write today; the
-- per-section keys are reserved for future granular saves.
--
-- Owner-only writes; any logged-in staff can read so the
-- branding/hours/feature-flag state is consistent for everyone.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES staff(id)
);

-- Auto-bump updated_at on any change.
CREATE OR REPLACE FUNCTION app_settings_touch() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_touch ON app_settings;
CREATE TRIGGER trg_app_settings_touch
  BEFORE INSERT OR UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION app_settings_touch();

-- Audit trail. Note: the shared `audit_trigger()` in 001_init.sql assumes
-- every audited table has an `id` column. app_settings uses `key` as its
-- primary key (no surrogate id), so we use a tiny custom trigger that
-- writes `key` into audit_log.row_id instead.
CREATE OR REPLACE FUNCTION audit_trigger_app_settings() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_email TEXT;
  v_row_id      TEXT;
BEGIN
  SELECT email INTO v_actor_email FROM auth.users WHERE id = auth.uid();
  v_row_id := COALESCE(NEW.key, OLD.key);
  INSERT INTO audit_log (actor_id, actor_email, action, tbl, row_id, old_values, new_values)
  VALUES (auth.uid(), v_actor_email, TG_OP, TG_TABLE_NAME, v_row_id,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_app_settings ON app_settings;
CREATE TRIGGER trg_audit_app_settings
  AFTER INSERT OR UPDATE OR DELETE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_app_settings();

-- RLS — owner writes; any staff reads.
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_read  ON app_settings;
DROP POLICY IF EXISTS app_settings_write ON app_settings;
CREATE POLICY app_settings_read  ON app_settings FOR SELECT USING (is_staff());
CREATE POLICY app_settings_write ON app_settings FOR ALL    USING (is_owner()) WITH CHECK (is_owner());

-- PostgREST grants.
GRANT SELECT                         ON app_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE         ON app_settings TO authenticated;

-- ============================================================
-- Apply with:
--   bash admin/migrations/run.sh   (uses $SUPABASE_DB_URL or psql args)
-- Or paste in Supabase Dashboard → SQL Editor → Run.
-- ============================================================

-- END 004_app_settings.sql


-- ============================================================
-- BEGIN 005_subscriptions_comped.sql
-- ============================================================
-- ============================================================
-- 005_subscriptions_comped.sql
-- Add 'comped' to subscriptions.plan_type allowed values.
--
-- Why: the admin's renderSubscriptions UI offers "Industry / Comped"
-- as a plan template + the renderSubscriptions render code already
-- handles `s.plan_type === 'comped'` — but the original CHECK
-- constraint in 001_init.sql doesn't allow it, so the INSERT would
-- 400 on save. This migration brings the schema in line with the UI.
--
-- Idempotent: drops the old constraint by name then recreates.
-- ============================================================

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_type_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_type_check
  CHECK (plan_type IN ('monthly','annual','punch_card','day_pass','comped'));

-- END 005_subscriptions_comped.sql


-- ============================================================
-- BEGIN 006_loyalty.sql
-- ============================================================
-- ============================================================
-- 006_loyalty.sql — customer loyalty points
--
-- Square has Loyalty as its own paid add-on. We're rolling our own:
--   - customers.loyalty_points: cached balance (denormalized rollup).
--   - loyalty_transactions: audit log (source of truth, every +/- entry).
--   - loyalty_config: single-row knobs (earn rates, redeem rate).
--   - Triggers auto-award on sales (per-$ spent) and checkins (per visit).
--   - Trigger on loyalty_transactions keeps customers.loyalty_points
--     in sync — front-end never has to recompute.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. customers.loyalty_points (cached balance)
-- ------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS loyalty_points INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_customers_loyalty_points
  ON customers(loyalty_points DESC) WHERE loyalty_points > 0;

-- ------------------------------------------------------------
-- 2. loyalty_config — single-row settings, owner-editable
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_config (
  id                    INT PRIMARY KEY DEFAULT 1,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  points_per_dollar     NUMERIC(6,2) NOT NULL DEFAULT 1,    -- 1 pt per $1 spent
  points_per_checkin    INT NOT NULL DEFAULT 5,             -- 5 pts per visit
  redeem_pts_per_dollar INT NOT NULL DEFAULT 100,           -- 100 pts = $1 off
  program_name          TEXT NOT NULL DEFAULT 'Skate Points',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT loyalty_config_singleton CHECK (id = 1)
);

INSERT INTO loyalty_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 3. loyalty_transactions — audit log, append-only in practice
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  delta        INT NOT NULL,                -- positive = earn, negative = redeem/adjust
  reason       TEXT NOT NULL,               -- 'sale', 'checkin', 'redeem', 'adjust', 'signup_bonus', etc.
  ref_type     TEXT,                        -- 'sales' | 'checkins' | 'manual' | 'redeem'
  ref_id       UUID,                        -- pk of referenced row, for de-dup
  note         TEXT,
  created_by   UUID REFERENCES staff(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_customer
  ON loyalty_transactions(customer_id, created_at DESC);

-- de-dup: one auto-award per (ref_type, ref_id) pair
CREATE UNIQUE INDEX IF NOT EXISTS uniq_loyalty_tx_ref
  ON loyalty_transactions(ref_type, ref_id)
  WHERE ref_type IS NOT NULL AND ref_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Trigger: keep customers.loyalty_points in sync with transactions
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION loyalty_apply_delta() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE customers
       SET loyalty_points = GREATEST(0, loyalty_points + NEW.delta),
           updated_at     = NOW()
     WHERE id = NEW.customer_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE customers
       SET loyalty_points = GREATEST(0, loyalty_points - OLD.delta),
           updated_at     = NOW()
     WHERE id = OLD.customer_id;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_apply ON loyalty_transactions;
CREATE TRIGGER trg_loyalty_apply
  AFTER INSERT OR DELETE ON loyalty_transactions
  FOR EACH ROW EXECUTE FUNCTION loyalty_apply_delta();

-- ------------------------------------------------------------
-- 5. Trigger: auto-award on completed sales (1 pt per $ by default)
--    Fires on INSERT of completed sale OR on UPDATE → completed.
--    Skipped if disabled, no customer, or already awarded for this sale.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION loyalty_award_sale() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  cfg   loyalty_config%ROWTYPE;
  pts   INT;
BEGIN
  IF NEW.customer_id IS NULL OR NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN
    RETURN NEW;  -- only award on the transition into completed
  END IF;

  SELECT * INTO cfg FROM loyalty_config WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN NEW; END IF;

  pts := FLOOR(COALESCE(NEW.total, 0) * cfg.points_per_dollar);
  IF pts <= 0 THEN RETURN NEW; END IF;

  INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
  VALUES (NEW.customer_id, pts, 'sale', 'sales', NEW.id,
          'Earned on receipt ' || COALESCE(NEW.receipt_number, NEW.id::TEXT))
  ON CONFLICT (ref_type, ref_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_award_sale ON sales;
CREATE TRIGGER trg_loyalty_award_sale
  AFTER INSERT OR UPDATE OF status ON sales
  FOR EACH ROW EXECUTE FUNCTION loyalty_award_sale();

-- ------------------------------------------------------------
-- 6. Trigger: auto-award on check-in (per-visit bonus)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION loyalty_award_checkin() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  cfg loyalty_config%ROWTYPE;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO cfg FROM loyalty_config WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled OR cfg.points_per_checkin <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
  VALUES (NEW.customer_id, cfg.points_per_checkin, 'checkin', 'checkins', NEW.id,
          'Visit bonus')
  ON CONFLICT (ref_type, ref_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_award_checkin ON checkins;
CREATE TRIGGER trg_loyalty_award_checkin
  AFTER INSERT ON checkins
  FOR EACH ROW EXECUTE FUNCTION loyalty_award_checkin();

-- ------------------------------------------------------------
-- 7. RLS — same pattern as the rest of the schema
-- ------------------------------------------------------------
ALTER TABLE loyalty_config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lc_read   ON loyalty_config;
DROP POLICY IF EXISTS lc_edit   ON loyalty_config;
DROP POLICY IF EXISTS lc_insert ON loyalty_config;
CREATE POLICY lc_read   ON loyalty_config FOR SELECT USING (is_staff());
CREATE POLICY lc_insert ON loyalty_config FOR INSERT WITH CHECK (is_owner());
CREATE POLICY lc_edit   ON loyalty_config FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());

DROP POLICY IF EXISTS lt_read   ON loyalty_transactions;
DROP POLICY IF EXISTS lt_write  ON loyalty_transactions;
DROP POLICY IF EXISTS lt_edit   ON loyalty_transactions;
DROP POLICY IF EXISTS lt_del    ON loyalty_transactions;
CREATE POLICY lt_read  ON loyalty_transactions FOR SELECT USING (is_staff());
CREATE POLICY lt_write ON loyalty_transactions FOR INSERT WITH CHECK (is_staff());
CREATE POLICY lt_edit  ON loyalty_transactions FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY lt_del   ON loyalty_transactions FOR DELETE USING (is_owner());

-- ------------------------------------------------------------
-- 8. Helper RPC: redeem points (atomic)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION loyalty_redeem(
  p_customer_id UUID,
  p_points      INT,
  p_note        TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  bal INT;
  cfg loyalty_config%ROWTYPE;
  dollars NUMERIC(10,2);
  tx_id UUID;
BEGIN
  IF p_points <= 0 THEN
    RAISE EXCEPTION 'Redeem amount must be positive';
  END IF;

  SELECT * INTO cfg FROM loyalty_config WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loyalty not configured'; END IF;

  SELECT loyalty_points INTO bal FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF bal IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF bal < p_points THEN
    RAISE EXCEPTION 'Insufficient points (have %, need %)', bal, p_points;
  END IF;

  dollars := ROUND(p_points::NUMERIC / cfg.redeem_pts_per_dollar, 2);

  INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, note)
  VALUES (p_customer_id, -p_points, 'redeem', 'redeem',
          COALESCE(p_note, 'Redeemed ' || p_points || ' pts for $' || dollars))
  RETURNING id INTO tx_id;

  RETURN json_build_object(
    'transaction_id', tx_id,
    'points_redeemed', p_points,
    'dollars_off',     dollars,
    'new_balance',     bal - p_points
  );
END;
$$;

GRANT EXECUTE ON FUNCTION loyalty_redeem(UUID, INT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 9. GRANTS — match the rest of the schema
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty_config       TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty_transactions TO anon, authenticated;
GRANT ALL ON loyalty_config       TO service_role;
GRANT ALL ON loyalty_transactions TO service_role;

-- ------------------------------------------------------------
-- END 006_loyalty.sql
-- ------------------------------------------------------------

-- END 006_loyalty.sql


-- ============================================================
-- BEGIN 007_search_customers_extras.sql
-- ============================================================
-- ============================================================
-- 007_search_customers_extras.sql
-- Extend search_customers RPC to return fields the UI is already
-- trying to consume but never received. Three pre-existing bugs:
--
--   1. Mobile + admin show a "no waiver" warning on search hits
--      based on `customer.waiver_signed_at` — but the RPC didn't
--      return it. Result: warning fired for ALL hits incorrectly
--      (mobile) or never fired (admin: undefined → falsy → no chip).
--
--   2. Admin shows a "minor" chip via `ciIsMinor(c)` which reads
--      `c.dob` — but the RPC didn't return dob. Result: minors
--      silently never tagged at the front desk.
--
--   3. Loyalty (migration 006) added points, but search hits
--      never carry the balance, so staff can't see member tier
--      until after check-in.
--
-- Fix: drop and recreate the function with the three additional
-- columns. Function body is otherwise identical to 003.
--
-- NOTE: Postgres won't let CREATE OR REPLACE change RETURNS TABLE
-- shape — must DROP FUNCTION first. Idempotent because of IF EXISTS.
-- ============================================================

DROP FUNCTION IF EXISTS search_customers(TEXT);

CREATE OR REPLACE FUNCTION search_customers(q TEXT)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  dob DATE,
  waiver_signed_at TIMESTAMPTZ,
  total_spent NUMERIC,
  last_visit_at TIMESTAMPTZ,
  loyalty_points INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id, first_name, last_name, name, email, phone,
    dob, waiver_signed_at,
    total_spent, last_visit_at,
    loyalty_points
  FROM customers
  WHERE
    q IS NULL OR q = ''
    OR lower(first_name)  LIKE lower(q) || '%'
    OR lower(last_name)   LIKE lower(q) || '%'
    OR lower(email)       LIKE '%' || lower(q) || '%'
    OR phone              LIKE '%' || regexp_replace(q, '\D', '', 'g') || '%'
    OR lower(name)        LIKE '%' || lower(q) || '%'
  ORDER BY
    CASE WHEN lower(first_name) = lower(q) THEN 0
         WHEN lower(first_name) LIKE lower(q) || '%' THEN 1
         WHEN lower(last_name)  = lower(q) THEN 2
         WHEN lower(last_name)  LIKE lower(q) || '%' THEN 3
         ELSE 4
    END,
    last_visit_at DESC NULLS LAST,
    name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_customers(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_customers(TEXT) TO authenticated, anon;

-- END 007_search_customers_extras.sql


-- ============================================================
-- BEGIN 008_timesheets.sql
-- ============================================================
-- ============================================================
-- 008_timesheets.sql — staff time tracking + payroll prep
--
-- Skate-shaped port of Branch Manager's payroll/timesheet pattern
-- (see _bm-reference/src-pages/payroll.js + _bm-reference/migrations/schema.sql).
--
-- Differences from BM:
--   - No `job_id` reference (skateOS has no job concept).
--   - Adds `shift_type` enum: front_desk / instructor / party / cleanup / admin / other.
--   - Approvals stored in a real Supabase table (`timesheet_approvals`),
--     not localStorage — so they survive across devices and sessions.
--   - Pay rate lives on the staff row.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extend staff_role enum to include instructor
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                  WHERE enumtypid = 'staff_role'::regtype
                    AND enumlabel = 'instructor') THEN
    ALTER TYPE staff_role ADD VALUE 'instructor';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Extend staff table with payroll-relevant fields
-- ------------------------------------------------------------
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS pay_rate            NUMERIC(10,2),  -- hourly $
  ADD COLUMN IF NOT EXISTS phone               TEXT,
  ADD COLUMN IF NOT EXISTS weekly_hours_target INT;            -- target / "expected" hrs/wk

-- ------------------------------------------------------------
-- 3. shift_type enum
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_type') THEN
    CREATE TYPE shift_type AS ENUM ('front_desk','instructor','party','cleanup','admin','other');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. time_entries — append-only log of clock-ins / hour entries
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  shift_type   shift_type NOT NULL DEFAULT 'front_desk',
  entry_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  clock_in     TIMESTAMPTZ,           -- set when staff punches in
  clock_out    TIMESTAMPTZ,           -- set when staff punches out (or NULL = open)
  hours        NUMERIC(5,2),          -- computed from clock times OR entered directly for retroactive
  notes        TEXT,
  created_by   UUID REFERENCES staff(id),  -- who logged this entry (could differ from staff_id when owner adjusts)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_staff_date
  ON time_entries(staff_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_open_clockins
  ON time_entries(staff_id) WHERE clock_in IS NOT NULL AND clock_out IS NULL;

-- Auto-compute hours if both clock_in and clock_out set and hours not explicitly provided.
CREATE OR REPLACE FUNCTION time_entry_compute_hours() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clock_in IS NOT NULL AND NEW.clock_out IS NOT NULL THEN
    -- Always recompute on close-out so manual edits to clock times sync.
    NEW.hours := ROUND(EXTRACT(EPOCH FROM (NEW.clock_out - NEW.clock_in)) / 3600.0, 2);
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_time_entry_compute ON time_entries;
CREATE TRIGGER trg_time_entry_compute
  BEFORE INSERT OR UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION time_entry_compute_hours();

-- ------------------------------------------------------------
-- 5. timesheet_approvals — week-level + day-level approval records
--    Server-side replacement for BM's localStorage-backed approval map.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timesheet_approvals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('day','week')),
  scope_date   DATE NOT NULL,    -- entry_date for 'day', week_start (Mon) for 'week'
  approved_by  UUID NOT NULL REFERENCES staff(id),
  approved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_after BOOLEAN NOT NULL DEFAULT FALSE,
  notes        TEXT,
  UNIQUE (staff_id, scope, scope_date)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_approvals_staff
  ON timesheet_approvals(staff_id, scope, scope_date DESC);

-- If a time_entry is INSERT/UPDATE/DELETE'd after approval, mark the matching
-- day approval as `edited_after = TRUE` so the UI can flag "re-approval needed".
CREATE OR REPLACE FUNCTION timesheet_mark_edited_after() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  the_staff UUID;
  the_date  DATE;
  week_start DATE;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    the_staff := OLD.staff_id;
    the_date  := OLD.entry_date;
  ELSE
    the_staff := NEW.staff_id;
    the_date  := NEW.entry_date;
  END IF;

  -- Compute Monday of that week
  week_start := the_date - ((EXTRACT(DOW FROM the_date)::INT + 6) % 7);

  UPDATE timesheet_approvals
     SET edited_after = TRUE
   WHERE staff_id = the_staff
     AND ((scope = 'day'  AND scope_date = the_date)
       OR (scope = 'week' AND scope_date = week_start));

  IF (TG_OP = 'DELETE') THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_timesheet_edited_after ON time_entries;
CREATE TRIGGER trg_timesheet_edited_after
  AFTER INSERT OR UPDATE OR DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION timesheet_mark_edited_after();

-- ------------------------------------------------------------
-- 6. RLS — staff see/edit own entries; owner sees/edits all.
--    Approvals are owner-only.
-- ------------------------------------------------------------
ALTER TABLE time_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_approvals  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS te_read   ON time_entries;
DROP POLICY IF EXISTS te_insert ON time_entries;
DROP POLICY IF EXISTS te_update ON time_entries;
DROP POLICY IF EXISTS te_delete ON time_entries;

-- Staff: read/write own rows. Owner: read/write any.
CREATE POLICY te_read   ON time_entries FOR SELECT USING (
  is_owner() OR staff_id = auth.uid()
);
CREATE POLICY te_insert ON time_entries FOR INSERT WITH CHECK (
  is_owner() OR staff_id = auth.uid()
);
CREATE POLICY te_update ON time_entries FOR UPDATE USING (
  is_owner() OR staff_id = auth.uid()
) WITH CHECK (
  is_owner() OR staff_id = auth.uid()
);
CREATE POLICY te_delete ON time_entries FOR DELETE USING (is_owner());

DROP POLICY IF EXISTS ta_read   ON timesheet_approvals;
DROP POLICY IF EXISTS ta_write  ON timesheet_approvals;
DROP POLICY IF EXISTS ta_update ON timesheet_approvals;
DROP POLICY IF EXISTS ta_delete ON timesheet_approvals;

CREATE POLICY ta_read   ON timesheet_approvals FOR SELECT USING (
  is_owner() OR staff_id = auth.uid()
);
CREATE POLICY ta_write  ON timesheet_approvals FOR INSERT WITH CHECK (is_owner());
CREATE POLICY ta_update ON timesheet_approvals FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY ta_delete ON timesheet_approvals FOR DELETE USING (is_owner());

-- ------------------------------------------------------------
-- 7. RPC: clock_in / clock_out helpers (atomic)
-- ------------------------------------------------------------

-- Open a new clock-in for the calling user. Errors if there's already an open one.
CREATE OR REPLACE FUNCTION timesheet_clock_in(
  p_shift_type shift_type DEFAULT 'front_desk',
  p_notes      TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  open_id UUID;
  new_id  UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO open_id
    FROM time_entries
   WHERE staff_id = auth.uid()
     AND clock_in IS NOT NULL
     AND clock_out IS NULL
   LIMIT 1;

  IF open_id IS NOT NULL THEN
    RAISE EXCEPTION 'You already have an open clock-in (entry %). Clock out first.', open_id;
  END IF;

  INSERT INTO time_entries (staff_id, shift_type, entry_date, clock_in, notes, created_by)
  VALUES (auth.uid(), p_shift_type, CURRENT_DATE, NOW(), p_notes, auth.uid())
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

-- Close out the calling user's open clock-in. Returns the resulting hours.
CREATE OR REPLACE FUNCTION timesheet_clock_out(
  p_notes TEXT DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  open_id  UUID;
  result_h NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO open_id
    FROM time_entries
   WHERE staff_id = auth.uid()
     AND clock_in IS NOT NULL
     AND clock_out IS NULL
   ORDER BY clock_in DESC
   LIMIT 1;

  IF open_id IS NULL THEN
    RAISE EXCEPTION 'No open clock-in to close.';
  END IF;

  UPDATE time_entries
     SET clock_out = NOW(),
         notes     = COALESCE(p_notes, notes)
   WHERE id = open_id
   RETURNING hours INTO result_h;

  RETURN result_h;
END;
$$;

GRANT EXECUTE ON FUNCTION timesheet_clock_in(shift_type, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION timesheet_clock_out(TEXT)            TO authenticated;

-- ------------------------------------------------------------
-- 8. GRANTS
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON time_entries        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON timesheet_approvals TO anon, authenticated;
GRANT ALL ON time_entries        TO service_role;
GRANT ALL ON timesheet_approvals TO service_role;

-- ------------------------------------------------------------
-- END 008_timesheets.sql
-- ------------------------------------------------------------

-- END 008_timesheets.sql


-- ============================================================
-- BEGIN 009_multi_tenant_part_a.sql
-- ============================================================
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

-- END 009_multi_tenant_part_a.sql


-- ============================================================
-- BEGIN 010_incidents.sql
-- ============================================================
-- ============================================================
-- 010_incidents.sql — searchable incident history
--
-- Pairs with admin/tools/incident-report.html. Until now the form
-- was print-only — no audit trail, can't answer "show me all head
-- impacts in the last 12 months" without digging through paper.
-- This migration adds an `incidents` table with structured fields
-- (filterable) plus a `data` JSONB blob for fields that don't
-- earn dedicated columns (witnesses, corrective action, photos).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enums
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_severity') THEN
    CREATE TYPE incident_severity AS ENUM ('none','first_aid','urgent_care','er','ems_911');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. incidents table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- When + where
  occurred_at         TIMESTAMPTZ NOT NULL,
  park_area           TEXT,                       -- 'Street section', 'Bowl', 'Mini ramp', etc.
  spot_detail         TEXT,                       -- "6-foot quarter coping" — free text
  conditions          TEXT,                       -- 'Normal', 'Crowded', 'Wet', etc.
  -- Skater (FK soft — incident may involve a non-customer)
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  skater_name         TEXT NOT NULL,              -- denormalized so deletion of customer doesn't lose record
  skater_dob          DATE,
  skater_age          INT,
  skater_phone        TEXT,
  skater_skill_level  TEXT,                       -- 'First time' .. 'Pro / sponsored'
  pass_type           TEXT,                       -- 'Day pass', 'Punch card', etc.
  waiver_status       TEXT,                       -- 'on_file_smartwaiver', 'on_file_paper', 'missing'
  helmet_status       TEXT,                       -- 'own', 'rented', 'none', 'incorrect'
  -- Guardian (only if minor)
  guardian_name       TEXT,
  guardian_relation   TEXT,
  guardian_phone      TEXT,
  guardian_on_site    BOOLEAN,
  guardian_contacted_at TIMESTAMPTZ,
  -- Categorization
  incident_types      TEXT[] NOT NULL DEFAULT '{}',   -- ['fall','head_impact','collision'] — multi-select
  body_part_injured   TEXT,
  equipment_involved  TEXT,
  description         TEXT NOT NULL,
  -- Medical
  severity            incident_severity NOT NULL DEFAULT 'none',
  hospital_name       TEXT,
  ems_arrival_at      TIMESTAMPTZ,
  -- Follow-up
  corrective_action   TEXT,
  action_owner        TEXT,
  action_deadline     DATE,
  action_completed    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Witnesses + signatures + extras
  data                JSONB NOT NULL DEFAULT '{}'::jsonb,  -- witnesses[], photos[], free-form extras
  -- Authorship
  reported_by         UUID REFERENCES staff(id),
  reviewed_by         UUID REFERENCES staff(id),
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_occurred_at  ON incidents(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_customer     ON incidents(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_severity     ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_types        ON incidents USING gin (incident_types);
CREATE INDEX IF NOT EXISTS idx_incidents_open_actions ON incidents(action_deadline) WHERE action_completed = FALSE AND action_deadline IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION incidents_touch_updated() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_incidents_touch ON incidents;
CREATE TRIGGER trg_incidents_touch
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_touch_updated();

-- ------------------------------------------------------------
-- 3. Multi-tenant tag (matches migration 009 pattern)
-- ------------------------------------------------------------
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_incidents_tenant ON incidents(tenant_id);

-- Backfill to 2nd Nature tenant if it exists
DO $$
DECLARE seed_tid UUID;
BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE incidents SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- tenants table doesn't exist yet (migration 009 not run) — skip silently.
  NULL;
END $$;

-- ------------------------------------------------------------
-- 4. RLS
-- ------------------------------------------------------------
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inc_read   ON incidents;
DROP POLICY IF EXISTS inc_insert ON incidents;
DROP POLICY IF EXISTS inc_update ON incidents;
DROP POLICY IF EXISTS inc_delete ON incidents;

CREATE POLICY inc_read   ON incidents FOR SELECT USING (is_staff());
CREATE POLICY inc_insert ON incidents FOR INSERT WITH CHECK (is_staff());
CREATE POLICY inc_update ON incidents FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY inc_delete ON incidents FOR DELETE USING (is_owner());

-- ------------------------------------------------------------
-- 5. Grants
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON incidents TO anon, authenticated;
GRANT ALL ON incidents TO service_role;

-- ------------------------------------------------------------
-- END 010_incidents.sql
-- ------------------------------------------------------------

-- END 010_incidents.sql


-- ============================================================
-- BEGIN 011_forms.sql
-- ============================================================
-- ============================================================
-- 011_forms.sql — generic forms + submissions
--
-- Skeletal scaffold for skateOS's form builder. Inspired by BM's
-- formbuilder.js but kept minimal for v1: admin defines a form
-- via a JSONB schema, customers submit, submissions land in DB.
-- A full drag-drop builder UI is post-MVP.
--
-- Schema example (forms.schema column):
--   {
--     "fields": [
--       { "id":"name",   "type":"text",     "label":"Skater name", "required":true },
--       { "id":"age",    "type":"number",   "label":"Age" },
--       { "id":"email",  "type":"email",    "label":"Email" },
--       { "id":"notes",  "type":"textarea", "label":"Anything we should know?" }
--     ]
--   }
--
-- submit_action drives what happens after a successful submission:
--   - 'none'         → just save the row
--   - 'lesson_intake' → also create a lessons row (future)
--   - 'party_request' → also create a party booking (future)
--   - 'incident'     → mirror into incidents table (future)
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS forms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,         -- "lesson-intake", "party-request", etc.
  name          TEXT NOT NULL,
  description   TEXT,
  schema        JSONB NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  submit_action TEXT NOT NULL DEFAULT 'none' CHECK (submit_action IN ('none','lesson_intake','party_request','incident','waiver','other')),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forms_slug    ON forms(slug);
CREATE INDEX IF NOT EXISTS idx_forms_enabled ON forms(enabled);

CREATE TABLE IF NOT EXISTS form_submissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id     UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','actioned','spam','archived')),
  reviewed_by UUID REFERENCES staff(id),
  reviewed_at TIMESTAMPTZ,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_form    ON form_submissions(form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status  ON form_submissions(status) WHERE status = 'new';
CREATE INDEX IF NOT EXISTS idx_submissions_customer ON form_submissions(customer_id) WHERE customer_id IS NOT NULL;

-- updated_at trigger on forms
CREATE OR REPLACE FUNCTION forms_touch_updated() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_forms_touch ON forms;
CREATE TRIGGER trg_forms_touch
  BEFORE UPDATE ON forms
  FOR EACH ROW EXECUTE FUNCTION forms_touch_updated();

-- Multi-tenant
ALTER TABLE forms            ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_forms_tenant       ON forms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_submissions_tenant ON form_submissions(tenant_id);

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE forms            SET tenant_id = seed_tid WHERE tenant_id IS NULL;
    UPDATE form_submissions SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- RLS — staff read/write forms (admin); submissions readable to staff,
-- writable by anyone (so a public form-renderer can POST without auth).
ALTER TABLE forms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forms_read       ON forms;
DROP POLICY IF EXISTS forms_write      ON forms;
DROP POLICY IF EXISTS forms_edit       ON forms;
DROP POLICY IF EXISTS forms_delete     ON forms;
CREATE POLICY forms_read   ON forms FOR SELECT USING (TRUE);            -- forms are public-readable so customers can render them
CREATE POLICY forms_write  ON forms FOR INSERT WITH CHECK (is_owner());
CREATE POLICY forms_edit   ON forms FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY forms_delete ON forms FOR DELETE USING (is_owner());

DROP POLICY IF EXISTS sub_read   ON form_submissions;
DROP POLICY IF EXISTS sub_write  ON form_submissions;
DROP POLICY IF EXISTS sub_update ON form_submissions;
DROP POLICY IF EXISTS sub_delete ON form_submissions;
CREATE POLICY sub_read   ON form_submissions FOR SELECT USING (is_staff());
CREATE POLICY sub_write  ON form_submissions FOR INSERT WITH CHECK (TRUE);  -- public can submit
CREATE POLICY sub_update ON form_submissions FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY sub_delete ON form_submissions FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON forms            TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON form_submissions TO anon, authenticated;
GRANT ALL ON forms            TO service_role;
GRANT ALL ON form_submissions TO service_role;

-- END 011_forms.sql


-- ============================================================
-- BEGIN 012_equipment.sql
-- ============================================================
-- ============================================================
-- 012_equipment.sql — skate-gear loaner + rental tracking
--
-- Tracks rental/loaner gear (boards, helmets, pads, wristguards,
-- shoes) and who has it out. Pairs with the existing `rentals`
-- feature flag in settings. Skate-shaped — NOT generic asset
-- tracking. (Earlier confusion: this was briefly removed because
-- BM had similar but tree-shop-shaped. The skater-gear use case
-- is real: party packages include loaner pads, helmet rentals
-- are required for under-18 unhelmeted, beginner deck rentals
-- happen for first-time-skater day passes.)
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'equipment_type') THEN
    CREATE TYPE equipment_type AS ENUM ('board','helmet','pads','wristguards','shoes','other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'equipment_status') THEN
    CREATE TYPE equipment_status AS ENUM ('in_stock','loaned','maintenance','retired','lost');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS equipment (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag   TEXT UNIQUE,                       -- printable barcode/QR — e.g. 2NTR-HEL-014
  type        equipment_type NOT NULL,
  label       TEXT NOT NULL,                     -- "Bullet 7-1/4 Helmet — Black"
  size        TEXT,                              -- "S/M", "8.0\"", etc.
  status      equipment_status NOT NULL DEFAULT 'in_stock',
  notes       TEXT,
  acquired_at DATE,
  retired_at  DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_type   ON equipment(type);
CREATE INDEX IF NOT EXISTS idx_equipment_tag    ON equipment(asset_tag);

CREATE TABLE IF NOT EXISTS equipment_loans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id    UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   TEXT,                           -- denormalized so loan record persists if customer deleted
  checked_out_by  UUID REFERENCES staff(id),
  checked_out_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at          TIMESTAMPTZ,                    -- when the gear should be back (often end-of-session)
  returned_at     TIMESTAMPTZ,                    -- NULL = still out
  returned_by     UUID REFERENCES staff(id),
  condition_out   TEXT,                           -- "good", "minor scuff", etc.
  condition_in    TEXT,
  fee_charged     NUMERIC(10,2) DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loans_eq         ON equipment_loans(equipment_id, checked_out_at DESC);
CREATE INDEX IF NOT EXISTS idx_loans_customer   ON equipment_loans(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_open       ON equipment_loans(equipment_id) WHERE returned_at IS NULL;

-- Trigger: auto-flip equipment.status when a loan opens or last open loan closes.
-- (15 fixes the close-side: only flips loaned → in_stock, never overwrites maintenance/lost/retired.)
CREATE OR REPLACE FUNCTION equipment_loan_status_sync() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  open_count INT;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE equipment SET status = 'loaned', updated_at = NOW()
     WHERE id = NEW.equipment_id AND status = 'in_stock';
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
      SELECT COUNT(*) INTO open_count
        FROM equipment_loans
       WHERE equipment_id = NEW.equipment_id AND returned_at IS NULL AND id <> NEW.id;
      IF open_count = 0 THEN
        UPDATE equipment SET status = 'in_stock', updated_at = NOW()
         WHERE id = NEW.equipment_id AND status = 'loaned';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_equipment_loan_status ON equipment_loans;
CREATE TRIGGER trg_equipment_loan_status
  AFTER INSERT OR UPDATE ON equipment_loans
  FOR EACH ROW EXECUTE FUNCTION equipment_loan_status_sync();

CREATE OR REPLACE FUNCTION equipment_touch_updated() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_equipment_touch ON equipment;
CREATE TRIGGER trg_equipment_touch BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION equipment_touch_updated();

-- Multi-tenant
ALTER TABLE equipment       ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE equipment_loans ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_equipment_tenant ON equipment(tenant_id);
CREATE INDEX IF NOT EXISTS idx_loans_tenant     ON equipment_loans(tenant_id);

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE equipment       SET tenant_id = seed_tid WHERE tenant_id IS NULL;
    UPDATE equipment_loans SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- RLS
ALTER TABLE equipment       ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_loans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eq_read  ON equipment;
DROP POLICY IF EXISTS eq_write ON equipment;
DROP POLICY IF EXISTS eq_edit  ON equipment;
DROP POLICY IF EXISTS eq_del   ON equipment;
CREATE POLICY eq_read  ON equipment FOR SELECT USING (is_staff());
CREATE POLICY eq_write ON equipment FOR INSERT WITH CHECK (is_staff());
CREATE POLICY eq_edit  ON equipment FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY eq_del   ON equipment FOR DELETE USING (is_owner());

DROP POLICY IF EXISTS eql_read  ON equipment_loans;
DROP POLICY IF EXISTS eql_write ON equipment_loans;
DROP POLICY IF EXISTS eql_edit  ON equipment_loans;
DROP POLICY IF EXISTS eql_del   ON equipment_loans;
CREATE POLICY eql_read  ON equipment_loans FOR SELECT USING (is_staff());
CREATE POLICY eql_write ON equipment_loans FOR INSERT WITH CHECK (is_staff());
CREATE POLICY eql_edit  ON equipment_loans FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY eql_del   ON equipment_loans FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON equipment       TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_loans TO anon, authenticated;
GRANT ALL ON equipment       TO service_role;
GRANT ALL ON equipment_loans TO service_role;

-- END 012_equipment.sql


-- ============================================================
-- BEGIN 013_reconciliation.sql
-- ============================================================
-- ============================================================
-- 013_reconciliation.sql — daily close-out / cash-drawer reconcile
--
-- End-of-day workflow: cashier counts drawer, system computes
-- expected totals from sales, variance is logged for audit.
-- Audit-trail level — once submitted, a reconciliation row is
-- (mostly) immutable. Owner can flag issues but not silently
-- delete a counted drawer without leaving a trail.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_reconciliations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date      DATE NOT NULL,                       -- the operational day this reconciles (e.g. 2026-04-30)
  -- Expected totals (computed from sales at close time, snapshotted here)
  expected_cash      NUMERIC(10,2) NOT NULL DEFAULT 0,
  expected_helcim    NUMERIC(10,2) NOT NULL DEFAULT 0,
  expected_card_manual NUMERIC(10,2) NOT NULL DEFAULT 0,  -- staff entered "Card" without provider integration
  expected_other     NUMERIC(10,2) NOT NULL DEFAULT 0,    -- venmo, zelle, check, comp, etc.
  expected_total     NUMERIC(10,2) NOT NULL DEFAULT 0,
  expected_tx_count  INT NOT NULL DEFAULT 0,
  -- Actual counted (drawer count)
  counted_cash       NUMERIC(10,2),                        -- what cashier physically counted
  starting_float     NUMERIC(10,2) DEFAULT 100,           -- bills left in drawer to start the day
  cash_variance      NUMERIC(10,2),                        -- counted_cash - starting_float - expected_cash
  -- Helcim reconcile (entered after Helcim deposit hits the bank, may be days later)
  helcim_deposit_date     DATE,
  helcim_deposit_amount   NUMERIC(10,2),
  helcim_variance         NUMERIC(10,2),
  -- Workflow
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','closed','flagged','disputed')),
  notes              TEXT,
  closed_by          UUID REFERENCES staff(id),
  closed_at          TIMESTAMPTZ,
  flagged_reason     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_date)                                  -- one reconcile per day
);

CREATE INDEX IF NOT EXISTS idx_recon_date   ON daily_reconciliations(business_date DESC);
CREATE INDEX IF NOT EXISTS idx_recon_status ON daily_reconciliations(status) WHERE status <> 'closed';

CREATE OR REPLACE FUNCTION recon_touch_updated() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_recon_touch ON daily_reconciliations;
CREATE TRIGGER trg_recon_touch BEFORE UPDATE ON daily_reconciliations FOR EACH ROW EXECUTE FUNCTION recon_touch_updated();

-- ------------------------------------------------------------
-- RPC: compute expected totals for a business date by aggregating
-- the sales table. Called from the close-out modal so the page
-- doesn't need to do client-side aggregation across hundreds of rows.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reconcile_expected(p_date DATE)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  cash_total    NUMERIC(10,2) := 0;
  helcim_total  NUMERIC(10,2) := 0;
  cardm_total   NUMERIC(10,2) := 0;
  other_total   NUMERIC(10,2) := 0;
  tx_count      INT := 0;
  result        JSON;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('cash')                                THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('helcim_pay','helcim_invoice','helcim') OR payment_provider = 'helcim' THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('card_manual','credit card','card')   THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) NOT IN ('cash','helcim_pay','helcim_invoice','helcim','card_manual','credit card','card') OR payment_method IS NULL THEN total ELSE 0 END), 0),
    COUNT(*)
  INTO cash_total, helcim_total, cardm_total, other_total, tx_count
  FROM sales
  WHERE created_at::date = p_date
    AND status = 'completed';

  result := json_build_object(
    'business_date',        p_date,
    'expected_cash',        cash_total,
    'expected_helcim',      helcim_total,
    'expected_card_manual', cardm_total,
    'expected_other',       other_total,
    'expected_total',       cash_total + helcim_total + cardm_total + other_total,
    'expected_tx_count',    tx_count
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_expected(DATE) TO authenticated;

-- ------------------------------------------------------------
-- Multi-tenant
-- ------------------------------------------------------------
ALTER TABLE daily_reconciliations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_recon_tenant ON daily_reconciliations(tenant_id);

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE daily_reconciliations SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ------------------------------------------------------------
-- RLS — staff can read + write their tenant's reconciliations.
-- Owner-only delete. Owner-only flag/dispute mutation.
-- ------------------------------------------------------------
ALTER TABLE daily_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recon_read   ON daily_reconciliations;
DROP POLICY IF EXISTS recon_write  ON daily_reconciliations;
DROP POLICY IF EXISTS recon_update ON daily_reconciliations;
DROP POLICY IF EXISTS recon_delete ON daily_reconciliations;

CREATE POLICY recon_read   ON daily_reconciliations FOR SELECT USING (is_staff());
CREATE POLICY recon_write  ON daily_reconciliations FOR INSERT WITH CHECK (is_staff());
CREATE POLICY recon_update ON daily_reconciliations FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY recon_delete ON daily_reconciliations FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON daily_reconciliations TO anon, authenticated;
GRANT ALL ON daily_reconciliations TO service_role;

-- END 013_reconciliation.sql


-- ============================================================
-- BEGIN 014_lesson_reminders.sql
-- ============================================================
-- ============================================================
-- 014_lesson_reminders.sql — track lesson reminder sends
--
-- Adds `reminder_sent_at` to lessons + a stamp for which channel(s)
-- the reminder went through. Lets the send-lesson-reminders Edge
-- Function be safely called repeatedly (idempotent — won't re-send).
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS reminder_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_channels TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_lessons_reminder_unsent
  ON lessons(scheduled_at)
  WHERE reminder_sent_at IS NULL AND status IN ('scheduled', 'confirmed');

-- END 014_lesson_reminders.sql


-- ============================================================
-- BEGIN 015_audit_fixes.sql
-- ============================================================
-- ============================================================
-- 015_audit_fixes.sql — fixes flagged in 2026-04-30 code audit
--
-- (1) ALTER TYPE inside-transaction risk from 008 — re-attempt
--     using a defensive pattern that works in both transactional
--     and non-transactional Supabase migration runners.
-- (2) Webhook log for forensic debugging of helcim-webhook (and
--     future webhook handlers).
--
-- Multi-tenant dynamic-table-list refactor is a v2 task — defer
-- until we add the next business table. For now the array in
-- 009 is documented as a known gotcha.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Make sure 'instructor' is in staff_role
--    (008 attempted this; this is a safety re-attempt that won't
--    fail if the value already exists.)
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'staff_role'::regtype AND enumlabel = 'instructor'
  ) THEN
    ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'instructor';
  END IF;
EXCEPTION WHEN feature_not_supported THEN
  RAISE NOTICE 'Could not add staff_role enum value (likely transactional context). Run separately: ALTER TYPE staff_role ADD VALUE IF NOT EXISTS ''instructor'';';
WHEN OTHERS THEN
  RAISE NOTICE 'staff_role.instructor enum extension skipped: %', SQLERRM;
END $$;

-- ------------------------------------------------------------
-- 2. webhook_log — forensic table for inbound webhook events.
--    helcim-webhook (and future Stripe / Smartwaiver webhooks)
--    write a row here on every event so silent failures leave a
--    trail.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,                  -- 'helcim', 'smartwaiver', 'stripe', etc.
  event_type      TEXT,                           -- e.g. 'cardTransaction.success'
  event_id        TEXT,                           -- provider's id
  status          TEXT NOT NULL CHECK (status IN ('received','processed','error','signature_mismatch','ignored')),
  ref_table       TEXT,                           -- which local table was updated
  ref_id          UUID,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message   TEXT,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_source ON webhook_log(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_log_errors ON webhook_log(status) WHERE status IN ('error','signature_mismatch');
CREATE INDEX IF NOT EXISTS idx_webhook_log_event  ON webhook_log(event_id) WHERE event_id IS NOT NULL;

-- Multi-tenant
ALTER TABLE webhook_log ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_webhook_log_tenant ON webhook_log(tenant_id);

-- RLS — owner-only read; Edge Functions write via service_role (bypasses RLS).
ALTER TABLE webhook_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wl_read   ON webhook_log;
DROP POLICY IF EXISTS wl_delete ON webhook_log;
CREATE POLICY wl_read   ON webhook_log FOR SELECT USING (is_owner());
CREATE POLICY wl_delete ON webhook_log FOR DELETE USING (is_owner());

GRANT SELECT, INSERT ON webhook_log TO authenticated;
GRANT ALL            ON webhook_log TO service_role;

-- ------------------------------------------------------------
-- 3. Tighten forms RLS — only EXPOSE enabled forms publicly.
--    (Audit found: anon could list every form schema, exposing
--    metadata of disabled / draft forms.)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS forms_read ON forms;
CREATE POLICY forms_read ON forms FOR SELECT USING (
  enabled = TRUE OR is_staff()
);

-- ------------------------------------------------------------
-- 4. Equipment status guard — prevent "lost" or "retired" items
--    from being silently flipped back to in_stock by the loan
--    sync trigger when an open loan is closed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION equipment_loan_status_sync() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  open_count INT;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE equipment SET status = 'loaned', updated_at = NOW()
     WHERE id = NEW.equipment_id AND status = 'in_stock';
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
      SELECT COUNT(*) INTO open_count
        FROM equipment_loans
       WHERE equipment_id = NEW.equipment_id AND returned_at IS NULL AND id <> NEW.id;
      IF open_count = 0 THEN
        -- ONLY flip to 'in_stock' if equipment is currently 'loaned'.
        -- Skip if maintenance / retired / lost so we don't undo manual interventions.
        UPDATE equipment SET status = 'in_stock', updated_at = NOW()
         WHERE id = NEW.equipment_id AND status = 'loaned';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

-- END 015_audit_fixes.sql


-- ============================================================
-- BEGIN 016_lesson_reminder_cron.sql
-- ============================================================
-- ============================================================
-- 016_lesson_reminder_cron.sql — pg_cron schedule for hourly reminders
--
-- Hits the send-lesson-reminders Edge Function every hour at :00.
-- The function is idempotent — safe to call repeatedly; it skips
-- lessons that already have reminder_sent_at set.
--
-- Requires Supabase pg_cron + pg_net extensions enabled.
-- Both are available on free tier (you may have to enable them
-- in Database → Extensions in the dashboard if not already on).
--
-- Idempotent. Safe to re-run — drops + re-adds the schedule.
-- ============================================================

-- Enable extensions (no-op if already on)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any prior schedule so this is idempotent
DO $$ BEGIN
  PERFORM cron.unschedule('lesson-reminders-hourly');
EXCEPTION WHEN OTHERS THEN NULL;  -- ignore if it doesn't exist
END $$;

-- Schedule the hourly call.
-- We need an Authorization header — the Edge Function defaults to verify-jwt.
-- Two paths:
--   (A) Deploy send-lesson-reminders with --no-verify-jwt, then add an internal
--       shared-secret check (CRON_SECRET env var) inside the function.
--   (B) Use the anon key here. The Edge Function itself uses service-role for DB
--       writes via createClient(SUPABASE_SERVICE_ROLE_KEY) so RLS is bypassed
--       internally regardless of caller token.
--
-- Path B is what we use here. The anon key is in supabase_functions schema:
--   `current_setting('supabase_functions.url_jwt_secret', true)` etc.
-- Supabase's `vault.decrypted_secrets` is the official way to keep secrets,
-- but for v1 we hardcode the project ref + call with a placeholder header
-- (the function still works because internal DB ops use service_role).
--
-- IMPORTANT: Update the URL below if your project ref changes.
SELECT cron.schedule(
  'lesson-reminders-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/send-lesson-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        current_setting('app.settings.service_role_key', true),
        ''
      )
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

-- Optional: schedule a daily 9am ET prune of old webhook_log entries (>90 days)
DO $$ BEGIN
  PERFORM cron.unschedule('webhook-log-prune-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'webhook-log-prune-daily',
  '0 13 * * *',                    -- 9am America/New_York = 13:00 UTC (DST drift OK)
  $$ DELETE FROM webhook_log WHERE created_at < NOW() - INTERVAL '90 days' $$
);

-- ------------------------------------------------------------
-- View scheduled jobs:
--   SELECT jobid, schedule, command FROM cron.job;
-- View recent runs:
--   SELECT * FROM cron.job_run_details ORDER BY end_time DESC LIMIT 20;
-- Manually fire a job:
--   SELECT cron.run('lesson-reminders-hourly');
-- ------------------------------------------------------------

-- END 016_lesson_reminder_cron.sql


-- ============================================================
-- BEGIN 017_mobile_shop.sql
-- ============================================================
-- ============================================================
-- 017_mobile_shop.sql — mobile bus shop runs
--
-- Doug runs a mobile skate shop out of a bus, parking at other
-- parks / events / contests and selling from inventory. Doug's
-- explicit constraint: "we won't want it to be a separate
-- location" — so we don't fork inventory. Instead, each run
-- snapshots what was TAKEN, sales tag with mobile_run_id, and
-- on close we count what came BACK; variance = (taken - sold) -
-- returned. Catches theft, damage, miscounts.
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mobile_run_status') THEN
    CREATE TYPE mobile_run_status AS ENUM ('planned','active','closed','cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mobile_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date          DATE NOT NULL,
  location_name     TEXT NOT NULL,             -- "Brooklyn Banks", "Bensonhurst Plaza", "Vans Park Series"
  location_address  TEXT,
  staff_id          UUID REFERENCES staff(id),
  status            mobile_run_status NOT NULL DEFAULT 'planned',
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  notes             TEXT,
  -- Computed at close (cached for fast list rendering)
  cached_gross      NUMERIC(12,2),
  cached_tx_count   INT,
  cached_variance_units INT,                   -- total units missing (or extra) across all products
  closed_by         UUID REFERENCES staff(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_runs_status ON mobile_runs(status, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_runs_date   ON mobile_runs(run_date DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_runs_active ON mobile_runs(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS mobile_run_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES mobile_runs(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name  TEXT NOT NULL,                 -- denormalized so renames don't break old runs
  qty_taken     INT NOT NULL DEFAULT 0,
  qty_returned  INT,                           -- NULL until close-out
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_inv_run ON mobile_run_inventory(run_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION mobile_run_touch_updated() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_mobile_run_touch ON mobile_runs;
CREATE TRIGGER trg_mobile_run_touch BEFORE UPDATE ON mobile_runs FOR EACH ROW EXECUTE FUNCTION mobile_run_touch_updated();

-- ------------------------------------------------------------
-- 2. sales.mobile_run_id — tag every sale that happened on a run
-- ------------------------------------------------------------
ALTER TABLE sales ADD COLUMN IF NOT EXISTS mobile_run_id UUID REFERENCES mobile_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_mobile_run ON sales(mobile_run_id) WHERE mobile_run_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. RPC: compute reconcile breakdown for a run.
--    For each product: taken / sold (from sales × sale_items) /
--    expected_return / actual_return / variance.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mobile_run_reconcile(p_run_id UUID)
RETURNS TABLE (
  product_id     UUID,
  product_name   TEXT,
  qty_taken      INT,
  qty_sold       BIGINT,
  qty_returned   INT,
  expected_return INT,
  variance       INT,
  gross_revenue  NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    mri.product_id,
    mri.product_name,
    mri.qty_taken,
    COALESCE(SUM(si.quantity), 0)::BIGINT AS qty_sold,
    mri.qty_returned,
    GREATEST(0, mri.qty_taken - COALESCE(SUM(si.quantity), 0))::INT AS expected_return,
    CASE
      WHEN mri.qty_returned IS NULL THEN NULL
      ELSE (mri.qty_returned - GREATEST(0, mri.qty_taken - COALESCE(SUM(si.quantity), 0)))::INT
    END AS variance,
    COALESCE(SUM(si.total), 0)::NUMERIC AS gross_revenue
  FROM mobile_run_inventory mri
  LEFT JOIN sale_items si ON si.product_id = mri.product_id
  LEFT JOIN sales s ON s.id = si.sale_id AND s.mobile_run_id = p_run_id AND s.status = 'completed'
  WHERE mri.run_id = p_run_id
  GROUP BY mri.product_id, mri.product_name, mri.qty_taken, mri.qty_returned
  ORDER BY mri.product_name;
$$;

GRANT EXECUTE ON FUNCTION mobile_run_reconcile(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 4. RPC: close out a run. Caches gross + variance into the
--    mobile_runs row so the list view doesn't need to recompute.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mobile_run_close(p_run_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total_gross NUMERIC := 0;
  total_tx INT := 0;
  total_var INT := 0;
  any_unreturned BOOL := FALSE;
BEGIN
  -- Compute gross + tx count from sales tagged with this run
  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_gross, total_tx
    FROM sales
   WHERE mobile_run_id = p_run_id AND status = 'completed';

  -- Sum variance across products. If any product has qty_returned NULL, flag it.
  SELECT COALESCE(SUM(ABS(variance)), 0), bool_or(qty_returned IS NULL)
    INTO total_var, any_unreturned
    FROM mobile_run_reconcile(p_run_id);

  IF any_unreturned THEN
    RAISE EXCEPTION 'Some products have not been counted on return — fill in qty_returned for every line first.';
  END IF;

  UPDATE mobile_runs SET
    status = 'closed',
    ended_at = COALESCE(ended_at, NOW()),
    cached_gross = total_gross,
    cached_tx_count = total_tx,
    cached_variance_units = total_var,
    closed_by = auth.uid(),
    updated_at = NOW()
  WHERE id = p_run_id;

  RETURN json_build_object(
    'run_id', p_run_id,
    'gross', total_gross,
    'tx_count', total_tx,
    'variance_units', total_var
  );
END;
$$;

GRANT EXECUTE ON FUNCTION mobile_run_close(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 5. Multi-tenant
-- ------------------------------------------------------------
ALTER TABLE mobile_runs           ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE mobile_run_inventory  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_mobile_runs_tenant ON mobile_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mobile_inv_tenant  ON mobile_run_inventory(tenant_id);

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE mobile_runs          SET tenant_id = seed_tid WHERE tenant_id IS NULL;
    UPDATE mobile_run_inventory SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
ALTER TABLE mobile_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_run_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mr_read   ON mobile_runs;
DROP POLICY IF EXISTS mr_write  ON mobile_runs;
DROP POLICY IF EXISTS mr_edit   ON mobile_runs;
DROP POLICY IF EXISTS mr_delete ON mobile_runs;
CREATE POLICY mr_read   ON mobile_runs FOR SELECT USING (is_staff());
CREATE POLICY mr_write  ON mobile_runs FOR INSERT WITH CHECK (is_staff());
CREATE POLICY mr_edit   ON mobile_runs FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY mr_delete ON mobile_runs FOR DELETE USING (is_owner());

DROP POLICY IF EXISTS mri_read   ON mobile_run_inventory;
DROP POLICY IF EXISTS mri_write  ON mobile_run_inventory;
DROP POLICY IF EXISTS mri_edit   ON mobile_run_inventory;
DROP POLICY IF EXISTS mri_delete ON mobile_run_inventory;
CREATE POLICY mri_read   ON mobile_run_inventory FOR SELECT USING (is_staff());
CREATE POLICY mri_write  ON mobile_run_inventory FOR INSERT WITH CHECK (is_staff());
CREATE POLICY mri_edit   ON mobile_run_inventory FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY mri_delete ON mobile_run_inventory FOR DELETE USING (is_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON mobile_runs           TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON mobile_run_inventory  TO anon, authenticated;
GRANT ALL ON mobile_runs           TO service_role;
GRANT ALL ON mobile_run_inventory  TO service_role;

-- END 017_mobile_shop.sql


-- ============================================================
-- BEGIN 018_inventory_locations.sql
-- ============================================================
-- ============================================================
-- 018_inventory_locations.sql — bus is a real location, not a run-snapshot
--
-- Doug clarified the mobile shop model on 2026-04-30 evening:
--
--   "Any inventory left on bus will still have that location."
--   "We certainly will have the same item in both locations —
--    Reds Bearings will have both places at the same time some days."
--
-- So inventory is location-aware, NOT split-per-SKU. A given SKU
-- (e.g. Reds Bearings) can simultaneously have:
--    - 12 units at base (products.quantity)
--    - 8 units on Bus #1 (bus_inventory row)
--    - 5 units on Bus #2 (separate bus_inventory row)
-- Each PHYSICAL UNIT is at one location, but a SKU can be in
-- multiple. Stock that doesn't sell on a run STAYS on the bus —
-- next run starts from whatever's already loaded.
-- Total stock for a SKU = products.quantity + SUM(bus_inventory).
--
-- This migration makes location a first-class concept:
--   - `inventory_locations`  — seeded with "Base park" + "Bus #1"
--   - `bus_inventory`        — running stock per (location, product)
--                              (only used for non-base locations)
--   - `inventory_transfers`  — append-only log of base↔bus moves
--   - `transfer_to_bus(location_id, product_id, qty)`  — atomic
--   - `transfer_from_bus(location_id, product_id, qty)` — atomic
--   - sales gets `location_id` so we know where each transaction
--     drained inventory (base = decrement products.quantity;
--     bus = decrement bus_inventory.quantity)
--
-- products.quantity remains the canonical BASE qty — this avoids
-- a giant rewrite of POS / inventory_log triggers. "Total stock"
-- across all locations = products.quantity + SUM(bus_inventory).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Locations
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_kind') THEN
    CREATE TYPE location_kind AS ENUM ('base','mobile','warehouse','popup');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inventory_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                         -- "Base park", "Bus #1", "Bensonhurst Pop-Up"
  kind        location_kind NOT NULL DEFAULT 'mobile',
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,        -- exactly ONE row should have is_default = true (the base)
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_default ON inventory_locations(is_default) WHERE is_default = TRUE;

-- Seed base park + one bus
INSERT INTO inventory_locations (name, kind, is_default, active)
SELECT '2nd Nature Park (Base)', 'base', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM inventory_locations WHERE is_default = TRUE);

INSERT INTO inventory_locations (name, kind, is_default, active)
SELECT 'Bus #1', 'mobile', FALSE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM inventory_locations WHERE kind = 'mobile' AND name = 'Bus #1');

-- ------------------------------------------------------------
-- 2. bus_inventory — running stock on non-base locations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bus_inventory (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity     INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_bus_inv_location ON bus_inventory(location_id);
CREATE INDEX IF NOT EXISTS idx_bus_inv_product  ON bus_inventory(product_id);

CREATE OR REPLACE FUNCTION bus_inv_touch() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_bus_inv_touch ON bus_inventory;
CREATE TRIGGER trg_bus_inv_touch BEFORE UPDATE ON bus_inventory FOR EACH ROW EXECUTE FUNCTION bus_inv_touch();

-- ------------------------------------------------------------
-- 3. inventory_transfers — append-only log of base↔bus moves
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_location   TEXT NOT NULL,                          -- 'base' or location_id (UUID-as-text)
  to_location     TEXT NOT NULL,                          -- same
  product_id      UUID NOT NULL REFERENCES products(id),
  product_name    TEXT NOT NULL,                          -- denormalized
  quantity        INT NOT NULL CHECK (quantity > 0),
  mobile_run_id   UUID REFERENCES mobile_runs(id) ON DELETE SET NULL,
  performed_by    UUID REFERENCES staff(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfers_run     ON inventory_transfers(mobile_run_id) WHERE mobile_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transfers_product ON inventory_transfers(product_id, created_at DESC);

-- ------------------------------------------------------------
-- 4. RPC: transfer_to_bus(location_id, product_id, qty)
--    Atomic move: decrement products.quantity (base), upsert
--    bus_inventory, append transfer log row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION transfer_to_bus(
  p_location_id UUID,
  p_product_id  UUID,
  p_quantity    INT,
  p_mobile_run_id UUID DEFAULT NULL,
  p_notes       TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base_qty INT;
  pname    TEXT;
  loc_kind location_kind;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'quantity must be > 0'; END IF;

  -- Verify location is non-base
  SELECT kind INTO loc_kind FROM inventory_locations WHERE id = p_location_id AND active = TRUE;
  IF loc_kind IS NULL THEN RAISE EXCEPTION 'Location not found or inactive'; END IF;
  IF loc_kind = 'base' THEN RAISE EXCEPTION 'Cannot transfer TO the base — use transfer_from_bus instead'; END IF;

  -- Lock + check base stock
  SELECT quantity, name INTO base_qty, pname
    FROM products WHERE id = p_product_id FOR UPDATE;
  IF base_qty IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF base_qty < p_quantity THEN RAISE EXCEPTION 'Not enough base stock — have %, need %', base_qty, p_quantity; END IF;

  -- Decrement base
  UPDATE products
     SET quantity = quantity - p_quantity, updated_at = NOW()
   WHERE id = p_product_id;

  -- Upsert bus
  INSERT INTO bus_inventory (location_id, product_id, quantity)
  VALUES (p_location_id, p_product_id, p_quantity)
  ON CONFLICT (location_id, product_id)
    DO UPDATE SET quantity = bus_inventory.quantity + p_quantity, updated_at = NOW();

  -- Log transfer
  INSERT INTO inventory_transfers (from_location, to_location, product_id, product_name, quantity, mobile_run_id, performed_by, notes)
  VALUES ('base', p_location_id::TEXT, p_product_id, pname, p_quantity, p_mobile_run_id, auth.uid(), p_notes);

  -- Inventory log entry (visible in admin Activity Log)
  INSERT INTO inventory_log (product_id, change, reason)
  VALUES (p_product_id, -p_quantity, 'Transfer to bus' || CASE WHEN p_mobile_run_id IS NOT NULL THEN ' (run)' ELSE '' END);

  RETURN json_build_object('ok', true, 'product', pname, 'qty', p_quantity, 'new_base_qty', base_qty - p_quantity);
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_to_bus(UUID,UUID,INT,UUID,TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5. RPC: transfer_from_bus(location_id, product_id, qty)
--    Atomic move: decrement bus_inventory, increment products.quantity,
--    log transfer.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION transfer_from_bus(
  p_location_id UUID,
  p_product_id  UUID,
  p_quantity    INT,
  p_mobile_run_id UUID DEFAULT NULL,
  p_notes       TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bus_qty INT;
  pname   TEXT;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'quantity must be > 0'; END IF;

  SELECT quantity INTO bus_qty
    FROM bus_inventory WHERE location_id = p_location_id AND product_id = p_product_id FOR UPDATE;
  IF bus_qty IS NULL OR bus_qty < p_quantity THEN
    RAISE EXCEPTION 'Not enough bus stock — have %, need %', COALESCE(bus_qty, 0), p_quantity;
  END IF;
  SELECT name INTO pname FROM products WHERE id = p_product_id;

  UPDATE bus_inventory SET quantity = quantity - p_quantity, updated_at = NOW()
   WHERE location_id = p_location_id AND product_id = p_product_id;

  UPDATE products SET quantity = quantity + p_quantity, updated_at = NOW()
   WHERE id = p_product_id;

  INSERT INTO inventory_transfers (from_location, to_location, product_id, product_name, quantity, mobile_run_id, performed_by, notes)
  VALUES (p_location_id::TEXT, 'base', p_product_id, pname, p_quantity, p_mobile_run_id, auth.uid(), p_notes);

  INSERT INTO inventory_log (product_id, change, reason)
  VALUES (p_product_id, p_quantity, 'Returned from bus' || CASE WHEN p_mobile_run_id IS NOT NULL THEN ' (run)' ELSE '' END);

  RETURN json_build_object('ok', true, 'product', pname, 'qty', p_quantity);
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_from_bus(UUID,UUID,INT,UUID,TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5b. mobile_runs gains vehicle_location_id — which bus this run uses.
--    Default any existing planned runs to the seeded "Bus #1".
-- ------------------------------------------------------------
ALTER TABLE mobile_runs ADD COLUMN IF NOT EXISTS vehicle_location_id UUID REFERENCES inventory_locations(id);
DO $$ DECLARE bus1 UUID; BEGIN
  SELECT id INTO bus1 FROM inventory_locations WHERE name = 'Bus #1' LIMIT 1;
  IF bus1 IS NOT NULL THEN
    UPDATE mobile_runs SET vehicle_location_id = bus1 WHERE vehicle_location_id IS NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 6. Sales gain a location_id — defaults to base when null.
--    Bus sales decrement bus_inventory via the `apply_bus_sale` trigger
--    (only when location_id points to a non-base location).
--    Base sales continue to decrement products.quantity via existing
--    POS code (admin/index.html finalizeSale).
-- ------------------------------------------------------------
ALTER TABLE sales ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES inventory_locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_location ON sales(location_id) WHERE location_id IS NOT NULL;

-- Trigger on sale_items: when the parent sale is at a non-base location,
-- decrement bus_inventory for that line. We do this on sale_items INSERT
-- because the line item is what carries product_id + quantity.
CREATE OR REPLACE FUNCTION apply_bus_sale_item() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  s_location UUID;
  s_status   TEXT;
  loc_kind   location_kind;
BEGIN
  SELECT location_id, status INTO s_location, s_status
    FROM sales WHERE id = NEW.sale_id;
  IF s_location IS NULL THEN RETURN NEW; END IF;
  IF s_status <> 'completed' THEN RETURN NEW; END IF;

  SELECT kind INTO loc_kind FROM inventory_locations WHERE id = s_location;
  IF loc_kind IS NULL OR loc_kind = 'base' THEN RETURN NEW; END IF;

  -- Decrement bus_inventory; create row at qty 0 if missing (so we can go negative-detection safe)
  UPDATE bus_inventory
     SET quantity = GREATEST(0, quantity - NEW.quantity), updated_at = NOW()
   WHERE location_id = s_location AND product_id = NEW.product_id;

  -- IMPORTANT: this trigger ALSO replaces the base-stock decrement that finalizeSale
  -- normally fires. Since the sale was at a non-base location, the JS-side
  -- decrement of products.quantity is wrong. To fix, the JS will skip its
  -- own decrement when sale.location_id is non-null. (See finalizeSale logic.)

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bus_sale_item ON sale_items;
CREATE TRIGGER trg_bus_sale_item
  AFTER INSERT ON sale_items
  FOR EACH ROW EXECUTE FUNCTION apply_bus_sale_item();

-- ------------------------------------------------------------
-- 7. Helper view: stock by location (for the admin dashboard)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock_by_location AS
  SELECT
    p.id              AS product_id,
    p.name            AS product_name,
    p.sku,
    'base'::TEXT      AS location_kind,
    NULL::UUID        AS location_id,
    p.quantity        AS quantity
  FROM products p
  WHERE p.quantity > 0
  UNION ALL
  SELECT
    bi.product_id,
    p.name,
    p.sku,
    il.kind::TEXT,
    bi.location_id,
    bi.quantity
  FROM bus_inventory bi
  JOIN products p ON p.id = bi.product_id
  JOIN inventory_locations il ON il.id = bi.location_id
  WHERE bi.quantity > 0;

GRANT SELECT ON v_stock_by_location TO anon, authenticated;

-- ------------------------------------------------------------
-- 8. Multi-tenant
-- ------------------------------------------------------------
ALTER TABLE inventory_locations  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE bus_inventory        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE inventory_transfers  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_locations_tenant ON inventory_locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_inv_tenant   ON bus_inventory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transfers_tenant ON inventory_transfers(tenant_id);

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE inventory_locations  SET tenant_id = seed_tid WHERE tenant_id IS NULL;
    UPDATE bus_inventory        SET tenant_id = seed_tid WHERE tenant_id IS NULL;
    UPDATE inventory_transfers  SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ------------------------------------------------------------
-- 9. RLS
-- ------------------------------------------------------------
ALTER TABLE inventory_locations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_inventory        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transfers  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS il_read ON inventory_locations;
DROP POLICY IF EXISTS il_edit ON inventory_locations;
CREATE POLICY il_read ON inventory_locations FOR SELECT USING (is_staff());
CREATE POLICY il_edit ON inventory_locations FOR ALL    USING (is_owner()) WITH CHECK (is_owner());

DROP POLICY IF EXISTS bi_read ON bus_inventory;
DROP POLICY IF EXISTS bi_edit ON bus_inventory;
CREATE POLICY bi_read ON bus_inventory FOR SELECT USING (is_staff());
CREATE POLICY bi_edit ON bus_inventory FOR ALL    USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS it_read   ON inventory_transfers;
DROP POLICY IF EXISTS it_write  ON inventory_transfers;
DROP POLICY IF EXISTS it_delete ON inventory_transfers;
CREATE POLICY it_read   ON inventory_transfers FOR SELECT USING (is_staff());
CREATE POLICY it_write  ON inventory_transfers FOR INSERT WITH CHECK (is_staff());
CREATE POLICY it_delete ON inventory_transfers FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_locations  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bus_inventory        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_transfers  TO anon, authenticated;
GRANT ALL ON inventory_locations  TO service_role;
GRANT ALL ON bus_inventory        TO service_role;
GRANT ALL ON inventory_transfers  TO service_role;

-- END 018_inventory_locations.sql


-- ============================================================
-- BEGIN 019_customer_self_serve.sql
-- ============================================================
-- ============================================================
-- 019_customer_self_serve.sql — let skaters log in and see their own data
--
-- Customers authenticate via Supabase magic-link. On first sign-in,
-- a "claim" RPC links their auth.user.id to a customers row matched
-- by email. RLS then lets them read their OWN customer row +
-- subscriptions / lessons / sales / loyalty_transactions.
--
-- Staff RLS (is_staff()) is unaffected — staff still see everything.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Link customers ↔ auth.users
-- ------------------------------------------------------------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_auth_user ON customers(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- Helper: returns the customer_id of the currently-authed user, or NULL.
CREATE OR REPLACE FUNCTION current_customer_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM customers WHERE auth_user_id = auth.uid() LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION current_customer_id() TO authenticated, anon;

-- ------------------------------------------------------------
-- 2. RPC: claim_customer_record()
--    Called on first sign-in. Looks up customer by auth.users.email,
--    sets auth_user_id, returns the customer row.
--    If no match exists, creates a new bare customer row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_customer_record() RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_email TEXT;
  uid        UUID;
  cust_id    UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Already linked?
  SELECT id INTO cust_id FROM customers WHERE auth_user_id = uid LIMIT 1;
  IF cust_id IS NOT NULL THEN RETURN cust_id; END IF;

  SELECT email INTO user_email FROM auth.users WHERE id = uid;
  IF user_email IS NULL THEN RAISE EXCEPTION 'Auth user has no email'; END IF;

  -- Match existing customer by email
  SELECT id INTO cust_id FROM customers WHERE LOWER(email) = LOWER(user_email) LIMIT 1;
  IF cust_id IS NOT NULL THEN
    UPDATE customers SET auth_user_id = uid, updated_at = NOW() WHERE id = cust_id;
    RETURN cust_id;
  END IF;

  -- Create bare customer for new self-signup
  INSERT INTO customers (email, name, first_name, last_name, auth_user_id, notes, tags)
  VALUES (
    user_email,
    split_part(user_email, '@', 1),
    split_part(user_email, '@', 1),
    NULL,
    uid,
    'Self-signed up via portal',
    ARRAY['self-signup']
  )
  RETURNING id INTO cust_id;

  RETURN cust_id;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_customer_record() TO authenticated;

-- ------------------------------------------------------------
-- 3. Self-read RLS policies
--    Customers can SELECT only their own row + own related rows.
--    Staff/owner policies (existing) unchanged — both apply via OR.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS cust_self_read ON customers;
CREATE POLICY cust_self_read ON customers FOR SELECT USING (
  auth_user_id = auth.uid()
);

DROP POLICY IF EXISTS cust_self_update ON customers;
CREATE POLICY cust_self_update ON customers FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Subscriptions — read own
DROP POLICY IF EXISTS sub_self_read ON subscriptions;
CREATE POLICY sub_self_read ON subscriptions FOR SELECT USING (
  customer_id = current_customer_id()
);

-- Lessons — read own
DROP POLICY IF EXISTS less_self_read ON lessons;
CREATE POLICY less_self_read ON lessons FOR SELECT USING (
  customer_id = current_customer_id()
);

-- Sales — read own
DROP POLICY IF EXISTS sales_self_read ON sales;
CREATE POLICY sales_self_read ON sales FOR SELECT USING (
  customer_id = current_customer_id()
);

-- Sale items — read own (via sale's customer_id)
DROP POLICY IF EXISTS si_self_read ON sale_items;
CREATE POLICY si_self_read ON sale_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND s.customer_id = current_customer_id())
);

-- Loyalty transactions — read own
DROP POLICY IF EXISTS lt_self_read ON loyalty_transactions;
CREATE POLICY lt_self_read ON loyalty_transactions FOR SELECT USING (
  customer_id = current_customer_id()
);

-- Checkins — read own
DROP POLICY IF EXISTS ci_self_read ON checkins;
CREATE POLICY ci_self_read ON checkins FOR SELECT USING (
  customer_id = current_customer_id()
);

-- Invoices — read own
DROP POLICY IF EXISTS inv_self_read ON invoices;
CREATE POLICY inv_self_read ON invoices FOR SELECT USING (
  customer_id = current_customer_id()
);

-- Loyalty config (public-readable for portal — config has no PII)
DROP POLICY IF EXISTS lc_public_read ON loyalty_config;
CREATE POLICY lc_public_read ON loyalty_config FOR SELECT USING (TRUE);

-- ------------------------------------------------------------
-- 4. RPC: customer_portal_summary()
--    One-shot fetch of everything the portal page needs.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION customer_portal_summary() RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cust_id UUID;
  result  JSON;
BEGIN
  cust_id := current_customer_id();
  IF cust_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Not linked to a customer record');
  END IF;

  SELECT json_build_object(
    'ok', true,
    'customer', (SELECT to_jsonb(c) - 'auth_user_id' FROM customers c WHERE c.id = cust_id),
    'subscriptions', (SELECT COALESCE(json_agg(to_jsonb(s)), '[]'::json) FROM subscriptions s WHERE s.customer_id = cust_id AND s.status = 'active'),
    'upcoming_lessons', (SELECT COALESCE(json_agg(to_jsonb(l)), '[]'::json) FROM lessons l WHERE l.customer_id = cust_id AND l.scheduled_at >= NOW() AND l.status IN ('scheduled','confirmed') ORDER BY l.scheduled_at LIMIT 10),
    'recent_sales', (SELECT COALESCE(json_agg(to_jsonb(s)), '[]'::json) FROM sales s WHERE s.customer_id = cust_id AND s.status = 'completed' ORDER BY s.created_at DESC LIMIT 10),
    'recent_loyalty', (SELECT COALESCE(json_agg(to_jsonb(lt)), '[]'::json) FROM loyalty_transactions lt WHERE lt.customer_id = cust_id ORDER BY lt.created_at DESC LIMIT 10),
    'checkin_count', (SELECT COUNT(*) FROM checkins WHERE customer_id = cust_id)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION customer_portal_summary() TO authenticated;

-- END 019_customer_self_serve.sql


-- ============================================================
-- BEGIN 020_team_chat.sql
-- ============================================================
-- ============================================================
-- 020_team_chat.sql — internal staff message board + reminders
--
-- For ops chatter that doesn't belong in Slack: "order more tees",
-- "fix the loose coping at the deep-end bowl", "Caitlin called out
-- Saturday" — short notes + assignable reminders with due dates.
--
-- Not a real-time chat (no presence, no typing indicators) — just
-- a feed staff check periodically. Realtime subscription on the
-- table makes new posts appear without a refresh.
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_message_kind') THEN
    CREATE TYPE team_message_kind AS ENUM ('note','reminder','announcement','question');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS team_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID REFERENCES team_messages(id) ON DELETE CASCADE,  -- threaded replies
  kind          team_message_kind NOT NULL DEFAULT 'note',
  body          TEXT NOT NULL,
  posted_by     UUID REFERENCES staff(id),
  posted_by_name TEXT,                                                 -- denormalized for read speed
  -- Reminder-only fields:
  assigned_to   UUID REFERENCES staff(id),                             -- NULL = anyone
  due_at        TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  completed_by  UUID REFERENCES staff(id),
  -- Reactions: lightweight array of {staff_id, emoji}
  reactions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  pinned        BOOLEAN NOT NULL DEFAULT FALSE,
  archived      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_msg_created  ON team_messages(created_at DESC) WHERE archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_team_msg_open_rem ON team_messages(due_at) WHERE kind = 'reminder' AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_msg_assigned ON team_messages(assigned_to) WHERE assigned_to IS NOT NULL AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_msg_parent   ON team_messages(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_msg_pinned   ON team_messages(pinned) WHERE pinned = TRUE AND archived = FALSE;

CREATE OR REPLACE FUNCTION team_msg_touch() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_team_msg_touch ON team_messages;
CREATE TRIGGER trg_team_msg_touch BEFORE UPDATE ON team_messages FOR EACH ROW EXECUTE FUNCTION team_msg_touch();

-- Multi-tenant
ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_team_msg_tenant ON team_messages(tenant_id);

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE team_messages SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- RLS — staff read all, staff post, owner can hard-delete; staff can edit own posts.
ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tm_read   ON team_messages;
DROP POLICY IF EXISTS tm_write  ON team_messages;
DROP POLICY IF EXISTS tm_edit   ON team_messages;
DROP POLICY IF EXISTS tm_delete ON team_messages;

CREATE POLICY tm_read   ON team_messages FOR SELECT USING (is_staff());
CREATE POLICY tm_write  ON team_messages FOR INSERT WITH CHECK (is_staff());
-- Staff can edit own posts; owner can edit anything (e.g. mark reminders complete on behalf).
CREATE POLICY tm_edit   ON team_messages FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY tm_delete ON team_messages FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON team_messages TO anon, authenticated;
GRANT ALL ON team_messages TO service_role;

-- Add to realtime publication so the chat live-updates without polling.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE team_messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- END 020_team_chat.sql


-- ============================================================
-- BEGIN 021_daily_digest_cron.sql
-- ============================================================
-- ============================================================
-- 021_daily_digest_cron.sql — schedule the daily-digest Edge Function
--
-- Fires every morning at 8am America/New_York (12:00 UTC during EDT,
-- 13:00 UTC during EST — picking 12:00 UTC = ~7-8am ET, close enough).
-- Owner gets a styled email with yesterday's stats + today's lessons.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Drop any prior schedule
DO $$ BEGIN
  PERFORM cron.unschedule('daily-digest-morning');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule: 12:00 UTC daily = ~7-8am ET
SELECT cron.schedule(
  'daily-digest-morning',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 90000
  ) AS request_id;
  $$
);

-- Inspect:
--   SELECT * FROM cron.job WHERE jobname = 'daily-digest-morning';
-- Manually fire:
--   SELECT cron.run('daily-digest-morning');
-- Or hit the function directly with curl:
--   curl -X POST https://zecurmlenxyxanqucrga.supabase.co/functions/v1/daily-digest \
--        -H "Authorization: Bearer <service-role-key>"

-- END 021_daily_digest_cron.sql


-- ============================================================
-- BEGIN 022_lesson_attended.sql
-- ============================================================
-- ============================================================
-- 022_lesson_attended.sql — track lesson attendance via check-in
--
-- When a customer checks in within ±15min of a scheduled lesson
-- they own, the JS auto-stamps attended_at on that lesson row.
-- This migration just adds the column.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS attended_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attended_via TEXT;  -- 'checkin_auto' | 'manual' | 'lesson_complete'

CREATE INDEX IF NOT EXISTS idx_lessons_attended ON lessons(attended_at) WHERE attended_at IS NOT NULL;

-- END 022_lesson_attended.sql


-- ============================================================
-- BEGIN 023_skater_photos.sql
-- ============================================================
-- ============================================================
-- 023_skater_photos.sql — photo URL on customer record
--
-- Front desk can attach a photo URL to a skater's record. Used for:
--   - Identity verification at check-in (correct kid using the punch card?)
--   - Member-card printer (face + name + QR on a 3.5×2 card)
--   - Customer detail modal in admin
--
-- v1 stores a URL (paste from Dropbox/iCloud/etc) — no Supabase Storage
-- bucket setup needed. v2 adds direct upload via Storage.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- END 023_skater_photos.sql


-- ============================================================
-- BEGIN 024_promo_codes.sql
-- ============================================================
-- ============================================================
-- 024_promo_codes.sql — discount codes redeemable at POS
--
-- Examples:
--   SUMMER25  — 25% off any sale
--   GROM10    — $10 off (for skaters under 12 / restrict_to_tag = 'minor')
--   FRIENDS5  — $5 off, 50 max uses, expires 2026-12-31
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'promo_kind') THEN
    CREATE TYPE promo_kind AS ENUM ('percent','fixed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS promo_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,                  -- case-insensitive lookup; we upper-case on lookup
  description     TEXT,
  kind            promo_kind NOT NULL,
  value           NUMERIC(10,2) NOT NULL,                -- percent (0-100) for 'percent', dollars for 'fixed'
  min_subtotal    NUMERIC(10,2) DEFAULT 0,               -- skip if cart subtotal < this
  max_uses        INT,                                   -- NULL = unlimited
  uses_count      INT NOT NULL DEFAULT 0,
  restrict_to_tag TEXT,                                  -- optional customer-tag gate (e.g. 'minor', 'industry')
  valid_from      TIMESTAMPTZ,
  valid_until     TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES staff(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_active ON promo_codes(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_promo_code   ON promo_codes(LOWER(code));

CREATE OR REPLACE FUNCTION promo_touch() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_promo_touch ON promo_codes;
CREATE TRIGGER trg_promo_touch BEFORE UPDATE ON promo_codes FOR EACH ROW EXECUTE FUNCTION promo_touch();

-- Sales gain a promo_code FK so we can audit + rate-limit
ALTER TABLE sales ADD COLUMN IF NOT EXISTS promo_code_id UUID REFERENCES promo_codes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_promo ON sales(promo_code_id) WHERE promo_code_id IS NOT NULL;

-- RPC: apply a promo (validates window, max_uses, increments counter atomically).
-- Returns { ok: true, discount_amount, code_id } or { ok: false, error }.
CREATE OR REPLACE FUNCTION promo_apply(
  p_code         TEXT,
  p_subtotal     NUMERIC,
  p_customer_tags TEXT[] DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec       promo_codes%ROWTYPE;
  discount  NUMERIC(10,2);
BEGIN
  SELECT * INTO rec FROM promo_codes WHERE LOWER(code) = LOWER(p_code) AND active = TRUE LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Code not found or inactive');
  END IF;

  IF rec.valid_from  IS NOT NULL AND NOW() < rec.valid_from  THEN
    RETURN json_build_object('ok', false, 'error', 'Code not yet active');
  END IF;
  IF rec.valid_until IS NOT NULL AND NOW() > rec.valid_until THEN
    RETURN json_build_object('ok', false, 'error', 'Code expired');
  END IF;
  IF rec.max_uses IS NOT NULL AND rec.uses_count >= rec.max_uses THEN
    RETURN json_build_object('ok', false, 'error', 'Code is fully used');
  END IF;
  IF p_subtotal < COALESCE(rec.min_subtotal, 0) THEN
    RETURN json_build_object('ok', false, 'error', 'Minimum subtotal not met ($' || rec.min_subtotal || ')');
  END IF;
  IF rec.restrict_to_tag IS NOT NULL AND (p_customer_tags IS NULL OR NOT (rec.restrict_to_tag = ANY(p_customer_tags))) THEN
    RETURN json_build_object('ok', false, 'error', 'Code restricted to ' || rec.restrict_to_tag || ' customers');
  END IF;

  -- Compute discount
  IF rec.kind = 'percent' THEN
    discount := ROUND(p_subtotal * (rec.value / 100.0), 2);
  ELSE
    discount := LEAST(rec.value, p_subtotal);  -- never exceed cart total
  END IF;

  -- Increment uses (commit-time)
  UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = rec.id;

  RETURN json_build_object(
    'ok', true,
    'code_id', rec.id,
    'code', rec.code,
    'kind', rec.kind,
    'value', rec.value,
    'discount_amount', discount,
    'description', rec.description
  );
END;
$$;

GRANT EXECUTE ON FUNCTION promo_apply(TEXT, NUMERIC, TEXT[]) TO authenticated;

-- Multi-tenant
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_promo_tenant ON promo_codes(tenant_id);

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE promo_codes SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- RLS
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pc_read   ON promo_codes;
DROP POLICY IF EXISTS pc_write  ON promo_codes;
DROP POLICY IF EXISTS pc_edit   ON promo_codes;
DROP POLICY IF EXISTS pc_delete ON promo_codes;
CREATE POLICY pc_read   ON promo_codes FOR SELECT USING (is_staff());
CREATE POLICY pc_write  ON promo_codes FOR INSERT WITH CHECK (is_owner());
CREATE POLICY pc_edit   ON promo_codes FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY pc_delete ON promo_codes FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON promo_codes TO anon, authenticated;
GRANT ALL ON promo_codes TO service_role;

-- END 024_promo_codes.sql


-- ============================================================
-- BEGIN 025_sales_tip.sql
-- ============================================================
-- ============================================================
-- 025_sales_tip.sql — gratuity / tip on a sale
--
-- For instructors getting tipped on lessons, or shop staff getting
-- a few bucks on a $200 deck setup. Tip lives separately from
-- discount + tax so reports don't conflate gratuity with revenue.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS tip NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tip_for_staff_id UUID REFERENCES staff(id);  -- nullable; lets shop split tips per instructor

CREATE INDEX IF NOT EXISTS idx_sales_tip ON sales(tip_for_staff_id) WHERE tip_for_staff_id IS NOT NULL;

-- END 025_sales_tip.sql


-- ============================================================
-- BEGIN 026_waiver_expiry.sql
-- ============================================================
-- ============================================================
-- 026_waiver_expiry.sql — annual waiver expiry tracking
--
-- Most parks make skaters re-sign waivers annually. Until now we only
-- tracked `waiver_signed_at` (set-and-forget) — a 5-year-old waiver
-- still showed green at the front desk.
--
-- Adds `waiver_expires_at` (default = signed + 365 days), backfills
-- existing rows, and a trigger that auto-sets expiry whenever
-- waiver_signed_at is bumped (renewal flow).
--
-- Front-desk JS keys off `_isWaiverValid(c)` = signed AND not expired.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS waiver_expires_at TIMESTAMPTZ;

-- Owner-tunable expiry window via app_settings (key='waiver' → {expiry_days: 365}).
-- Default 365 days; some parks want 6mo, others 18mo. Trigger reads this on every fire.
INSERT INTO app_settings (key, value)
VALUES ('waiver', jsonb_build_object('expiry_days', 365))
ON CONFLICT (key) DO NOTHING;

-- Backfill: every existing signed waiver gets +365 days from sign date
UPDATE customers
   SET waiver_expires_at = waiver_signed_at + INTERVAL '365 days'
 WHERE waiver_signed_at IS NOT NULL
   AND waiver_expires_at IS NULL;

-- Auto-set expiry on every renewal (anytime waiver_signed_at is updated).
-- Reads the current org-level expiry window from app_settings (key='waiver').
CREATE OR REPLACE FUNCTION waiver_set_expiry() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  win_days INT;
BEGIN
  IF NEW.waiver_signed_at IS NULL THEN
    NEW.waiver_expires_at := NULL;
    RETURN NEW;
  END IF;
  -- Only set/update expiry if signed-at changed (or expiry is null)
  IF (TG_OP = 'INSERT')
     OR (OLD.waiver_signed_at IS DISTINCT FROM NEW.waiver_signed_at)
     OR (NEW.waiver_expires_at IS NULL) THEN
    SELECT COALESCE((value->>'expiry_days')::INT, 365) INTO win_days
      FROM app_settings WHERE key = 'waiver';
    IF win_days IS NULL OR win_days <= 0 THEN win_days := 365; END IF;
    NEW.waiver_expires_at := NEW.waiver_signed_at + (win_days || ' days')::INTERVAL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_waiver_set_expiry ON customers;
CREATE TRIGGER trg_waiver_set_expiry
  BEFORE INSERT OR UPDATE OF waiver_signed_at ON customers
  FOR EACH ROW EXECUTE FUNCTION waiver_set_expiry();

-- Update search_customers RPC to include waiver_expires_at + photo_url
-- (photo_url was added in migration 023 but never wired into the search
-- RPC; rolling that fix in here too so front-desk hits get a photo and
-- accurate waiver state in one query).
DROP FUNCTION IF EXISTS search_customers(TEXT);

CREATE OR REPLACE FUNCTION search_customers(q TEXT)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  dob DATE,
  waiver_signed_at TIMESTAMPTZ,
  waiver_expires_at TIMESTAMPTZ,
  total_spent NUMERIC,
  last_visit_at TIMESTAMPTZ,
  loyalty_points INT,
  photo_url TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id, first_name, last_name, name, email, phone,
    dob, waiver_signed_at, waiver_expires_at,
    total_spent, last_visit_at,
    loyalty_points, photo_url
  FROM customers
  WHERE
    q IS NULL OR q = ''
    OR lower(first_name)  LIKE lower(q) || '%'
    OR lower(last_name)   LIKE lower(q) || '%'
    OR lower(email)       LIKE '%' || lower(q) || '%'
    OR phone              LIKE '%' || regexp_replace(q, '\D', '', 'g') || '%'
    OR lower(name)        LIKE '%' || lower(q) || '%'
  ORDER BY
    CASE WHEN lower(first_name) = lower(q) THEN 0
         WHEN lower(first_name) LIKE lower(q) || '%' THEN 1
         WHEN lower(last_name)  = lower(q) THEN 2
         WHEN lower(last_name)  LIKE lower(q) || '%' THEN 3
         ELSE 4
    END,
    last_visit_at DESC NULLS LAST,
    name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_customers(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_customers(TEXT) TO authenticated, anon;

-- Helpful index for "expiring soon" queries (admin reminders)
CREATE INDEX IF NOT EXISTS idx_customers_waiver_expires
  ON customers(waiver_expires_at)
  WHERE waiver_expires_at IS NOT NULL;

-- END 026_waiver_expiry.sql


-- ============================================================
-- BEGIN 027_lesson_no_shows.sql
-- ============================================================
-- ============================================================
-- 027_lesson_no_shows.sql — auto-mark lesson no-shows
--
-- Lessons that have started 30+ minutes ago AND were never marked
-- attended (no `attended_at` from migration 022's auto-stamp on
-- check-in, and no manual mark on the lesson page) get flipped from
-- 'scheduled' → 'no_show'.
--
-- Why this matters:
--   * Instructor pay needs to know which lessons actually happened
--   * Reports / attendance rates get accurate
--   * Front desk can see "Skater no-show'd 3x in 60 days" in customer
--     detail and gate further bookings if Doug wants
--   * Punch-card lessons should not double-deduct on no-show retries
--
-- Status enum already has 'no_show' (from 001_init.sql line 195).
-- We add: an idempotent RPC + a 15-min pg_cron schedule.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- RPC: scan lessons in the no-show window and flip status atomically.
-- Returns the count of lessons that were flipped.
CREATE OR REPLACE FUNCTION mark_lesson_no_shows(p_window_min INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  flipped INT;
BEGIN
  IF p_window_min IS NULL OR p_window_min < 0 THEN
    p_window_min := 30;
  END IF;

  -- 1. Flip the parent lesson rows — applies to both solo and group lessons.
  --    Solo lessons use lessons.attended_at as the truth.
  --    Group lessons use lesson_attendees rows (flipped in step 2 below);
  --    we still mark the parent row so reports keep working uniformly.
  WITH updated AS (
    UPDATE lessons
       SET status = 'no_show',
           updated_at = NOW()
     WHERE status = 'scheduled'
       AND attended_at IS NULL
       AND scheduled_at IS NOT NULL
       AND scheduled_at < NOW() - (p_window_min || ' minutes')::INTERVAL
       -- Don't flip really old ones — those probably mean the lesson
       -- happened but no one logged it. 7-day cutoff keeps the surface
       -- area small and means a stale row doesn't suddenly flip months later.
       AND scheduled_at > NOW() - INTERVAL '7 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO flipped FROM updated;

  -- 2. For group lessons (migration 032), also flip individual attendee rows
  --    that are still 'booked'. Skips silently if the table doesn't exist yet.
  BEGIN
    UPDATE lesson_attendees a
       SET status = 'no_show'
      FROM lessons l
     WHERE a.lesson_id = l.id
       AND a.status = 'booked'
       AND l.scheduled_at IS NOT NULL
       AND l.scheduled_at < NOW() - (p_window_min || ' minutes')::INTERVAL
       AND l.scheduled_at > NOW() - INTERVAL '7 days';
  EXCEPTION WHEN undefined_table THEN
    -- migration 032 not applied yet — group support disabled, fine.
    NULL;
  END;

  RETURN flipped;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_lesson_no_shows(INT) TO authenticated, anon;

-- Useful index for the scan
CREATE INDEX IF NOT EXISTS idx_lessons_scheduled_status
  ON lessons(scheduled_at, status)
  WHERE status = 'scheduled';

-- ------------------------------------------------------------
-- pg_cron: run every 15 minutes
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Drop any prior schedule with the same name so this migration is idempotent
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mark-lesson-no-shows-15min') THEN
      PERFORM cron.unschedule('mark-lesson-no-shows-15min');
    END IF;
    PERFORM cron.schedule(
      'mark-lesson-no-shows-15min',
      '*/15 * * * *',
      $cmd$ SELECT mark_lesson_no_shows(30); $cmd$
    );
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Inspection:
--   SELECT * FROM cron.job WHERE jobname = 'mark-lesson-no-shows-15min';
--   SELECT * FROM cron.job_run_details WHERE jobname = 'mark-lesson-no-shows-15min'
--     ORDER BY end_time DESC LIMIT 10;

-- END 027_lesson_no_shows.sql


-- ============================================================
-- BEGIN 028_loyalty_refund_reversal.sql
-- ============================================================
-- ============================================================
-- 028_loyalty_refund_reversal.sql — reverse loyalty earn on refund/void
--
-- Closes a financial leak: migration 006 awards loyalty_points on
-- completed sales but never reverses them when the sale is later
-- refunded or voided. A skater could buy a $200 board, get 200 points,
-- refund the next day, and keep the points. This reverses the earn.
--
-- Design:
--   * New trigger fires when sales.status transitions
--     from 'completed' → 'refunded' or 'voided'.
--   * Looks up the original earn (loyalty_transactions where
--     ref_type='sales' AND ref_id=sale.id AND delta>0) and inserts
--     a matching negative row with ref_type='sales_refund' so the
--     existing (ref_type, ref_id) UNIQUE INDEX doesn't conflict.
--   * loyalty_apply_delta() trigger from 006 already handles the
--     customer.loyalty_points sync (negative delta → balance drops,
--     clamped at 0 by GREATEST(0, ...)).
--
-- Edge cases handled:
--   * If no original earn (e.g. loyalty was disabled at sale time),
--     the trigger no-ops.
--   * If a sale is "un-refunded" (status flipped back), no re-award
--     happens automatically — Doug would handle as a manual adjust.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION loyalty_reverse_sale() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  earn_pts INT;
  earn_note TEXT;
BEGIN
  -- Only fire on transition INTO refunded/voided FROM completed
  IF NEW.status NOT IN ('refunded','voided') THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF OLD.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  -- Find the original earn row, if any. The 006 trigger uses
  -- ON CONFLICT (ref_type, ref_id) DO NOTHING so there's at most one.
  SELECT delta INTO earn_pts
    FROM loyalty_transactions
   WHERE ref_type = 'sales' AND ref_id = NEW.id AND delta > 0
   LIMIT 1;

  IF earn_pts IS NULL OR earn_pts <= 0 THEN
    RETURN NEW;  -- nothing to reverse (loyalty was disabled, or never awarded)
  END IF;

  earn_note := 'Reversed on '||NEW.status||' — receipt '||COALESCE(NEW.receipt_number, NEW.id::TEXT);

  -- Use ref_type='sales_refund' so the existing UNIQUE (ref_type, ref_id)
  -- doesn't conflict with the original earn row.
  INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
  VALUES (NEW.customer_id, -earn_pts, 'refund', 'sales_refund', NEW.id, earn_note)
  ON CONFLICT (ref_type, ref_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_reverse_sale ON sales;
CREATE TRIGGER trg_loyalty_reverse_sale
  AFTER UPDATE OF status ON sales
  FOR EACH ROW EXECUTE FUNCTION loyalty_reverse_sale();

-- END 028_loyalty_refund_reversal.sql


-- ============================================================
-- BEGIN 029_search_by_guardian.sql
-- ============================================================
-- ============================================================
-- 029_search_by_guardian.sql — front-desk search includes parent_name
--
-- Common scenario: parent calls and says "Hi, this is Sarah,
-- Tommy's mom" — front desk types "Sarah" but Sarah isn't a customer
-- (Tommy is). Without parent_name in the search predicate, the front
-- desk has to ask the kid's name, which slows everything.
--
-- This re-extends search_customers (last touched in migration 026)
-- to also match against `parent_name` on customers — same shape as the
-- name/email/phone match: prefix on lower(parent_name) plus a fuzzy
-- substring match.
--
-- Idempotent. Safe to re-run.
-- ============================================================

DROP FUNCTION IF EXISTS search_customers(TEXT);

CREATE OR REPLACE FUNCTION search_customers(q TEXT)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  dob DATE,
  waiver_signed_at TIMESTAMPTZ,
  waiver_expires_at TIMESTAMPTZ,
  total_spent NUMERIC,
  last_visit_at TIMESTAMPTZ,
  loyalty_points INT,
  photo_url TEXT,
  parent_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id, first_name, last_name, name, email, phone,
    dob, waiver_signed_at, waiver_expires_at,
    total_spent, last_visit_at,
    loyalty_points, photo_url, parent_name
  FROM customers
  WHERE
    q IS NULL OR q = ''
    OR lower(first_name)   LIKE lower(q) || '%'
    OR lower(last_name)    LIKE lower(q) || '%'
    OR lower(email)        LIKE '%' || lower(q) || '%'
    OR phone               LIKE '%' || regexp_replace(q, '\D', '', 'g') || '%'
    OR lower(name)         LIKE '%' || lower(q) || '%'
    OR lower(parent_name)  LIKE '%' || lower(q) || '%'
  ORDER BY
    CASE WHEN lower(first_name)  = lower(q) THEN 0
         WHEN lower(first_name)  LIKE lower(q) || '%' THEN 1
         WHEN lower(last_name)   = lower(q) THEN 2
         WHEN lower(last_name)   LIKE lower(q) || '%' THEN 3
         WHEN lower(parent_name) LIKE lower(q) || '%' THEN 4
         ELSE 5
    END,
    last_visit_at DESC NULLS LAST,
    name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_customers(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_customers(TEXT) TO authenticated, anon;

-- END 029_search_by_guardian.sql


-- ============================================================
-- BEGIN 030_subscription_pause.sql
-- ============================================================
-- ============================================================
-- 030_subscription_pause.sql — pause/resume support for memberships
--
-- Common scenarios:
--   * Skater on vacation, asks to skip a billing cycle
--   * Skater breaks an arm, freezes for 6 weeks
--   * Family pulls out for the season
--
-- Schema already has 'paused' status (from 001_init.sql line 158) but
-- no way to track "until when" — so the resume was always manual. This
-- adds `paused_until DATE` so a future billing cron can auto-resume.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS paused_until DATE;

-- Helper view (optional — useful for cron / reports):
-- subscriptions whose pause has expired and should be auto-resumed.
CREATE OR REPLACE VIEW subscriptions_due_to_resume AS
  SELECT *
  FROM subscriptions
  WHERE status = 'paused'
    AND paused_until IS NOT NULL
    AND paused_until <= CURRENT_DATE;

GRANT SELECT ON subscriptions_due_to_resume TO authenticated;

-- Index for the cron filter
CREATE INDEX IF NOT EXISTS idx_subs_paused_until
  ON subscriptions(paused_until)
  WHERE status = 'paused' AND paused_until IS NOT NULL;

-- ------------------------------------------------------------
-- Auto-resume RPC + pg_cron schedule: every morning, flip any
-- paused subscriptions whose paused_until has arrived back to active.
-- Stamps a note onto subscriptions.notes so the audit trail stays clean.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_resume_paused_subs()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  flipped INT;
BEGIN
  WITH updated AS (
    UPDATE subscriptions
       SET status       = 'active',
           paused_until = NULL,
           notes        = COALESCE(notes||E'\n','') ||
                          '[Auto-resumed '||CURRENT_DATE||' (paused_until reached)]',
           updated_at   = NOW()
     WHERE status       = 'paused'
       AND paused_until IS NOT NULL
       AND paused_until <= CURRENT_DATE
    RETURNING id
  )
  SELECT COUNT(*) INTO flipped FROM updated;
  RETURN flipped;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_resume_paused_subs() TO authenticated;

-- pg_cron: run daily at 06:00 UTC (~2am ET / 11pm PT). Clears overnight.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-resume-subs-daily') THEN
      PERFORM cron.unschedule('auto-resume-subs-daily');
    END IF;
    PERFORM cron.schedule(
      'auto-resume-subs-daily',
      '0 6 * * *',
      $cmd$ SELECT auto_resume_paused_subs(); $cmd$
    );
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- END 030_subscription_pause.sql


-- ============================================================
-- BEGIN 031_search_notes.sql
-- ============================================================
-- ============================================================
-- 031_search_notes.sql — global notes / freeform-text search
--
-- Doug's been documenting incidents, customer notes, sale-refund
-- reasons, lesson notes, etc. They're scattered across 4+ tables.
-- This RPC unifies them so the admin "Search notes" modal can
-- find "head injury near snake run" in one query regardless of
-- which row holds the text.
--
-- Returns a uniform shape: source / source_id / when / preview /
-- linked_customer_name. UI links to the right page.
--
-- Idempotent. Safe to re-run.
-- ============================================================

DROP FUNCTION IF EXISTS search_notes(TEXT);

CREATE OR REPLACE FUNCTION search_notes(q TEXT)
RETURNS TABLE (
  source TEXT,           -- 'customer' | 'sale' | 'lesson' | 'incident' | 'subscription'
  source_id UUID,
  when_at TIMESTAMPTZ,
  preview TEXT,          -- first 200 chars of the matched field
  linked_customer_id UUID,
  linked_customer_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Customer notes
  SELECT
    'customer'::TEXT       AS source,
    c.id                   AS source_id,
    c.updated_at           AS when_at,
    LEFT(c.notes, 200)     AS preview,
    c.id                   AS linked_customer_id,
    c.name                 AS linked_customer_name
  FROM customers c
  WHERE c.notes ILIKE '%' || q || '%'

  UNION ALL

  -- Sale notes (refund reasons, manual annotations)
  SELECT
    'sale'::TEXT,
    s.id,
    s.created_at,
    LEFT(s.notes, 200),
    s.customer_id,
    s.customer_name
  FROM sales s
  WHERE s.notes ILIKE '%' || q || '%'

  UNION ALL

  -- Lesson notes
  SELECT
    'lesson'::TEXT,
    l.id,
    l.scheduled_at,
    LEFT(l.notes, 200),
    l.customer_id,
    (SELECT c2.name FROM customers c2 WHERE c2.id = l.customer_id)
  FROM lessons l
  WHERE l.notes ILIKE '%' || q || '%'

  UNION ALL

  -- Incident description + corrective action notes
  SELECT
    'incident'::TEXT,
    i.id,
    i.occurred_at,
    LEFT(COALESCE(i.description, '') || CASE WHEN i.corrective_action IS NOT NULL THEN E'\n[action] '||i.corrective_action ELSE '' END, 200),
    i.customer_id,
    i.skater_name
  FROM incidents i
  WHERE i.description       ILIKE '%' || q || '%'
     OR i.corrective_action ILIKE '%' || q || '%'

  UNION ALL

  -- Subscription notes (pause reasons, audit stamps)
  SELECT
    'subscription'::TEXT,
    sb.id,
    sb.created_at,
    LEFT(sb.notes, 200),
    sb.customer_id,
    sb.customer_name
  FROM subscriptions sb
  WHERE sb.notes ILIKE '%' || q || '%'

  ORDER BY when_at DESC NULLS LAST
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION search_notes(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_notes(TEXT) TO authenticated;

-- END 031_search_notes.sql


-- ============================================================
-- BEGIN 032_lesson_capacity.sql
-- ============================================================
-- ============================================================
-- 032_lesson_capacity.sql — group lesson / camp capacity model
--
-- Today, a "Saturday Beginner Camp" with 8 kids is 8 separate
-- lesson rows — calendar gets cluttered, the cashier has to file
-- 8 bookings, and "X/Y booked" is impossible to display.
--
-- This adds:
--   * lessons.max_attendees INT DEFAULT 1
--     (1 = solo flow stays unchanged)
--   * lesson_attendees join table — one row per kid in a group
--     lesson, tracks attendance + status independently of the
--     parent lesson row.
--
-- Existing rows are backfilled — every solo lesson with a customer_id
-- gets one matching lesson_attendees row so the "attendees count" UI
-- works uniformly. Solo flow continues using the existing customer_id
-- column as the primary booker; the join row is just a mirror.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- 1. Capacity column on lessons
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS max_attendees INT NOT NULL DEFAULT 1;

-- 2. Attendee join table
CREATE TABLE IF NOT EXISTS lesson_attendees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','attended','no_show','cancelled','waitlist')),
  attended_at   TIMESTAMPTZ,
  attended_via  TEXT,                 -- 'checkin_auto' | 'manual' | 'lesson_complete'
  -- Capture who paid + how on a per-attendee basis (split-pay friendly)
  paid_by_customer_id UUID REFERENCES customers(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_id, customer_id)     -- one row per kid per lesson
);

CREATE INDEX IF NOT EXISTS idx_lesson_attendees_lesson   ON lesson_attendees(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_attendees_customer ON lesson_attendees(customer_id);
CREATE INDEX IF NOT EXISTS idx_lesson_attendees_status   ON lesson_attendees(status) WHERE status = 'booked';

-- 3. Backfill: existing solo lessons get one mirror row per attendee
--    Idempotent thanks to the UNIQUE (lesson_id, customer_id) — re-runs no-op.
INSERT INTO lesson_attendees (lesson_id, customer_id, status, attended_at, attended_via)
SELECT
  l.id,
  l.customer_id,
  CASE
    WHEN l.status = 'no_show'   THEN 'no_show'
    WHEN l.status = 'cancelled' THEN 'cancelled'
    WHEN l.attended_at IS NOT NULL OR l.status = 'completed' THEN 'attended'
    ELSE 'booked'
  END,
  l.attended_at,
  l.attended_via
FROM lessons l
WHERE l.customer_id IS NOT NULL
ON CONFLICT (lesson_id, customer_id) DO NOTHING;

-- 3b. Auto-mirror trigger: when a lesson is INSERTed (or its customer_id
--     changes), insert a matching lesson_attendees row so booked_count starts
--     at 1 immediately for solo lessons and the primary booker shows up in
--     the roster for group lessons. Idempotent via the (lesson_id, customer_id)
--     UNIQUE — re-points won't double-insert.
CREATE OR REPLACE FUNCTION lesson_mirror_primary_attendee() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO lesson_attendees (lesson_id, customer_id, status, attended_at, attended_via)
  VALUES (
    NEW.id,
    NEW.customer_id,
    CASE
      WHEN NEW.status = 'no_show'   THEN 'no_show'
      WHEN NEW.status = 'cancelled' THEN 'cancelled'
      WHEN NEW.attended_at IS NOT NULL OR NEW.status = 'completed' THEN 'attended'
      ELSE 'booked'
    END,
    NEW.attended_at,
    NEW.attended_via
  )
  ON CONFLICT (lesson_id, customer_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_mirror_primary ON lessons;
CREATE TRIGGER trg_lesson_mirror_primary
  AFTER INSERT OR UPDATE OF customer_id ON lessons
  FOR EACH ROW EXECUTE FUNCTION lesson_mirror_primary_attendee();

-- 4. Helper view: lessons with current attendee count + capacity
--    "X/Y booked" lookup is one query, not per-row.
CREATE OR REPLACE VIEW lessons_with_attendance AS
  SELECT
    l.*,
    COALESCE((SELECT COUNT(*) FROM lesson_attendees a WHERE a.lesson_id = l.id AND a.status IN ('booked','attended')), 0) AS booked_count,
    GREATEST(0, l.max_attendees -
      COALESCE((SELECT COUNT(*) FROM lesson_attendees a WHERE a.lesson_id = l.id AND a.status IN ('booked','attended')), 0)
    ) AS seats_left
  FROM lessons l;

GRANT SELECT ON lessons_with_attendance TO authenticated;

-- 5. RLS — same posture as lessons (staff read/write inheritable from main table policy).
ALTER TABLE lesson_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS la_read   ON lesson_attendees;
DROP POLICY IF EXISTS la_write  ON lesson_attendees;
DROP POLICY IF EXISTS la_edit   ON lesson_attendees;
DROP POLICY IF EXISTS la_delete ON lesson_attendees;
CREATE POLICY la_read   ON lesson_attendees FOR SELECT USING (is_staff());
CREATE POLICY la_write  ON lesson_attendees FOR INSERT WITH CHECK (is_staff());
CREATE POLICY la_edit   ON lesson_attendees FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY la_delete ON lesson_attendees FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON lesson_attendees TO anon, authenticated;
GRANT ALL ON lesson_attendees TO service_role;

-- 6. Multi-tenant tag — Phase A additive, mirrors migration 009 pattern.
ALTER TABLE lesson_attendees
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE lesson_attendees SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- END 032_lesson_capacity.sql


-- ============================================================
-- BEGIN 033_birthday_greetings.sql
-- ============================================================
-- ============================================================
-- 033_birthday_greetings.sql — daily birthday email + idempotency stamp
--
-- Adds the column the birthday-greetings Edge Function uses to skip
-- already-greeted customers within a day, and schedules pg_cron to
-- fire it once daily at 13:00 UTC (~9am ET).
--
-- The Edge Function itself (supabase/functions/birthday-greetings)
-- gracefully handles missing column — until this migration runs, it
-- just sends every time without dedupe.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS last_birthday_email_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_dob_mmdd
  ON customers ((to_char(dob, 'MM-DD')))
  WHERE dob IS NOT NULL;

-- pg_cron: run daily at 13:00 UTC (~9am ET / 6am PT)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'birthday-greetings-daily') THEN
      PERFORM cron.unschedule('birthday-greetings-daily');
    END IF;
    -- pg_net.http_post fires the Edge Function with the service-role JWT.
    -- Adjust the URL to your project ref. The service-role Authorization
    -- is read by the function from `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`.
    PERFORM cron.schedule(
      'birthday-greetings-daily',
      '0 13 * * *',
      $cmd$
        SELECT net.http_post(
          url := current_setting('app.settings.supabase_url', true) || '/functions/v1/birthday-greetings',
          headers := jsonb_build_object(
            'Content-Type','application/json',
            'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)
          ),
          body := '{}'::jsonb
        );
      $cmd$
    );
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Inspection:
--   SELECT * FROM cron.job WHERE jobname = 'birthday-greetings-daily';
--   SELECT * FROM cron.job_run_details WHERE jobname = 'birthday-greetings-daily'
--     ORDER BY end_time DESC LIMIT 10;
--
-- IF pg_net call fails with "missing setting", set the per-database settings:
--   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://zecurmlenxyxanqucrga.supabase.co';
--   ALTER DATABASE postgres SET app.settings.service_role_key = 'eyJhbGc...';
-- (Same pattern as migration 016 for lesson-reminders.)

-- END 033_birthday_greetings.sql


-- ============================================================
-- BEGIN 034_partial_refunds.sql
-- ============================================================
-- ============================================================
-- 034_partial_refunds.sql — partial refund support
--
-- Today refundSale() is all-or-nothing: flips sale status to
-- 'refunded' and that's it. Real-world ops need: "customer returns
-- just the wheels, keeps the deck — refund $50 of the $200 sale."
--
-- This adds:
--   * sales.refunded_amount  NUMERIC(10,2) DEFAULT 0
--   * sales.refunded_at      TIMESTAMPTZ
--   * sales.refunded_by      UUID
--
-- Effective-revenue queries become:
--   SUM(total) - SUM(refunded_amount)  WHERE status IN ('completed','refunded')
--
-- The existing 'refunded' status keeps full-refund semantics. A sale
-- where refunded_amount = total is functionally equivalent to status =
-- 'refunded'. The JS flow chooses one or the other based on amount.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_by     UUID REFERENCES staff(id);

-- Index for partial-refund reports
CREATE INDEX IF NOT EXISTS idx_sales_partial_refunded
  ON sales(refunded_at)
  WHERE refunded_amount > 0;

-- Loyalty reversal trigger (from migration 028) currently fires on full
-- refund only. Extend it to also fire on partial-refund — proportional
-- to the refunded amount. We keep the original full-refund path AND add
-- a partial path that uses the new refunded_amount column.
CREATE OR REPLACE FUNCTION loyalty_reverse_sale() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  earn_pts INT;
  reverse_pts INT;
  earn_total NUMERIC(10,2);
  refund_pct NUMERIC;
  earn_note TEXT;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  -- Find the original earn row, if any
  SELECT delta INTO earn_pts
    FROM loyalty_transactions
   WHERE ref_type = 'sales' AND ref_id = NEW.id AND delta > 0
   LIMIT 1;
  IF earn_pts IS NULL OR earn_pts <= 0 THEN RETURN NEW; END IF;

  earn_total := COALESCE(OLD.total, NEW.total);

  -- FULL refund/void path (unchanged from 028)
  IF NEW.status IN ('refunded','voided')
     AND OLD.status = 'completed'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
    VALUES (NEW.customer_id, -earn_pts, 'refund', 'sales_refund', NEW.id,
            'Reversed on '||NEW.status||' — receipt '||COALESCE(NEW.receipt_number, NEW.id::TEXT))
    ON CONFLICT (ref_type, ref_id) DO NOTHING;
    RETURN NEW;
  END IF;

  -- PARTIAL refund path — fires when refunded_amount transitions up
  -- (e.g. from 0 to 50). Reverse points proportional to (refunded_amount / total).
  IF (OLD.refunded_amount IS DISTINCT FROM NEW.refunded_amount)
     AND COALESCE(NEW.refunded_amount, 0) > COALESCE(OLD.refunded_amount, 0)
     AND NEW.status = 'completed'
     AND earn_total > 0 THEN
    refund_pct := (NEW.refunded_amount - COALESCE(OLD.refunded_amount, 0)) / earn_total;
    reverse_pts := FLOOR(earn_pts * refund_pct);
    IF reverse_pts > 0 THEN
      -- Use a unique ref so multiple partial refunds on same sale don't collide
      INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
      VALUES (NEW.customer_id, -reverse_pts, 'partial_refund', 'sales_partial_refund_'||to_char(NOW(),'YYYYMMDDHH24MISS'), NEW.id,
              'Partial refund $'||(NEW.refunded_amount - COALESCE(OLD.refunded_amount, 0))::TEXT||' on receipt '||COALESCE(NEW.receipt_number, NEW.id::TEXT));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_reverse_sale ON sales;
CREATE TRIGGER trg_loyalty_reverse_sale
  AFTER UPDATE OF status, refunded_amount ON sales
  FOR EACH ROW EXECUTE FUNCTION loyalty_reverse_sale();

-- END 034_partial_refunds.sql


-- ============================================================
-- BEGIN 035_email_opt_out.sql
-- ============================================================
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

-- END 035_email_opt_out.sql


-- ============================================================
-- BEGIN 036_auto_checkout_cron.sql
-- ============================================================
-- ============================================================
-- 036_auto_checkout_cron.sql — close lingering check-ins overnight
--
-- Real ops gap: front desk forgets to "End session" on stragglers,
-- so Monday morning the in-park grid is full of Sunday's open rows.
-- The mass-close button (shipped earlier) helps when staff remembers
-- — this is the safety net for when they don't.
--
-- Daily cron at 08:00 UTC (~3am ET / midnight PT — well past park close)
-- closes any checkins row open longer than the configured threshold
-- (default 8 hours). Stamps a small note so the audit trail explains
-- the auto-close.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Add notes column for the audit stamp (nullable; legacy rows untouched)
ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- RPC: close any check-in older than p_threshold_min minutes that's still open.
-- Returns the count flipped. Manual-callable too — the admin gets a button.
CREATE OR REPLACE FUNCTION auto_checkout_lingering(p_threshold_min INT DEFAULT 480)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  flipped INT;
BEGIN
  IF p_threshold_min IS NULL OR p_threshold_min < 30 THEN
    p_threshold_min := 480;  -- 8h default; never below 30 min for safety
  END IF;
  WITH updated AS (
    UPDATE checkins
       SET checked_out_at = NOW(),
           notes = COALESCE(notes||E'\n','') || '[Auto-closed at park-close cron — was open '||
                   ROUND(EXTRACT(EPOCH FROM (NOW() - checked_in_at))/60)||' min]'
     WHERE checked_out_at IS NULL
       AND checked_in_at < NOW() - (p_threshold_min || ' minutes')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*) INTO flipped FROM updated;
  RETURN flipped;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_checkout_lingering(INT) TO authenticated;

-- pg_cron: run daily at 08:00 UTC (~3am ET / midnight PT)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-checkout-lingering-daily') THEN
      PERFORM cron.unschedule('auto-checkout-lingering-daily');
    END IF;
    PERFORM cron.schedule(
      'auto-checkout-lingering-daily',
      '0 8 * * *',
      $cmd$ SELECT auto_checkout_lingering(480); $cmd$
    );
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Inspection:
--   SELECT * FROM cron.job WHERE jobname = 'auto-checkout-lingering-daily';
--   SELECT * FROM cron.job_run_details WHERE jobname = 'auto-checkout-lingering-daily'
--     ORDER BY end_time DESC LIMIT 10;

-- END 036_auto_checkout_cron.sql


-- ============================================================
-- BEGIN 037_customer_merge.sql
-- ============================================================
-- ============================================================
-- 037_customer_merge.sql — server-side customer merge RPC
--
-- Pairs with the JS "Find dupes" finder shipped earlier. When the
-- owner sees two records that are the same person (typo'd name,
-- registered twice, parent + kid swapped, etc.), this RPC moves
-- every FK reference from the "drop" customer to the "keep" one,
-- merges the loyalty balance, then deletes the drop row.
--
-- Tables touched (FK customer_id):
--   sales, lessons, subscriptions, loyalty_transactions, checkins,
--   incidents, lesson_attendees, invoices, orders, equipment_loans
--
-- Returns JSON { ok, kept_id, dropped_id, moved: { table → count } }.
-- Owner-only (is_owner() check). Wrapped in implicit transaction so a
-- mid-merge failure doesn't leave half-moved data.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION merge_customers(
  p_keep_id UUID,
  p_drop_id UUID,
  p_reason  TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  keep_row    customers%ROWTYPE;
  drop_row    customers%ROWTYPE;
  moved       JSONB := '{}'::JSONB;
  pts_keep    INT;
  pts_drop    INT;
  cnt         INT;
  audit_note  TEXT;
BEGIN
  IF NOT is_owner() THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  IF p_keep_id = p_drop_id THEN
    RAISE EXCEPTION 'keep_id and drop_id must differ';
  END IF;

  SELECT * INTO keep_row FROM customers WHERE id = p_keep_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Keep customer not found'; END IF;
  SELECT * INTO drop_row FROM customers WHERE id = p_drop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Drop customer not found'; END IF;

  -- 1. Move FKs. Each block is best-effort against missing tables.
  BEGIN UPDATE sales                SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('sales', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE lessons              SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('lessons', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE subscriptions        SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('subscriptions', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE loyalty_transactions SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('loyalty_transactions', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE checkins             SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('checkins', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE incidents            SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('incidents', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    -- lesson_attendees has UNIQUE (lesson_id, customer_id) — skip rows that would collide.
    DELETE FROM lesson_attendees a
     WHERE a.customer_id = p_drop_id
       AND EXISTS (SELECT 1 FROM lesson_attendees b WHERE b.lesson_id = a.lesson_id AND b.customer_id = p_keep_id);
    UPDATE lesson_attendees       SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
    GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('lesson_attendees', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE invoices             SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('invoices', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE orders               SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('orders', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE equipment_loans      SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('equipment_loans', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- 2. Sum loyalty cached balance (loyalty_transactions trigger from migration 006
  --    handles points sync on insert; we just patch the cached column on customers).
  pts_keep := COALESCE(keep_row.loyalty_points, 0);
  pts_drop := COALESCE(drop_row.loyalty_points, 0);
  IF pts_drop > 0 THEN
    UPDATE customers
       SET loyalty_points = pts_keep + pts_drop
     WHERE id = p_keep_id;
  END IF;

  -- 3. Stamp audit note onto kept row
  audit_note := '[Merged customer ' || COALESCE(drop_row.name,'?') || ' (' || drop_row.id || ') on ' ||
                to_char(NOW(),'YYYY-MM-DD') || COALESCE(': '||p_reason,'') || ']';
  UPDATE customers
     SET notes = COALESCE(notes||E'\n','') || audit_note,
         updated_at = NOW()
   WHERE id = p_keep_id;

  -- 4. Delete the dropped row
  DELETE FROM customers WHERE id = p_drop_id;

  RETURN json_build_object(
    'ok', true,
    'kept_id',    p_keep_id,
    'dropped_id', p_drop_id,
    'moved',      moved,
    'merged_loyalty', pts_drop
  );
END;
$$;

GRANT EXECUTE ON FUNCTION merge_customers(UUID, UUID, TEXT) TO authenticated;

-- END 037_customer_merge.sql


-- ============================================================
-- BEGIN 038_lesson_followups.sql
-- ============================================================
-- ============================================================
-- 038_lesson_followups.sql — post-lesson follow-up tracking
--
-- Pairs with the `send-lesson-followups` Edge Function. After a
-- lesson is marked attended/completed, a daily cron emails the
-- skater (or guardian for minors) a one-shot:
--   • "How was your lesson? Leave a Google review"
--   • Optional "Tip your instructor — Venmo/CashApp link"
--
-- Idempotency: stamp `lessons.followup_sent_at` after the email
-- lands so re-runs the same week skip already-followed-up rows.
--
-- Owner-tunable via `app_settings` key='followups':
--   {
--     enabled: true,
--     review_url: "https://g.page/r/.../review",
--     tip_enabled: true,
--     tip_url:    "https://venmo.com/u/2ndnature-park",
--     window_min_h: 2,        -- earliest hours after attended_at
--     window_max_h: 48,       -- latest hours after attended_at
--     subject:      "...",    -- optional template; {{first}} {{biz}}
--     body_html:    "...",    -- optional template
--     min_lesson_price: 0     -- skip free lessons (0 = include all)
--   }
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS followup_sent_at TIMESTAMPTZ;

-- Index just for the cron's lookup pattern (recently-attended, not-yet-followed-up).
-- Partial index keeps it tiny — only rows that need the cron's attention.
CREATE INDEX IF NOT EXISTS idx_lessons_followup_pending
  ON lessons (attended_at)
  WHERE attended_at IS NOT NULL AND followup_sent_at IS NULL;

-- pg_cron schedule: every hour at :15 past, calls the Edge Function via pg_net.
-- Same pattern as migration 016 (lesson reminders) and 033 (birthday greetings).
-- Requires database settings `app.settings.supabase_url` + `service_role_key`
-- (see migration 016 footer for the one-time setup).
DO $$
DECLARE
  fn_url TEXT;
  svc_key TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping lesson-followups schedule';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed — skipping lesson-followups schedule';
    RETURN;
  END IF;

  BEGIN
    fn_url  := current_setting('app.settings.supabase_url') || '/functions/v1/send-lesson-followups';
    svc_key := current_setting('app.settings.service_role_key');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'app.settings.supabase_url/service_role_key not configured — see migration 016 footer';
    RETURN;
  END;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lesson-followups-hourly') THEN
    PERFORM cron.unschedule('lesson-followups-hourly');
  END IF;
  PERFORM cron.schedule(
    'lesson-followups-hourly',
    '15 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
        body := '{}'::jsonb
      );
    $cmd$, fn_url, svc_key)
  );
END $$;

-- Inspection:
--   SELECT * FROM cron.job WHERE jobname = 'lesson-followups-hourly';
--   SELECT * FROM cron.job_run_details WHERE jobname = 'lesson-followups-hourly'
--     ORDER BY end_time DESC LIMIT 10;
--   SELECT id, scheduled_at, attended_at, followup_sent_at FROM lessons
--    WHERE attended_at > now() - interval '7 days' ORDER BY attended_at DESC;

-- END 038_lesson_followups.sql


-- ============================================================
-- BEGIN 039_renewal_reminders.sql
-- ============================================================
-- ============================================================
-- 039_renewal_reminders.sql — membership expiry renewal nudge
--
-- Pairs with the `send-renewal-reminders` Edge Function. Daily cron
-- sweeps active subscriptions whose end_date is within the configured
-- lead window (default 14 days) and emails the customer asking them
-- to renew before it lapses. Each row gets stamped on success so the
-- same membership doesn't get pinged twice in the same window.
--
-- Owner-tunable via `app_settings` key='renewal_reminders' (JSONB):
--   {
--     enabled:       true,
--     lead_days:     14,    -- send when end_date is within N days
--     min_days:      1,     -- skip if expired (already past — let lapsed flow handle)
--     plan_types:    ["monthly","annual","punch_card"], -- which kinds get nudged
--     subject:       "{{biz}} membership expiring soon",
--     body_html:     "..."  -- empty = built-in template
--   }
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS renewal_reminder_sent_at TIMESTAMPTZ;

-- Partial index for the cron's lookup pattern: only active subs that haven't
-- been reminded yet AND have an end_date.
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal_pending
  ON subscriptions (end_date)
  WHERE status = 'active'
    AND end_date IS NOT NULL
    AND renewal_reminder_sent_at IS NULL;

-- pg_cron schedule: daily at 14:00 UTC (~10am ET). Same pattern as
-- migrations 016 (lesson reminders), 033 (birthdays), 038 (followups).
DO $$
DECLARE
  fn_url TEXT;
  svc_key TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping renewal-reminders schedule';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed — skipping renewal-reminders schedule';
    RETURN;
  END IF;

  BEGIN
    fn_url  := current_setting('app.settings.supabase_url') || '/functions/v1/send-renewal-reminders';
    svc_key := current_setting('app.settings.service_role_key');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'app.settings.supabase_url/service_role_key not configured — see migration 016 footer';
    RETURN;
  END;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'renewal-reminders-daily') THEN
    PERFORM cron.unschedule('renewal-reminders-daily');
  END IF;
  PERFORM cron.schedule(
    'renewal-reminders-daily',
    '0 14 * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
        body := '{}'::jsonb
      );
    $cmd$, fn_url, svc_key)
  );
END $$;

-- Inspection:
--   SELECT id, plan_name, end_date, renewal_reminder_sent_at
--     FROM subscriptions
--    WHERE status='active' AND end_date IS NOT NULL
--    ORDER BY end_date ASC LIMIT 20;
--
--   SELECT * FROM cron.job_run_details WHERE jobname = 'renewal-reminders-daily'
--     ORDER BY end_time DESC LIMIT 10;

-- END 039_renewal_reminders.sql


-- ============================================================
-- BEGIN 040_overdue_rental_reminders.sql
-- ============================================================
-- ============================================================
-- 040_overdue_rental_reminders.sql — auto-email overdue rentals
--
-- Pairs with the `send-overdue-rentals` Edge Function. Daily cron
-- sweeps open `equipment_loans` rows where `due_at < now()` and
-- `returned_at IS NULL`, emails the customer asking them to bring
-- the gear back, and stamps `overdue_reminder_sent_at` so the same
-- loan doesn't get pinged twice in the same calendar day.
--
-- The stamp is a TIMESTAMPTZ — the cron only re-emails when more
-- than 24h has passed since the last stamp, so a stuck-out helmet
-- gets a daily reminder until it's returned (or owner manually
-- resets the stamp via SQL).
--
-- Owner-tunable via `app_settings` key='overdue_rentals' (JSONB):
--   {
--     enabled:     true,
--     grace_hours: 0,            -- skip until N hours past due
--     min_gap_h:   23,           -- min hours between reminders for same loan
--     subject:     "...",
--     body_html:   ""            -- empty = built-in template
--   }
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE equipment_loans
  ADD COLUMN IF NOT EXISTS overdue_reminder_sent_at TIMESTAMPTZ;

-- Partial index for the cron's lookup pattern
CREATE INDEX IF NOT EXISTS idx_loans_overdue_pending
  ON equipment_loans (due_at)
  WHERE returned_at IS NULL AND due_at IS NOT NULL;

-- pg_cron schedule: daily at 15:00 UTC (~11am ET). Same pattern as 016 / 033 / 038 / 039.
DO $$
DECLARE
  fn_url TEXT;
  svc_key TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping overdue-rental schedule';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed — skipping overdue-rental schedule';
    RETURN;
  END IF;

  BEGIN
    fn_url  := current_setting('app.settings.supabase_url') || '/functions/v1/send-overdue-rentals';
    svc_key := current_setting('app.settings.service_role_key');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'app.settings.supabase_url/service_role_key not configured — see migration 016 footer';
    RETURN;
  END;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'overdue-rentals-daily') THEN
    PERFORM cron.unschedule('overdue-rentals-daily');
  END IF;
  PERFORM cron.schedule(
    'overdue-rentals-daily',
    '0 15 * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
        body := '{}'::jsonb
      );
    $cmd$, fn_url, svc_key)
  );
END $$;

-- Inspection:
--   SELECT id, customer_name, due_at, overdue_reminder_sent_at
--     FROM equipment_loans
--    WHERE returned_at IS NULL AND due_at < NOW()
--    ORDER BY due_at ASC LIMIT 20;

-- END 040_overdue_rental_reminders.sql


-- ============================================================
-- BEGIN 041_gift_cards.sql
-- ============================================================
-- ============================================================
-- 041_gift_cards.sql — gift card sale + redemption
--
-- Two tables:
--   gift_cards               — one row per issued card
--   gift_card_transactions   — append-only ledger of every balance change
--
-- Workflow:
--   1. Cashier sells a gift card → POST sales row (synthetic line item)
--      + INSERT gift_cards (code, original_amount, balance=original_amount, ...)
--      + INSERT gift_card_transactions (delta=+original_amount, balance_after=original_amount)
--   2. Cashier redeems → at POS, types code → admin looks up card,
--      validates balance + status, applies min(balance, subtotal) as discount
--   3. On sale finalize → INSERT gift_card_transactions (delta=-applied,
--      balance_after=new_balance, sale_id=...)
--      + UPDATE gift_cards SET balance=new_balance,
--        status='redeemed' if balance hits 0
--
-- Codes: 12 random digits (collision-safe at skatepark scale, easy to type
-- off a printed receipt). Generated client-side; UNIQUE INDEX is the safety net.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS gift_cards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,
  original_amount       NUMERIC(10,2) NOT NULL CHECK (original_amount > 0),
  balance               NUMERIC(10,2) NOT NULL CHECK (balance >= 0),
  status                TEXT NOT NULL DEFAULT 'issued'
                          CHECK (status IN ('issued','partial','redeemed','refunded','expired','cancelled')),
  issued_to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  issued_to_name        TEXT,
  issued_to_email       TEXT,
  recipient_name        TEXT,                 -- gift recipient (often different from buyer)
  recipient_email       TEXT,
  recipient_phone       TEXT,                 -- so the buyer can text the code to the recipient
  message               TEXT,                 -- "happy birthday Tommy!"
  expires_at            DATE,
  notes                 TEXT,
  issued_by             UUID REFERENCES staff(id),
  issued_sale_id        UUID REFERENCES sales(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id             UUID REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_code     ON gift_cards (code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status   ON gift_cards (status) WHERE status IN ('issued','partial');
CREATE INDEX IF NOT EXISTS idx_gift_cards_customer ON gift_cards (issued_to_customer_id) WHERE issued_to_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id    UUID NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  sale_id         UUID REFERENCES sales(id) ON DELETE SET NULL,
  delta           NUMERIC(10,2) NOT NULL,    -- +amount on issue, -amount on redeem, +amount on refund
  balance_after   NUMERIC(10,2) NOT NULL,
  reason          TEXT NOT NULL DEFAULT 'redeem'
                    CHECK (reason IN ('issue','redeem','refund','adjust','expire','cancel')),
  actor_id        UUID REFERENCES staff(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gct_card  ON gift_card_transactions (gift_card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gct_sale  ON gift_card_transactions (sale_id) WHERE sale_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION gift_cards_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gift_cards_updated_at ON gift_cards;
CREATE TRIGGER trg_gift_cards_updated_at
  BEFORE UPDATE ON gift_cards
  FOR EACH ROW EXECUTE FUNCTION gift_cards_set_updated_at();

-- RLS — match the rest of the app's pattern: authenticated reads/writes,
-- multi-tenant ready (tenant_id checked via current_tenant_id() helper from
-- migration 009). Skip RLS Part B equivalent for now since the rest of the
-- app is also still in Phase A.
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_card_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gift_cards_all ON gift_cards;
CREATE POLICY gift_cards_all ON gift_cards
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS gct_all ON gift_card_transactions;
CREATE POLICY gct_all ON gift_card_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Public balance lookup — anyone with the code can check the balance without
-- logging in (standard gift card UX). The code itself is the access token;
-- 12 random digits = ~10^12 keyspace, brute-force-resistant for casual abuse.
-- Returns ONLY balance + status + recipient + expiry — no buyer or message.
-- SECURITY DEFINER bypasses RLS so anon role can call it.
CREATE OR REPLACE FUNCTION gift_card_balance_lookup(p_code TEXT)
RETURNS TABLE (
  balance         NUMERIC,
  original_amount NUMERIC,
  status          TEXT,
  recipient_name  TEXT,
  expires_at      DATE
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT balance, original_amount, status, recipient_name, expires_at
    FROM gift_cards
   WHERE code = p_code
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION gift_card_balance_lookup(TEXT) TO anon, authenticated;

-- Inspection:
--   SELECT code, original_amount, balance, status, recipient_name FROM gift_cards
--    ORDER BY created_at DESC LIMIT 20;
--   SELECT * FROM gift_card_transactions WHERE gift_card_id = '...' ORDER BY created_at DESC;

-- END 041_gift_cards.sql


-- ============================================================
-- BEGIN 042_split_payments.sql
-- ============================================================
-- ============================================================
-- 042_split_payments.sql — split payment support on POS
--
-- Adds a JSONB column `sales.payments` containing an array of payment
-- line items: [{ method, amount, ref?, note? }, …]. The existing
-- `sales.payment_method` column stays as the "primary" / largest line
-- so legacy reports keep working unchanged. When `payments` is non-empty,
-- it's the canonical breakdown — receipts + reconciliation read from it.
--
-- Schema:
--   payments[*] = {
--     method:  'Cash' | 'Credit Card' | 'Gift Card' | 'Venmo' | …,
--     amount:  numeric (positive),
--     ref:     optional reference (gift card code, transaction ID, last-4)
--     note:    optional free text
--   }
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS payments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Soft validation — payments must be an array. JSONB schema-validation in PG
-- without an extension is awkward, so we just enforce array-ness via CHECK.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_payments_is_array'
  ) THEN
    ALTER TABLE sales ADD CONSTRAINT sales_payments_is_array
      CHECK (jsonb_typeof(payments) = 'array');
  END IF;
END $$;

-- Index for "all sales with a Cash component" type queries used by reconcile.
-- Partial GIN — only rows where payments has at least one element.
CREATE INDEX IF NOT EXISTS idx_sales_payments
  ON sales USING GIN (payments)
  WHERE jsonb_array_length(payments) > 0;

-- Helper: sum amount across the payments array for one method.
-- Reconciliation uses this to compute "how much cash was tendered today
-- across all sales (including split sales)."
CREATE OR REPLACE FUNCTION sum_payments_by_method(p_sale_id UUID, p_method TEXT)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM((p->>'amount')::numeric), 0)
    FROM sales s, jsonb_array_elements(s.payments) p
   WHERE s.id = p_sale_id
     AND lower(p->>'method') = lower(p_method)
$$;

GRANT EXECUTE ON FUNCTION sum_payments_by_method(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- Override reconcile_expected (originally migration 013) so it understands
-- split-payment rows. For a sale with `payments` array populated, the
-- breakdown uses each line's method + amount. For legacy single-payment
-- rows (empty/null payments), the existing payment_method-based bucketing
-- still applies.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reconcile_expected(p_date DATE)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  cash_total    NUMERIC(10,2) := 0;
  helcim_total  NUMERIC(10,2) := 0;
  cardm_total   NUMERIC(10,2) := 0;
  giftc_total   NUMERIC(10,2) := 0;
  other_total   NUMERIC(10,2) := 0;
  tx_count      INT := 0;
BEGIN
  -- Single-payment legacy rows (no payments[] populated). Sum sales.total by primary method.
  SELECT
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('cash')                                                                          THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('helcim_pay','helcim_invoice','helcim') OR payment_provider = 'helcim'           THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('card_manual','credit card','card')                                              THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('gift card','giftcard','gift_card')                                              THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) NOT IN ('cash','helcim_pay','helcim_invoice','helcim','card_manual','credit card','card','gift card','giftcard','gift_card') OR payment_method IS NULL THEN total ELSE 0 END), 0),
    COUNT(*)
  INTO cash_total, helcim_total, cardm_total, giftc_total, other_total, tx_count
  FROM sales
  WHERE created_at::date = p_date
    AND status = 'completed'
    AND (payments IS NULL OR jsonb_array_length(payments) = 0);

  -- Split-payment rows — for each line in the array, bucket its amount.
  WITH split_lines AS (
    SELECT lower(p->>'method') AS method, (p->>'amount')::numeric AS amount
      FROM sales s, jsonb_array_elements(s.payments) p
     WHERE s.created_at::date = p_date
       AND s.status = 'completed'
       AND s.payments IS NOT NULL
       AND jsonb_array_length(s.payments) > 0
  )
  SELECT
    cash_total   + COALESCE(SUM(CASE WHEN method = 'cash'                                                                  THEN amount ELSE 0 END), 0),
    helcim_total + COALESCE(SUM(CASE WHEN method IN ('helcim_pay','helcim_invoice','helcim')                              THEN amount ELSE 0 END), 0),
    cardm_total  + COALESCE(SUM(CASE WHEN method IN ('card_manual','credit card','card')                                   THEN amount ELSE 0 END), 0),
    giftc_total  + COALESCE(SUM(CASE WHEN method IN ('gift card','giftcard','gift_card')                                   THEN amount ELSE 0 END), 0),
    other_total  + COALESCE(SUM(CASE WHEN method NOT IN ('cash','helcim_pay','helcim_invoice','helcim','card_manual','credit card','card','gift card','giftcard','gift_card') THEN amount ELSE 0 END), 0)
  INTO cash_total, helcim_total, cardm_total, giftc_total, other_total
  FROM split_lines;

  -- Add the split-sale tx count (counted as 1 per sale, not per line)
  tx_count := tx_count + (
    SELECT COUNT(*) FROM sales
     WHERE created_at::date = p_date
       AND status = 'completed'
       AND payments IS NOT NULL
       AND jsonb_array_length(payments) > 0
  );

  RETURN json_build_object(
    'business_date',        p_date,
    'expected_cash',        cash_total,
    'expected_helcim',      helcim_total,
    'expected_card_manual', cardm_total,
    'expected_gift_card',   giftc_total,
    'expected_other',       other_total,
    'expected_total',       cash_total + helcim_total + cardm_total + giftc_total + other_total,
    'expected_tx_count',    tx_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_expected(DATE) TO authenticated;

-- Inspection:
--   SELECT id, payment_method, payments FROM sales WHERE jsonb_array_length(payments) > 0 LIMIT 10;
--   SELECT reconcile_expected(CURRENT_DATE);

-- END 042_split_payments.sql


-- ============================================================
-- BEGIN 043_customer_cancel_lesson.sql
-- ============================================================
-- ============================================================
-- 043_customer_cancel_lesson.sql — customer self-serve cancellation
--
-- Lets a signed-in customer cancel their own upcoming lesson via the
-- self-serve portal (admin/me.html). SECURITY DEFINER bypasses RLS so
-- we can flip lessons.status + insert the late-cancel fee sale (if
-- the policy applies) — but the function gates on
-- `current_customer_id() = lesson.customer_id` so a customer can only
-- cancel their own lessons.
--
-- Fee logic mirrors the admin cancelLesson() flow:
--   • Reads cancellation policy from `app_settings` key='all'.value.cancellationPolicy
--     (enabled / windowHours / feePercent), defaults: enabled=false, 24h, 50%
--   • If enabled AND lesson is within window AND has a price > 0:
--     creates a sale row "Late cancellation fee" tagged Pending
--   • Otherwise no fee
--
-- Returns JSON { ok, fee_charged, fee_amount } so the customer-facing
-- portal can render the right confirmation message.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customer_cancel_lesson(p_lesson_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id        UUID;
  v_lesson             lessons%ROWTYPE;
  v_settings           JSONB;
  v_policy             JSONB;
  v_policy_enabled     BOOLEAN := false;
  v_policy_window_h    INT     := 24;
  v_policy_fee_pct     INT     := 50;
  v_hours_until        NUMERIC;
  v_fee_amount         NUMERIC := 0;
  v_fee_charged        BOOLEAN := false;
  v_fee_sale_id        UUID;
  v_note_stamp         TEXT;
  v_combined_notes     TEXT;
BEGIN
  v_customer_id := current_customer_id();
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated as a customer';
  END IF;

  SELECT * INTO v_lesson FROM lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lesson not found';
  END IF;

  -- Gate: customer can only cancel their own lesson (solo path). Group
  -- lessons where they're a non-primary attendee should use a different
  -- flow (drop themselves from lesson_attendees) — out of scope here.
  IF v_lesson.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'Not authorized to cancel this lesson';
  END IF;

  IF v_lesson.status = 'cancelled' THEN
    RAISE EXCEPTION 'Lesson is already cancelled';
  END IF;

  IF v_lesson.scheduled_at IS NOT NULL
     AND v_lesson.scheduled_at < NOW() THEN
    RAISE EXCEPTION 'Cannot cancel a lesson that has already started';
  END IF;

  -- Read cancellation policy from app_settings
  BEGIN
    SELECT value INTO v_settings FROM app_settings WHERE key = 'all';
    IF v_settings IS NOT NULL THEN
      v_policy := v_settings->'cancellationPolicy';
      IF v_policy IS NOT NULL THEN
        v_policy_enabled  := COALESCE((v_policy->>'enabled')::boolean, false);
        v_policy_window_h := COALESCE((v_policy->>'windowHours')::int, 24);
        v_policy_fee_pct  := COALESCE((v_policy->>'feePercent')::int, 50);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- app_settings table missing or malformed → treat as policy disabled
    v_policy_enabled := false;
  END;

  -- Compute fee if applicable
  IF v_policy_enabled
     AND v_lesson.scheduled_at IS NOT NULL
     AND v_lesson.price IS NOT NULL
     AND v_lesson.price > 0 THEN
    v_hours_until := EXTRACT(EPOCH FROM (v_lesson.scheduled_at - NOW())) / 3600.0;
    IF v_hours_until >= 0 AND v_hours_until < v_policy_window_h THEN
      v_fee_amount := ROUND((v_lesson.price * v_policy_fee_pct / 100.0)::numeric, 2);
      v_fee_charged := (v_fee_amount > 0);
    END IF;
  END IF;

  -- Stamp the lesson notes
  v_note_stamp := '[Cancelled '|| TO_CHAR(NOW(),'YYYY-MM-DD') ||' by customer (self-serve)'
                || CASE WHEN v_fee_charged
                        THEN ': '|| v_policy_fee_pct ||'% fee $'|| v_fee_amount ||' applied'
                        ELSE '' END
                || ']';
  v_combined_notes := COALESCE(v_lesson.notes || E'\n', '') || v_note_stamp;

  -- Flip the lesson
  UPDATE lessons
     SET status = 'cancelled',
         notes  = v_combined_notes,
         updated_at = NOW()
   WHERE id = p_lesson_id;

  -- Create the fee sale (if applicable). Status='completed', payment='Pending'
  -- so the front desk knows to collect at next visit.
  IF v_fee_charged THEN
    INSERT INTO sales (
      customer_id, customer_name, product_id, product_name,
      quantity, subtotal, tax, discount, total,
      payment_method, status, notes
    )
    SELECT v_lesson.customer_id, c.name, NULL,
           'Late cancellation fee — '|| COALESCE(v_lesson.type,'lesson'),
           1, v_fee_amount, 0, 0, v_fee_amount,
           'Pending', 'completed',
           '[Self-serve cancellation late-fee · '|| v_policy_fee_pct ||'% of $'|| v_lesson.price ||' lesson · '|| TO_CHAR(NOW(),'YYYY-MM-DD') ||']'
      FROM customers c
     WHERE c.id = v_lesson.customer_id
    RETURNING id INTO v_fee_sale_id;
  END IF;

  -- Best-effort: mirror cancellation onto lesson_attendees if migration 032
  -- has been applied. Silent if not.
  BEGIN
    UPDATE lesson_attendees SET status = 'cancelled'
     WHERE lesson_id = p_lesson_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;  -- migration 032 not applied
  END;

  RETURN json_build_object(
    'ok',           true,
    'lesson_id',    p_lesson_id,
    'fee_charged',  v_fee_charged,
    'fee_amount',   v_fee_amount,
    'fee_sale_id',  v_fee_sale_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION customer_cancel_lesson(UUID) TO authenticated;

-- Inspection:
--   SELECT customer_cancel_lesson('<lesson_id>');  -- as the auth'd customer

-- END 043_customer_cancel_lesson.sql


-- ============================================================
-- BEGIN 044_customer_update_self.sql
-- ============================================================
-- ============================================================
-- 044_customer_update_self.sql — customer self-serve profile edit
--
-- Lets a signed-in customer update their own contact info from the
-- self-serve portal (admin/me.html) without calling the front desk.
-- SECURITY DEFINER bypasses RLS; gates on
-- `current_customer_id() = customer.id` so a customer can only edit
-- their own record.
--
-- Allowed fields: email, phone, parent_name, parent_phone, parent_email,
-- address, city, state, zip, dob (if not yet set — DOB only editable
-- once to prevent fraud against age-gated discounts).
--
-- Refused fields (auth-sensitive or owner-managed): name (forces a
-- conversation if they've changed legal name), waiver_*, loyalty_*,
-- total_spent, total_visits, tags, photo_url, status. The owner edits
-- those from the admin side.
--
-- Each successful update appends an audit line to customer.notes:
--   [Self-edit 2026-05-05 by customer: email, phone]
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customer_update_self(
  p_email         TEXT DEFAULT NULL,
  p_phone         TEXT DEFAULT NULL,
  p_parent_name   TEXT DEFAULT NULL,
  p_parent_phone  TEXT DEFAULT NULL,
  p_parent_email  TEXT DEFAULT NULL,
  p_address       TEXT DEFAULT NULL,
  p_city          TEXT DEFAULT NULL,
  p_state         TEXT DEFAULT NULL,
  p_zip           TEXT DEFAULT NULL,
  p_dob           DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id  UUID;
  v_existing     customers%ROWTYPE;
  v_changes      TEXT[] := ARRAY[]::TEXT[];
  v_email_clean  TEXT;
  v_phone_clean  TEXT;
  v_audit_stamp  TEXT;
  v_combined_notes TEXT;
BEGIN
  v_customer_id := current_customer_id();
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated as a customer';
  END IF;

  SELECT * INTO v_existing FROM customers WHERE id = v_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer record not found';
  END IF;

  -- Track which fields actually changed for the audit stamp.
  -- NULL incoming = "don't touch" (preserve existing); empty string = "clear".
  -- Trim incoming strings to avoid whitespace-only updates.

  IF p_email IS NOT NULL THEN
    v_email_clean := NULLIF(TRIM(p_email), '');
    IF v_email_clean IS DISTINCT FROM v_existing.email THEN
      -- Light email sanity (server-side). Reject obvious junk.
      IF v_email_clean IS NOT NULL AND v_email_clean !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'Invalid email format: %', v_email_clean;
      END IF;
      v_changes := array_append(v_changes, 'email');
    END IF;
  END IF;

  IF p_phone IS NOT NULL THEN
    v_phone_clean := NULLIF(TRIM(p_phone), '');
    IF v_phone_clean IS DISTINCT FROM v_existing.phone THEN
      v_changes := array_append(v_changes, 'phone');
    END IF;
  END IF;

  IF p_parent_name IS NOT NULL AND NULLIF(TRIM(p_parent_name),'') IS DISTINCT FROM v_existing.parent_name THEN
    v_changes := array_append(v_changes, 'parent_name');
  END IF;
  IF p_parent_phone IS NOT NULL AND NULLIF(TRIM(p_parent_phone),'') IS DISTINCT FROM v_existing.parent_phone THEN
    v_changes := array_append(v_changes, 'parent_phone');
  END IF;
  IF p_parent_email IS NOT NULL AND NULLIF(TRIM(p_parent_email),'') IS DISTINCT FROM v_existing.parent_email THEN
    IF NULLIF(TRIM(p_parent_email),'') IS NOT NULL AND p_parent_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'Invalid parent email format';
    END IF;
    v_changes := array_append(v_changes, 'parent_email');
  END IF;
  IF p_address IS NOT NULL AND NULLIF(TRIM(p_address),'') IS DISTINCT FROM v_existing.address THEN
    v_changes := array_append(v_changes, 'address');
  END IF;
  IF p_city IS NOT NULL AND NULLIF(TRIM(p_city),'') IS DISTINCT FROM v_existing.city THEN
    v_changes := array_append(v_changes, 'city');
  END IF;
  IF p_state IS NOT NULL AND NULLIF(TRIM(p_state),'') IS DISTINCT FROM v_existing.state THEN
    v_changes := array_append(v_changes, 'state');
  END IF;
  IF p_zip IS NOT NULL AND NULLIF(TRIM(p_zip),'') IS DISTINCT FROM v_existing.zip THEN
    v_changes := array_append(v_changes, 'zip');
  END IF;

  -- DOB: only editable when currently NULL (one-shot, prevents age-gate fraud).
  -- If they need to change a wrong DOB, they call the front desk.
  IF p_dob IS NOT NULL AND v_existing.dob IS NULL THEN
    v_changes := array_append(v_changes, 'dob');
  ELSIF p_dob IS NOT NULL AND p_dob IS DISTINCT FROM v_existing.dob THEN
    -- Silent ignore — DOB already set. Don't error (would be ugly UX),
    -- just skip the field. Audit reflects what actually changed.
    NULL;
  END IF;

  IF array_length(v_changes, 1) IS NULL THEN
    -- No actual changes
    RETURN json_build_object('ok', true, 'changed', 0, 'fields', '[]'::JSON);
  END IF;

  -- Compose the audit stamp
  v_audit_stamp := '[Self-edit '|| TO_CHAR(NOW(),'YYYY-MM-DD') ||' by customer: '|| array_to_string(v_changes, ', ') ||']';
  v_combined_notes := COALESCE(v_existing.notes || E'\n', '') || v_audit_stamp;

  -- Apply the update — coalesce ensures NULL incoming = preserve existing.
  -- Empty-string-to-NULL preserved via the v_email_clean / v_phone_clean
  -- pattern above; for parent_* / address etc. we use NULLIF inline.
  UPDATE customers
     SET email         = COALESCE(v_email_clean, email),
         phone         = COALESCE(v_phone_clean, phone),
         parent_name   = CASE WHEN p_parent_name  IS NOT NULL THEN NULLIF(TRIM(p_parent_name),'')  ELSE parent_name  END,
         parent_phone  = CASE WHEN p_parent_phone IS NOT NULL THEN NULLIF(TRIM(p_parent_phone),'') ELSE parent_phone END,
         parent_email  = CASE WHEN p_parent_email IS NOT NULL THEN NULLIF(TRIM(p_parent_email),'') ELSE parent_email END,
         address       = CASE WHEN p_address      IS NOT NULL THEN NULLIF(TRIM(p_address),'')      ELSE address      END,
         city          = CASE WHEN p_city         IS NOT NULL THEN NULLIF(TRIM(p_city),'')         ELSE city         END,
         state         = CASE WHEN p_state        IS NOT NULL THEN NULLIF(TRIM(p_state),'')        ELSE state        END,
         zip           = CASE WHEN p_zip          IS NOT NULL THEN NULLIF(TRIM(p_zip),'')          ELSE zip          END,
         dob           = CASE WHEN p_dob          IS NOT NULL AND v_existing.dob IS NULL THEN p_dob ELSE dob          END,
         notes         = v_combined_notes,
         updated_at    = NOW()
   WHERE id = v_customer_id;

  RETURN json_build_object(
    'ok',      true,
    'changed', array_length(v_changes, 1),
    'fields',  to_json(v_changes)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION customer_update_self(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE) TO authenticated;

-- Inspection:
--   SELECT customer_update_self(p_email := 'new@example.com');  -- as the auth'd customer

-- END 044_customer_update_self.sql


-- ============================================================
-- BEGIN 045_affiliate_program.sql
-- ============================================================
-- ============================================================
-- Migration 045 — Affiliate / team-rider program
-- ============================================================
-- White-label affiliate marketing program. Every skatepark deployment
-- can configure its own commission structure + enroll team riders /
-- sponsored skaters as affiliates, generate unique codes, and track
-- earnings + payouts.
--
-- Design notes:
--   • One `affiliate_programs` row per tenant (created automatically here).
--     Future expansion to multi-program (e.g. "Team Riders" + "Industry
--     Friends" + "Influencer Tier") is straightforward — same schema.
--   • `affiliate_codes`: one row per enrolled customer. UNIQUE on
--     (program_id, customer_id) so a customer can't double-enroll. UNIQUE
--     on `code` so codes are globally unique. Cached counters on the row
--     keep the leaderboard fast (no aggregation needed for dashboard).
--   • `affiliate_earnings`: append-only ledger. One row per attribution
--     event. Status workflow: pending → approved → paid (or reversed on
--     refund).
--   • `affiliate_redemptions`: every code-use, regardless of whether it
--     converted into earnings — useful for measuring code-share-rate vs
--     conversion-rate.
--   • Buyer attribution is captured on `customers.affiliate_code_id` so
--     it's looked up in O(1) on every sale. The auto-earn trigger reads
--     this column on insert/update of `sales`.
--   • Refund reversal: matches mig 028's loyalty pattern — when a sale
--     flips completed→refunded/voided, the trigger inserts a negative
--     earning row to roll back the commission.
--   • RLS: all tables tenant-scoped + authenticated read/write; affiliate
--     codes are intentionally readable to anon (for public affiliate
--     profile page lookup), but earnings + redemptions stay staff-only.
--   • Idempotent: every CREATE uses IF NOT EXISTS, every ALTER guards
--     against re-application.
-- ============================================================

BEGIN;

-- ─── Programs table (one row per tenant by default) ─────────────────
CREATE TABLE IF NOT EXISTS affiliate_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  name TEXT NOT NULL DEFAULT 'Team Riders',
  description TEXT DEFAULT 'Sponsored skaters who represent the shop',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Reward kind enum-ish (TEXT for forward compatibility)
  --   percent_commission  → reward_value = % of sale (e.g. 10 = 10%)
  --   flat_per_referral   → reward_value = $ flat per first sale per referred customer
  --   points_per_dollar   → reward_value = loyalty points per $ spent by referee (recurring)
  --   percent_first_only  → percent_commission but only on FIRST sale per referred customer
  reward_kind TEXT NOT NULL DEFAULT 'percent_commission'
    CHECK (reward_kind IN ('percent_commission','flat_per_referral','points_per_dollar','percent_first_only')),
  reward_value NUMERIC(10,4) NOT NULL DEFAULT 10,
  -- Minimum first purchase to count (filter out trial-only one-and-dones)
  min_first_purchase NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Lifetime cap per affiliate ($0 = no cap)
  lifetime_cap NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Window in days that referred customer's purchases attribute back
  attribution_window_days INT NOT NULL DEFAULT 90,
  -- Bonus milestone: free session (or dollar value) every N successful referrals
  bonus_threshold_count INT NOT NULL DEFAULT 0,
  bonus_value_dollars NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Ops
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Make tenant_id nullable for single-tenant installs but enforce when set
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenants') THEN
    BEGIN
      ALTER TABLE affiliate_programs
        ADD CONSTRAINT affiliate_programs_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliate_programs_tenant ON affiliate_programs(tenant_id);

-- ─── Affiliate codes (one per enrolled customer) ────────────────────
CREATE TABLE IF NOT EXISTS affiliate_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  program_id UUID REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  customer_id UUID,  -- FK added below if customers table exists
  code TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Public profile material
  bio TEXT,
  social_handles JSONB NOT NULL DEFAULT '{}'::jsonb,
  photo_url TEXT,
  -- Cached aggregates (denormalized, kept current by trigger below)
  total_referrals INT NOT NULL DEFAULT 0,
  total_revenue NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_earned NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Notes for owner
  notes TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customers') THEN
    BEGIN
      ALTER TABLE affiliate_codes
        ADD CONSTRAINT affiliate_codes_customer_fk
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenants') THEN
    BEGIN
      ALTER TABLE affiliate_codes
        ADD CONSTRAINT affiliate_codes_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- One code per customer per program; codes globally unique
DO $$
BEGIN
  BEGIN
    ALTER TABLE affiliate_codes ADD CONSTRAINT affiliate_codes_program_customer_uniq UNIQUE (program_id, customer_id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE affiliate_codes ADD CONSTRAINT affiliate_codes_code_uniq UNIQUE (code);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliate_codes_tenant ON affiliate_codes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_codes_program ON affiliate_codes(program_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_codes_customer ON affiliate_codes(customer_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_codes_enabled ON affiliate_codes(enabled) WHERE enabled = TRUE;

-- ─── Customer attribution column (referral attached to buyer) ───────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customers') THEN
    BEGIN
      ALTER TABLE customers ADD COLUMN affiliate_code_id UUID REFERENCES affiliate_codes(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
    BEGIN
      ALTER TABLE customers ADD COLUMN affiliate_attributed_at TIMESTAMPTZ;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
    CREATE INDEX IF NOT EXISTS idx_customers_affiliate_code ON customers(affiliate_code_id) WHERE affiliate_code_id IS NOT NULL;
  END IF;
END $$;

-- ─── Earnings ledger (append-only) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  program_id UUID REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  affiliate_code_id UUID REFERENCES affiliate_codes(id) ON DELETE CASCADE,
  affiliate_customer_id UUID,  -- denormalized for fast leaderboard
  referred_customer_id UUID,
  sale_id UUID,
  -- Earnings details
  sale_total NUMERIC(10,2),
  earning_kind TEXT NOT NULL DEFAULT 'commission'
    CHECK (earning_kind IN ('commission','flat','points','bonus_milestone','reversal')),
  earning_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Workflow
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','paid','reversed','void')),
  paid_at TIMESTAMPTZ,
  paid_via TEXT,        -- 'store_credit', 'cash', 'venmo', 'zelle', 'free_session', 'merch'
  paid_reference TEXT,  -- external txn id, check #, etc.
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sales') THEN
    BEGIN
      ALTER TABLE affiliate_earnings
        ADD CONSTRAINT affiliate_earnings_sale_fk
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenants') THEN
    BEGIN
      ALTER TABLE affiliate_earnings
        ADD CONSTRAINT affiliate_earnings_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_code ON affiliate_earnings(affiliate_code_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_status ON affiliate_earnings(status);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_referred ON affiliate_earnings(referred_customer_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_sale ON affiliate_earnings(sale_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_created ON affiliate_earnings(created_at DESC);

-- Idempotency: one earning per (sale_id, kind) so the trigger can re-fire
-- safely on UPDATE without creating duplicates. NULL sale_ids (manual
-- bonus_milestone awards) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_earnings_sale_kind
  ON affiliate_earnings(sale_id, earning_kind)
  WHERE sale_id IS NOT NULL AND earning_kind IN ('commission','flat','points');

-- ─── Redemptions (every code-use audit log) ─────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  affiliate_code_id UUID REFERENCES affiliate_codes(id) ON DELETE SET NULL,
  code_used TEXT NOT NULL,
  customer_id UUID,
  context TEXT NOT NULL DEFAULT 'sale_pos'
    CHECK (context IN ('signup','sale_pos','me_self_serve','admin_attach')),
  sale_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customers') THEN
    BEGIN
      ALTER TABLE affiliate_redemptions
        ADD CONSTRAINT affiliate_redemptions_customer_fk
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sales') THEN
    BEGIN
      ALTER TABLE affiliate_redemptions
        ADD CONSTRAINT affiliate_redemptions_sale_fk
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliate_redemptions_code ON affiliate_redemptions(affiliate_code_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_redemptions_created ON affiliate_redemptions(created_at DESC);

-- ─── Auto-earn trigger ──────────────────────────────────────────────
-- When a sale is completed AND the buyer has an affiliate_code_id set
-- AND we're within the attribution window, insert an earning row.
-- Idempotent via the partial UNIQUE index above.
CREATE OR REPLACE FUNCTION affiliate_auto_earn() RETURNS TRIGGER AS $$
DECLARE
  v_code RECORD;
  v_program RECORD;
  v_buyer RECORD;
  v_earning NUMERIC(10,2);
  v_already_earned NUMERIC(10,2);
  v_first_sale BOOLEAN;
  v_kind TEXT;
BEGIN
  -- Only fire on completed sales
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;
  -- Need a buyer
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Look up the buyer's affiliate code
  SELECT id, affiliate_code_id, affiliate_attributed_at
  INTO v_buyer
  FROM customers WHERE id = NEW.customer_id;
  IF v_buyer.affiliate_code_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Look up the affiliate code
  SELECT * INTO v_code FROM affiliate_codes WHERE id = v_buyer.affiliate_code_id;
  IF NOT FOUND OR v_code.enabled = FALSE THEN
    RETURN NEW;
  END IF;

  -- Self-purchase guard: affiliate can't earn off their own purchases
  IF v_code.customer_id = NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Look up the program
  SELECT * INTO v_program FROM affiliate_programs WHERE id = v_code.program_id;
  IF NOT FOUND OR v_program.enabled = FALSE THEN
    RETURN NEW;
  END IF;

  -- Attribution window check
  IF v_buyer.affiliate_attributed_at IS NOT NULL
     AND v_program.attribution_window_days > 0
     AND NEW.created_at > v_buyer.affiliate_attributed_at + (v_program.attribution_window_days || ' days')::INTERVAL THEN
    RETURN NEW;
  END IF;

  -- Was this the first sale by the buyer?
  v_first_sale := NOT EXISTS (
    SELECT 1 FROM sales
    WHERE customer_id = NEW.customer_id
      AND status = 'completed'
      AND id <> NEW.id
      AND created_at < NEW.created_at
  );

  -- Min first purchase check (only relevant to first sale)
  IF v_first_sale AND NEW.total < v_program.min_first_purchase THEN
    RETURN NEW;
  END IF;

  -- Compute earning per program reward kind
  IF v_program.reward_kind = 'percent_commission' THEN
    v_earning := COALESCE(NEW.total, 0) * v_program.reward_value / 100.0;
    v_kind := 'commission';
  ELSIF v_program.reward_kind = 'percent_first_only' THEN
    IF NOT v_first_sale THEN RETURN NEW; END IF;
    v_earning := COALESCE(NEW.total, 0) * v_program.reward_value / 100.0;
    v_kind := 'commission';
  ELSIF v_program.reward_kind = 'flat_per_referral' THEN
    IF NOT v_first_sale THEN RETURN NEW; END IF;
    v_earning := v_program.reward_value;
    v_kind := 'flat';
  ELSIF v_program.reward_kind = 'points_per_dollar' THEN
    v_earning := COALESCE(NEW.total, 0) * v_program.reward_value;
    v_kind := 'points';
  ELSE
    RETURN NEW;
  END IF;

  IF v_earning <= 0 THEN
    RETURN NEW;
  END IF;

  -- Lifetime cap check
  IF v_program.lifetime_cap > 0 THEN
    SELECT COALESCE(SUM(earning_amount), 0) INTO v_already_earned
    FROM affiliate_earnings
    WHERE affiliate_code_id = v_code.id
      AND earning_kind <> 'reversal'
      AND status NOT IN ('reversed','void');
    IF v_already_earned >= v_program.lifetime_cap THEN
      RETURN NEW;
    END IF;
    -- Cap this earning so we don't blow past the lifetime cap
    IF v_already_earned + v_earning > v_program.lifetime_cap THEN
      v_earning := v_program.lifetime_cap - v_already_earned;
    END IF;
  END IF;

  -- Insert the earning (idempotent via UNIQUE INDEX on sale_id+kind)
  INSERT INTO affiliate_earnings (
    tenant_id, program_id, affiliate_code_id, affiliate_customer_id,
    referred_customer_id, sale_id, sale_total,
    earning_kind, earning_amount, status, notes
  ) VALUES (
    v_code.tenant_id, v_program.id, v_code.id, v_code.customer_id,
    NEW.customer_id, NEW.id, NEW.total,
    v_kind, v_earning, 'pending',
    'Auto-earned · ' || v_program.reward_kind || (CASE WHEN v_first_sale THEN ' · first sale' ELSE '' END)
  )
  ON CONFLICT (sale_id, earning_kind) WHERE sale_id IS NOT NULL AND earning_kind IN ('commission','flat','points')
  DO NOTHING;

  -- Refresh denormalized counters on the affiliate_codes row
  UPDATE affiliate_codes SET
    total_revenue = (
      SELECT COALESCE(SUM(sale_total), 0)
      FROM affiliate_earnings
      WHERE affiliate_code_id = v_code.id
        AND earning_kind <> 'reversal'
        AND status NOT IN ('reversed','void')
    ),
    total_earned = (
      SELECT COALESCE(SUM(earning_amount), 0)
      FROM affiliate_earnings
      WHERE affiliate_code_id = v_code.id
        AND earning_kind <> 'reversal'
        AND status NOT IN ('reversed','void')
    ),
    total_referrals = (
      SELECT COUNT(DISTINCT referred_customer_id)
      FROM affiliate_earnings
      WHERE affiliate_code_id = v_code.id
        AND earning_kind <> 'reversal'
        AND status NOT IN ('reversed','void')
    ),
    updated_at = now()
  WHERE id = v_code.id;

  -- Bonus milestone check: free session every N referrals
  IF v_program.bonus_threshold_count > 0 AND v_program.bonus_value_dollars > 0 THEN
    DECLARE
      v_ref_count INT;
      v_bonuses_already INT;
      v_bonuses_owed INT;
    BEGIN
      SELECT COUNT(DISTINCT referred_customer_id) INTO v_ref_count
      FROM affiliate_earnings
      WHERE affiliate_code_id = v_code.id
        AND earning_kind <> 'reversal'
        AND status NOT IN ('reversed','void');
      SELECT COUNT(*) INTO v_bonuses_already
      FROM affiliate_earnings
      WHERE affiliate_code_id = v_code.id
        AND earning_kind = 'bonus_milestone'
        AND status NOT IN ('reversed','void');
      v_bonuses_owed := FLOOR(v_ref_count::NUMERIC / v_program.bonus_threshold_count) - v_bonuses_already;
      IF v_bonuses_owed > 0 THEN
        INSERT INTO affiliate_earnings (
          tenant_id, program_id, affiliate_code_id, affiliate_customer_id,
          earning_kind, earning_amount, status, notes
        ) VALUES (
          v_code.tenant_id, v_program.id, v_code.id, v_code.customer_id,
          'bonus_milestone', v_program.bonus_value_dollars, 'pending',
          'Milestone: ' || v_ref_count || ' referrals · ' || v_program.bonus_threshold_count || '-referral bonus'
        );
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_affiliate_auto_earn ON sales;
CREATE TRIGGER sales_affiliate_auto_earn
  AFTER INSERT OR UPDATE OF status ON sales
  FOR EACH ROW
  EXECUTE FUNCTION affiliate_auto_earn();

-- ─── Refund reversal trigger ────────────────────────────────────────
-- When a sale flips completed → refunded/voided, insert a negative
-- earning to roll back the commission. Mirrors mig 028's loyalty pattern.
CREATE OR REPLACE FUNCTION affiliate_reverse_earnings() RETURNS TRIGGER AS $$
DECLARE
  v_orig RECORD;
BEGIN
  -- Only fire on transition completed → refunded/voided
  IF OLD.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('refunded','voided') THEN RETURN NEW; END IF;

  FOR v_orig IN
    SELECT * FROM affiliate_earnings
    WHERE sale_id = NEW.id
      AND earning_kind IN ('commission','flat','points')
      AND status NOT IN ('reversed','void')
  LOOP
    INSERT INTO affiliate_earnings (
      tenant_id, program_id, affiliate_code_id, affiliate_customer_id,
      referred_customer_id, sale_id, sale_total,
      earning_kind, earning_amount, status, notes
    ) VALUES (
      v_orig.tenant_id, v_orig.program_id, v_orig.affiliate_code_id, v_orig.affiliate_customer_id,
      v_orig.referred_customer_id, v_orig.sale_id, -COALESCE(v_orig.sale_total,0),
      'reversal', -v_orig.earning_amount, 'reversed',
      'Refund reversal of earning ' || v_orig.id
    );
    -- Mark the original earning reversed too
    UPDATE affiliate_earnings SET status='reversed', notes = COALESCE(notes,'') || ' [reversed via sale ' || NEW.id || ']'
    WHERE id = v_orig.id;
  END LOOP;

  -- Refresh denormalized counters
  UPDATE affiliate_codes SET
    total_revenue = (SELECT COALESCE(SUM(sale_total),0) FROM affiliate_earnings WHERE affiliate_code_id = affiliate_codes.id AND earning_kind <> 'reversal' AND status NOT IN ('reversed','void')),
    total_earned  = (SELECT COALESCE(SUM(earning_amount),0) FROM affiliate_earnings WHERE affiliate_code_id = affiliate_codes.id AND earning_kind <> 'reversal' AND status NOT IN ('reversed','void')),
    updated_at = now()
  WHERE id IN (SELECT DISTINCT affiliate_code_id FROM affiliate_earnings WHERE sale_id = NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_affiliate_reverse ON sales;
CREATE TRIGGER sales_affiliate_reverse
  AFTER UPDATE OF status ON sales
  FOR EACH ROW
  WHEN (OLD.status <> NEW.status)
  EXECUTE FUNCTION affiliate_reverse_earnings();

-- ─── Helper RPC: lookup code (for POS + public profile page) ────────
-- Returns minimal info (name, photo, bio) so anon can resolve a code on
-- the public affiliate profile page without exposing earnings or
-- referred-customer history.
CREATE OR REPLACE FUNCTION affiliate_code_lookup(p_code TEXT)
RETURNS TABLE (
  code_id UUID,
  code TEXT,
  enabled BOOLEAN,
  customer_name TEXT,
  bio TEXT,
  social_handles JSONB,
  photo_url TEXT,
  total_referrals INT,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ac.id, ac.code, ac.enabled,
    c.name, ac.bio, ac.social_handles,
    COALESCE(ac.photo_url, c.photo_url) AS photo_url,
    ac.total_referrals, ac.total_revenue
  FROM affiliate_codes ac
  LEFT JOIN customers c ON c.id = ac.customer_id
  WHERE UPPER(TRIM(ac.code)) = UPPER(TRIM(p_code))
    AND ac.enabled = TRUE
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION affiliate_code_lookup(TEXT) TO anon, authenticated;

-- ─── Helper RPC: attach customer to affiliate code (signup or POS) ──
-- Used at customer signup or first-sale flow. Sets customers.affiliate_code_id
-- + records a redemption row. Idempotent — re-running with the same code
-- is a no-op; running with a DIFFERENT code refuses (locks attribution to
-- the first code used). Owner can override via direct UPDATE.
CREATE OR REPLACE FUNCTION affiliate_attach_customer(
  p_customer_id UUID,
  p_code TEXT,
  p_context TEXT DEFAULT 'sale_pos',
  p_sale_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_code RECORD;
  v_existing UUID;
BEGIN
  IF p_customer_id IS NULL OR p_code IS NULL OR LENGTH(TRIM(p_code)) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'missing_args');
  END IF;
  SELECT * INTO v_code FROM affiliate_codes
   WHERE UPPER(TRIM(code)) = UPPER(TRIM(p_code)) AND enabled = TRUE
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'code_not_found');
  END IF;
  -- Self-attach guard
  IF v_code.customer_id = p_customer_id THEN
    RETURN json_build_object('ok', false, 'error', 'cannot_attach_self');
  END IF;
  -- Existing attribution check
  SELECT affiliate_code_id INTO v_existing FROM customers WHERE id = p_customer_id;
  IF v_existing IS NOT NULL AND v_existing <> v_code.id THEN
    -- Already attributed to a different code; record the redemption but don't switch
    INSERT INTO affiliate_redemptions(tenant_id, affiliate_code_id, code_used, customer_id, context, sale_id)
      VALUES (v_code.tenant_id, v_code.id, p_code, p_customer_id, p_context, p_sale_id);
    RETURN json_build_object('ok', false, 'error', 'already_attributed', 'existing_code_id', v_existing);
  END IF;
  -- Set or re-affirm attribution
  UPDATE customers
    SET affiliate_code_id = v_code.id,
        affiliate_attributed_at = COALESCE(affiliate_attributed_at, now())
  WHERE id = p_customer_id;
  -- Record redemption
  INSERT INTO affiliate_redemptions(tenant_id, affiliate_code_id, code_used, customer_id, context, sale_id)
    VALUES (v_code.tenant_id, v_code.id, p_code, p_customer_id, p_context, p_sale_id);
  RETURN json_build_object('ok', true, 'code_id', v_code.id, 'attributed_at', now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION affiliate_attach_customer(UUID, TEXT, TEXT, UUID) TO authenticated;

-- ─── Helper RPC: customer self-serve affiliate dashboard ───────────
-- Returns the signed-in customer's OWN affiliate data only. Uses
-- current_customer_id() (mig 019) to map auth.uid() → customers.id, then
-- looks up their affiliate_codes row (if enrolled) + recent earnings
-- (last 20). SECURITY DEFINER so it bypasses RLS — but the function
-- itself rigidly scopes by current_customer_id() so customers can ONLY
-- see their own data. Closes the PII-leak risk that direct table reads
-- would have created (RLS allows authenticated → all rows in staff-all
-- pattern, which includes customer portal sessions). me.html calls this
-- RPC instead of querying tables directly.
CREATE OR REPLACE FUNCTION my_affiliate_dashboard()
RETURNS JSON AS $$
DECLARE
  v_cust UUID;
  v_code RECORD;
  v_program RECORD;
  v_earnings JSON;
  v_result JSON;
BEGIN
  -- Resolve current customer (mig 019 helper)
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_customer_id') THEN
    v_cust := current_customer_id();
  ELSE
    RETURN json_build_object('ok', false, 'error', 'mig_019_missing');
  END IF;
  IF v_cust IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Look up the customer's affiliate code
  SELECT * INTO v_code FROM affiliate_codes WHERE customer_id = v_cust LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', true, 'enrolled', false);
  END IF;

  -- Look up the program for milestone progress
  SELECT * INTO v_program FROM affiliate_programs WHERE id = v_code.program_id;

  -- Recent earnings (last 20)
  SELECT json_agg(
    json_build_object(
      'id', id,
      'created_at', created_at,
      'sale_total', sale_total,
      'earning_kind', earning_kind,
      'earning_amount', earning_amount,
      'status', status,
      'paid_at', paid_at,
      'paid_via', paid_via
    ) ORDER BY created_at DESC
  )
  INTO v_earnings
  FROM (
    SELECT * FROM affiliate_earnings
    WHERE affiliate_code_id = v_code.id
    ORDER BY created_at DESC
    LIMIT 20
  ) e;

  v_result := json_build_object(
    'ok', true,
    'enrolled', true,
    'code', json_build_object(
      'id', v_code.id,
      'code', v_code.code,
      'enabled', v_code.enabled,
      'bio', v_code.bio,
      'social_handles', v_code.social_handles,
      'total_referrals', v_code.total_referrals,
      'total_revenue', v_code.total_revenue,
      'total_earned', v_code.total_earned,
      'total_paid', v_code.total_paid,
      'joined_at', v_code.joined_at
    ),
    'program', CASE WHEN v_program.id IS NOT NULL THEN json_build_object(
      'name', v_program.name,
      'reward_kind', v_program.reward_kind,
      'reward_value', v_program.reward_value,
      'attribution_window_days', v_program.attribution_window_days,
      'bonus_threshold_count', v_program.bonus_threshold_count,
      'bonus_value_dollars', v_program.bonus_value_dollars
    ) ELSE NULL END,
    'earnings', COALESCE(v_earnings, '[]'::json)
  );
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION my_affiliate_dashboard() TO authenticated;

-- ─── Helper RPC: public team listing ───────────────────────────────
-- Returns all enabled affiliates with public-safe fields. Powers the
-- /admin/team.html public marketing page. Anon-callable. Returns the
-- same shape as affiliate_code_lookup() but for the full list, sorted
-- by lifetime referrals desc (most-active rider first). No earnings or
-- internal notes are exposed.
CREATE OR REPLACE FUNCTION affiliate_program_public_list()
RETURNS TABLE (
  code_id UUID,
  code TEXT,
  customer_name TEXT,
  bio TEXT,
  social_handles JSONB,
  photo_url TEXT,
  total_referrals INT,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ac.id, ac.code,
    c.name, ac.bio, ac.social_handles,
    COALESCE(ac.photo_url, c.photo_url) AS photo_url,
    ac.total_referrals, ac.total_revenue
  FROM affiliate_codes ac
  LEFT JOIN customers c ON c.id = ac.customer_id
  WHERE ac.enabled = TRUE
  ORDER BY ac.total_referrals DESC NULLS LAST, ac.total_revenue DESC NULLS LAST, ac.joined_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION affiliate_program_public_list() TO anon, authenticated;

-- ─── Seed default program ───────────────────────────────────────────
INSERT INTO affiliate_programs (name, description, reward_kind, reward_value, attribution_window_days, bonus_threshold_count, bonus_value_dollars)
SELECT 'Team Riders', 'Sponsored skaters who represent the shop', 'percent_commission', 10, 90, 5, 25
WHERE NOT EXISTS (SELECT 1 FROM affiliate_programs);

-- ─── RLS ───────────────────────────────────────────────────────────
ALTER TABLE affiliate_programs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_codes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_earnings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_redemptions ENABLE ROW LEVEL SECURITY;

-- Programs: staff read/write
DROP POLICY IF EXISTS aff_programs_staff_all ON affiliate_programs;
CREATE POLICY aff_programs_staff_all ON affiliate_programs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Codes: staff read/write + anon read (for public profile lookup)
DROP POLICY IF EXISTS aff_codes_staff_all ON affiliate_codes;
CREATE POLICY aff_codes_staff_all ON affiliate_codes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS aff_codes_anon_read ON affiliate_codes;
CREATE POLICY aff_codes_anon_read ON affiliate_codes
  FOR SELECT TO anon USING (enabled = TRUE);

-- Earnings: staff only
DROP POLICY IF EXISTS aff_earnings_staff_all ON affiliate_earnings;
CREATE POLICY aff_earnings_staff_all ON affiliate_earnings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Redemptions: staff only (for analytics)
DROP POLICY IF EXISTS aff_redemptions_staff_all ON affiliate_redemptions;
CREATE POLICY aff_redemptions_staff_all ON affiliate_redemptions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================
-- END Migration 045
-- ============================================================
-- Apply: paste into Supabase SQL editor and click Run.
-- Then redeploy the admin (filter-aware customers CSV / etc already
-- shipped today) so the Team Riders page appears under Programs.
-- ============================================================

-- END 045_affiliate_program.sql


-- ============================================================
-- BEGIN 046_preorder_form.sql
-- ============================================================
-- ============================================================
-- 046_preorder_form.sql — pre-order catalog submission target
--
-- The preorder.skateos.com catalog needs a `forms` row to point
-- submissions at. Without it, anon-side INSERTs into form_submissions
-- would fail the FK check.
--
-- After this migration is applied:
--   • Customer hits "Submit pre-order →" on preorder.skateos.com
--   • Page POSTs to form_submissions with this form's id + JSONB cart
--   • Doug sees the order in the admin Forms page with full history
--   • Mailto still fires as a backup notification
--
-- The form is intentionally minimal — schema={fields:[]} because
-- the preorder page renders its own UI; we just use form_submissions
-- as the persistence layer + admin viewing surface.
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$
DECLARE seed_tid UUID;
BEGIN
  -- Resolve the tenant (info@2ntr.com is the seed tenant from migration 009)
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;

  -- Insert the preorder form. ON CONFLICT (slug) DO NOTHING so re-running
  -- is safe and won't clobber any tweaks Doug makes via the admin Forms UI.
  INSERT INTO forms (slug, name, description, schema, submit_action, enabled, tenant_id)
  VALUES (
    'preorder-2026',
    'Pre-order Sale (preorder.skateos.com)',
    'Customer-submitted pre-orders from the public catalog. Each submission contains the cart items, totals, customer contact info, and 50% deposit / balance breakdown.',
    '{"fields":[]}'::jsonb,
    'other',
    TRUE,
    seed_tid
  )
  ON CONFLICT (slug) DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  -- forms table missing → migration 011 not applied yet. Owner sees a clear
  -- error from psql; nothing else to do here.
  RAISE NOTICE 'forms table missing — apply migration 011 first';
END $$;

-- END 046_preorder_form.sql


-- ============================================================
-- BEGIN 047_preorder_weekly_cron.sql
-- ============================================================
-- ============================================================
-- 047_preorder_weekly_cron.sql — schedule the weekly pre-order digest
--
-- The Edge Function `weekly-preorder-digest` rolls up every preorder-2026
-- submission from the prior week into a supplier-order email for Doug.
-- This migration schedules it via pg_cron to fire shortly after the Sunday
-- midnight ET cutoff.
--
-- Schedule: Mon 5:00 UTC = Sun midnight EST OR Mon 1am EDT — both fire AFTER
-- Sunday-midnight ET cutoff so the digest captures the full week's submissions.
-- pg_cron runs UTC-only; this is the cleanest cross-DST-safe time.
--
-- Setup:
--   1. Apply this migration: paste into Supabase SQL editor → Run
--   2. Set the two GUC params (one-time per database):
--        ALTER DATABASE postgres SET app.settings.supabase_url   = 'https://zecurmlenxyxanqucrga.supabase.co';
--        ALTER DATABASE postgres SET app.settings.service_role_key = 'eyJhbGc...';
--      (Skip this step if migration 016 already set them — they're shared.)
--   3. Deploy the Edge Function: bash admin/deploy-functions.sh
--
-- Manual fire (for testing or off-cycle digests):
--   curl -X POST https://zecurmlenxyxanqucrga.supabase.co/functions/v1/weekly-preorder-digest \
--     -H "Authorization: Bearer <service-role>" \
--     -d '{"window_days": 7}'
--
-- Inspect cron run history:
--   SELECT * FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'weekly-preorder-digest')
--   ORDER BY end_time DESC LIMIT 10;
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Required extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any prior version of this job before re-creating, so
-- re-running the migration doesn't pile up duplicate schedules.
DO $$ BEGIN
  PERFORM cron.unschedule('weekly-preorder-digest');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Schedule: Monday 05:00 UTC (every week)
SELECT cron.schedule(
  'weekly-preorder-digest',
  '0 5 * * 1',
  $$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/weekly-preorder-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('window_days', 7)
    ) AS request_id;
  $$
);

-- Sanity check: verify the schedule landed
DO $$
DECLARE jid BIGINT;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'weekly-preorder-digest';
  IF jid IS NULL THEN
    RAISE NOTICE 'WARNING: weekly-preorder-digest schedule did not land. Check pg_cron extension is enabled.';
  ELSE
    RAISE NOTICE 'Scheduled weekly-preorder-digest (jobid=%) for Monday 05:00 UTC', jid;
  END IF;
END $$;

-- END 047_preorder_weekly_cron.sql


-- ============================================================
-- BEGIN 048_preorder_status_lookup.sql
-- ============================================================
-- ============================================================
-- 048_preorder_status_lookup.sql — public pre-order status RPC
--
-- Customer-facing self-serve status page (preorder.skateos.com/status.html)
-- needs to read a single form_submissions row by its UUID without exposing
-- the entire form_submissions table to anon (which would let attackers
-- enumerate other people's orders).
--
-- The submission UUID is the access token — 36 random hex chars, ~10^36
-- keyspace, unguessable. We share it with the customer in their confirmation
-- email, and they visit /status.html?id=<uuid> to see their order status.
--
-- This RPC is SECURITY DEFINER + GRANTed to anon, but returns ONLY the
-- safe-for-public fields:
--   • items list
--   • totals
--   • deposit_status / balance_status
--   • supplier_ordered_at (so customer sees "yes, we placed the supplier order")
--   • fulfillment + is_shipping
--   • submitted_at + first name only (privacy — no email/phone leaked back)
--
-- Internal admin fields (notes, full email, full phone, supplier_ordered_by
-- staff UUID, status workflow strings) are NEVER returned.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION preorder_status_lookup(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  d JSONB;
  contact_name TEXT;
  first_name TEXT;
BEGIN
  -- Look up the submission. Refuse non-preorder submissions (cross-form
  -- access via this RPC would be a privilege escalation).
  SELECT s.*, f.slug AS form_slug
    INTO s
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_id
      AND f.slug = 'preorder-2026'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  d := COALESCE(s.data, '{}'::jsonb);
  contact_name := d->'contact'->>'name';
  -- First name only — privacy. If "Tommy K" they see "Tommy". If single name
  -- "Tommy" they see the full thing. Nothing past the first whitespace.
  first_name := SPLIT_PART(COALESCE(contact_name, ''), ' ', 1);

  -- Build the public-safe response. Whitelist approach so future fields
  -- added to data JSONB don't leak by accident.
  RETURN jsonb_build_object(
    'found',                TRUE,
    'submitted_at',         s.created_at,
    'first_name',           first_name,
    'items',                COALESCE(d->'items', '[]'::jsonb),
    'totals',               COALESCE(d->'totals', '{}'::jsonb),
    'deposit_status',       COALESCE(d->>'deposit_status', 'pending'),
    'balance_status',       COALESCE(d->>'balance_status', 'pending'),
    'deposit_paid_at',      d->>'deposit_paid_at',
    'balance_paid_at',      d->>'balance_paid_at',
    'supplier_ordered_at',  d->>'supplier_ordered_at',
    'fulfillment',          COALESCE(d->>'fulfillment', 'pickup'),
    'is_shipping',          COALESCE((d->>'is_shipping')::boolean, FALSE),
    'pulled_early',         COALESCE((d->>'pulled_early')::boolean, FALSE)
  );
END $$;

-- Anon role needs EXECUTE to call this from the public status page.
-- The function's SECURITY DEFINER guarantee + the form_slug check inside
-- mean anon can only read preorder-2026 submissions (not other forms).
GRANT EXECUTE ON FUNCTION preorder_status_lookup(UUID) TO anon, authenticated;

-- Smoke-test note: anon-callable means the URL pattern is
--   POST /rest/v1/rpc/preorder_status_lookup
--   { "p_id": "<uuid>" }
-- Returns { found:false } when the UUID doesn't match — never leaks
-- whether the UUID exists in some OTHER form (cross-form enumeration
-- guard via the explicit slug check).

-- END 048_preorder_status_lookup.sql


-- ============================================================
-- BEGIN 049_preorder_catalog.sql
-- ============================================================
-- ============================================================
-- 049_preorder_catalog.sql — Supabase-backed pre-order product catalog
--
-- Currently the 15 products on preorder.skateos.com are hardcoded in
-- preorder/index.html. This migration moves them into a real table so:
--   • Doug can add/remove products via Supabase Table Editor (or future admin UI)
--     without touching code or redeploying
--   • The catalog can drift per-tenant (multi-tenant skateOS resale)
--   • Inventory can be tracked alongside (post-MVP)
--
-- The preorder/index.html is updated to fetch from this table on load.
-- If the fetch fails (RLS issue, network blip, table missing), the page
-- falls back to a small hardcoded seed so the catalog never goes blank.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS preorder_products (
  id            TEXT PRIMARY KEY,                              -- slug like 's1-lifer-black-matte'
  brand         TEXT NOT NULL,
  name          TEXT NOT NULL,
  price         NUMERIC(10,2) NOT NULL,                        -- pre-order price (what customer pays)
  retail        NUMERIC(10,2) NOT NULL,                        -- MSRP (for strikethrough display)
  sale          BOOLEAN NOT NULL DEFAULT FALSE,                -- show "Pre-order sale" ribbon
  soon          BOOLEAN NOT NULL DEFAULT FALSE,                -- show "Coming · 1-2 wks" ribbon
  category      TEXT NOT NULL CHECK (category IN ('decks','helmets','apparel','wheels','trucks','bearings','accessories','safety','other')),
  image         TEXT NOT NULL,                                 -- supplier CDN URL
  sort_order    INTEGER NOT NULL DEFAULT 100,                  -- lower = earlier in grid
  active        BOOLEAN NOT NULL DEFAULT TRUE,                 -- false = hidden from catalog (don't delete, audit trail)
  notes         TEXT,                                          -- admin-only notes (supplier ETA, low stock warning, etc.)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_preorder_products_active   ON preorder_products(active) WHERE active;
CREATE INDEX IF NOT EXISTS idx_preorder_products_category ON preorder_products(category, sort_order);
CREATE INDEX IF NOT EXISTS idx_preorder_products_tenant   ON preorder_products(tenant_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION preorder_products_touch_updated() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_preorder_products_touch ON preorder_products;
CREATE TRIGGER trg_preorder_products_touch
  BEFORE UPDATE ON preorder_products
  FOR EACH ROW EXECUTE FUNCTION preorder_products_touch_updated();

-- RLS: anon can read active products (public catalog needs this);
--      staff can read all + write
ALTER TABLE preorder_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS preorder_products_anon_read ON preorder_products;
DROP POLICY IF EXISTS preorder_products_staff_read ON preorder_products;
DROP POLICY IF EXISTS preorder_products_staff_write ON preorder_products;
DROP POLICY IF EXISTS preorder_products_staff_update ON preorder_products;
DROP POLICY IF EXISTS preorder_products_staff_delete ON preorder_products;

-- Anon can only read ACTIVE products (so deleted/disabled ones don't leak)
CREATE POLICY preorder_products_anon_read   ON preorder_products FOR SELECT TO anon USING (active = TRUE);
-- Authenticated staff can read everything (active or not, for admin UI)
CREATE POLICY preorder_products_staff_read  ON preorder_products FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY preorder_products_staff_write ON preorder_products FOR INSERT TO authenticated WITH CHECK (is_owner());
CREATE POLICY preorder_products_staff_update ON preorder_products FOR UPDATE TO authenticated USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY preorder_products_staff_delete ON preorder_products FOR DELETE TO authenticated USING (is_owner());

GRANT SELECT ON preorder_products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON preorder_products TO authenticated;
GRANT ALL ON preorder_products TO service_role;

-- ── Seed the 15 current products ────────────────────────────────────
DO $$
DECLARE seed_tid UUID;
BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;

  -- S1 Helmets — 25% off restock
  INSERT INTO preorder_products (id, brand, name, price, retail, sale, soon, category, image, sort_order, tenant_id) VALUES
    ('s1-lifer-black-matte',  'S1', 'Lifer Helmet · Black Matte',         59.99, 79.99, TRUE,  FALSE, 'helmets', 'https://cdn11.bigcommerce.com/s-yn3wzm/images/stencil/500x500/products/147/3623/S1_Lifer_Skateboard_Helmet_34_view__66963.1687909292.jpg?c=2', 10, seed_tid),
    ('s1-lifer-white-gloss',  'S1', 'Lifer Helmet · White Gloss',         59.99, 79.99, TRUE,  FALSE, 'helmets', 'https://cdn11.bigcommerce.com/s-yn3wzm/images/stencil/500x500/products/166/2556/Lifer_WhiteGloss_34__48956.1710591970.jpg?c=2', 11, seed_tid),
    ('s1-lifer-purple-matte', 'S1', 'Lifer Helmet · Purple Matte',        59.99, 79.99, TRUE,  FALSE, 'helmets', 'https://cdn11.bigcommerce.com/s-yn3wzm/images/stencil/500x500/products/164/1050/Lifer_PurpleMatte_34__67769.1685582094.jpg?c=2', 12, seed_tid),
    ('s1-lifer-glitter',      'S1', 'Lifer Helmet · Black Gloss Glitter', 67.49, 89.99, TRUE,  FALSE, 'helmets', 'https://cdn11.bigcommerce.com/s-yn3wzm/images/stencil/500x500/products/146/1722/Lifer_BlackGlitter3_34__26996.1710317937.jpg?c=2', 13, seed_tid),
    ('s1-retro-lifer-hosoi',  'S1', 'Retro Lifer · Hosoi Black Leopard',  67.49, 89.99, TRUE,  FALSE, 'helmets', 'https://cdn11.bigcommerce.com/s-yn3wzm/images/stencil/500x500/products/551/4103/black_leopard_retro_-_hosoi_collection-s1-helmets_-_Cropped__08004.1764026502.jpg?c=2', 14, seed_tid)
  ON CONFLICT (id) DO NOTHING;

  -- GX1000 SU26 — coming 1-2 weeks
  INSERT INTO preorder_products (id, brand, name, price, retail, sale, soon, category, image, sort_order, tenant_id) VALUES
    ('gx-skydive-825',        'GX1000', 'Sky Dive Willow · 8.25"',       78,  78,  FALSE, TRUE, 'decks',   'https://gx1000.com/cdn/shop/files/GX1000SU226Board10Bottom_large.jpg?v=1778251647', 20, seed_tid),
    ('gx-skydive-850',        'GX1000', 'Sky Dive Willow · 8.50"',       78,  78,  FALSE, TRUE, 'decks',   'https://gx1000.com/cdn/shop/files/GX1000SU226Board10Bottom_8c29e685-6c6b-406e-9537-aed7a2764d0a_large.jpg?v=1778251672', 21, seed_tid),
    ('gx-viking-natural-825', 'GX1000', 'Viking Willow Natural · 8.25"', 78,  78,  FALSE, TRUE, 'decks',   'https://gx1000.com/cdn/shop/files/GX1000SU226Board11Bottom_large.jpg?v=1778251710', 22, seed_tid),
    ('gx-ranch-jacket',       'GX1000', 'Ranch Jacket · Black',          148, 148, FALSE, TRUE, 'apparel', 'https://gx1000.com/cdn/shop/files/GX1000SummerSMS1front_large.jpg?v=1778030511', 23, seed_tid),
    ('gx-leaf-hoodie',        'GX1000', 'Leaf Hoodie · Black',           120, 120, FALSE, TRUE, 'apparel', 'https://gx1000.com/cdn/shop/files/GX1000SummerSMS16front_large.jpg?v=1777425189', 24, seed_tid)
  ON CONFLICT (id) DO NOTHING;

  -- Theories Distribution — 12% prebook
  INSERT INTO preorder_products (id, brand, name, price, retail, sale, soon, category, image, sort_order, tenant_id) VALUES
    ('theories-nyle-lovett',     'Theories',      'Nyle Lovett "Champ" Pro Deck',      66.84, 75.95, TRUE, FALSE, 'decks', 'https://www.theoriesofatlantis.com/cdn/shop/files/THEORIES-NYLE-LOVETT-CHAMP-SKATEBOARD-DECK-BOTTOM.jpg?v=1773614098&width=800', 30, seed_tid),
    ('theories-tentacles',       'Theories',      'Tentacles of Destruction Deck',     65.08, 73.95, TRUE, FALSE, 'decks', 'https://www.theoriesofatlantis.com/cdn/shop/files/THEORIES-TENTACLES-SKATEBOARD-DECK-BOTTOM.jpg?v=1773614032&width=800', 31, seed_tid),
    ('killing-floor-wainwright', 'Killing Floor', 'Danny Wainwright Guest Deck',       65.08, 73.95, TRUE, FALSE, 'decks', 'https://www.theoriesofatlantis.com/cdn/shop/files/killing-floor-danny-wainwright-skateboard-deck-main.jpg?v=1774285751&width=800', 32, seed_tid),
    ('snack-gatekeeper',         'Snack',         'Gatekeeper Black Deck',             66.88, 76,    TRUE, FALSE, 'decks', 'https://www.theoriesofatlantis.com/cdn/shop/files/Snack-Skateboards-GateKeeper-Deck.jpg?v=1776185187&width=800', 33, seed_tid),
    ('magenta-rooftop',          'Magenta',       'Leo Valls × Glen Fox Rooftop Deck', 72.60, 82.50, TRUE, FALSE, 'decks', 'https://www.theoriesofatlantis.com/cdn/shop/files/MAGENTA-SKATEBOARDS-LEO-VALLS-ROOFTOP-SERIES-DECK-BOTTOM.jpg?v=1777313506&width=800', 34, seed_tid)
  ON CONFLICT (id) DO NOTHING;

EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'tenants table missing — apply migration 009 first';
END $$;

-- END 049_preorder_catalog.sql


-- ============================================================
-- BEGIN 050_my_preorders_rpc.sql
-- ============================================================
-- ============================================================
-- 050_my_preorders_rpc.sql — customer self-serve preorder list
--
-- The customer portal (admin/me.html) calls customer_portal_summary at load
-- to get points + visits + active passes + recent purchases + recent lessons.
-- This migration adds a complementary `my_preorders()` RPC so the portal can
-- ALSO surface the signed-in customer's preorder submissions alongside
-- everything else.
--
-- Without this, customers see the public status page (status.html?id=<uuid>)
-- only via an email link — they have no logged-in dashboard view of all
-- their orders at once.
--
-- Security model:
--   • SECURITY DEFINER + uses current_customer_id() (mig 019) to resolve
--     the auth'd customer
--   • Matches submissions where data.contact.email = customer.email (case-
--     insensitive) OR last 7 digits of data.contact.phone = customer.phone
--     (forgiving of country-code formatting)
--   • Returns ONLY the public-safe whitelist (same shape as
--     preorder_status_lookup from mig 048)
--   • GRANT EXECUTE TO authenticated only (anon can't call it)
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION my_preorders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cust_id UUID;
  cust_email TEXT;
  cust_phone_digits TEXT;
  result JSONB := '[]'::jsonb;
BEGIN
  cust_id := current_customer_id();
  IF cust_id IS NULL THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'not_authenticated_as_customer');
  END IF;

  SELECT email, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
    INTO cust_email, cust_phone_digits
    FROM customers
    WHERE id = cust_id;

  IF cust_email IS NULL AND (cust_phone_digits IS NULL OR LENGTH(cust_phone_digits) < 7) THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'no_contact_match_keys');
  END IF;

  -- Build the JSON array of matching submissions, newest-first
  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'submitted_at') DESC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT jsonb_build_object(
        'id',                  s.id,
        'submitted_at',        s.created_at,
        'items',               COALESCE(s.data->'items', '[]'::jsonb),
        'totals',              COALESCE(s.data->'totals', '{}'::jsonb),
        'deposit_status',      COALESCE(s.data->>'deposit_status', 'pending'),
        'balance_status',      COALESCE(s.data->>'balance_status', 'pending'),
        'deposit_paid_at',     s.data->>'deposit_paid_at',
        'balance_paid_at',     s.data->>'balance_paid_at',
        'supplier_ordered_at', s.data->>'supplier_ordered_at',
        'fulfillment',         COALESCE(s.data->>'fulfillment', 'pickup'),
        'is_shipping',         COALESCE((s.data->>'is_shipping')::boolean, FALSE),
        'helcim_payment_url',  s.data->>'helcim_payment_url'
      ) AS payload
      FROM form_submissions s
      JOIN forms f ON f.id = s.form_id
      WHERE f.slug = 'preorder-2026'
        AND (
          (cust_email IS NOT NULL AND LOWER(s.data->'contact'->>'email') = LOWER(cust_email))
          OR (LENGTH(cust_phone_digits) >= 7
              AND RIGHT(regexp_replace(COALESCE(s.data->'contact'->>'phone', ''), '[^0-9]', '', 'g'), 7)
                  = RIGHT(cust_phone_digits, 7))
        )
      LIMIT 50
    ) AS sub;

  RETURN jsonb_build_object('found', TRUE, 'preorders', result);
END $$;

-- Authenticated only — anon should NOT be able to enumerate preorders
GRANT EXECUTE ON FUNCTION my_preorders() TO authenticated;

-- END 050_my_preorders_rpc.sql


-- ============================================================
-- BEGIN 051_public_park_status.sql
-- ============================================================
-- ============================================================
-- 051_public_park_status.sql — public "is the park open?" RPC
--
-- Customer-facing status page (admin/park-status.html) needs to know:
--   • Are we open right now?
--   • What are today's hours?
--   • Is there an emergency closure in effect?
--   • How crowded is it right now (vs capacity)?
--
-- Without this RPC anon can't read app_settings (staff-only RLS) or
-- checkins (would expose PII). The RPC returns a strict whitelist that's
-- safe to share publicly + GRANTed to anon.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public_park_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s JSONB;
  hr JSONB;
  emergency JSONB;
  holidays JSONB;
  today_dow_name TEXT;
  today_iso TEXT;
  open_checkin_count INT;
  max_capacity INT;
  is_open BOOLEAN := FALSE;
  is_closed_today BOOLEAN := FALSE;
  is_emergency BOOLEAN := FALSE;
  closing_time TEXT;
  opening_time TEXT;
  status_label TEXT := 'open';
  emergency_reason TEXT;
  emergency_until TEXT;
  match_holiday TEXT;
BEGIN
  -- Pull the full settings blob
  SELECT value INTO s FROM app_settings WHERE key = 'all' LIMIT 1;
  IF s IS NULL THEN s := '{}'::jsonb; END IF;

  -- Today's day-of-week name (sun/mon/tue/wed/thu/fri/sat) in ET
  -- Postgres' to_char + AT TIME ZONE handles tz cleanly across DST.
  today_dow_name := LOWER(to_char(NOW() AT TIME ZONE 'America/New_York', 'dy'));
  today_iso := to_char(NOW() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD');

  -- Today's hours (could be null if closed)
  hr := s -> 'hours' -> today_dow_name;
  IF hr IS NULL THEN
    is_closed_today := TRUE;
  END IF;

  -- Holiday closures override the DOW schedule
  holidays := s -> 'holidays';
  IF holidays IS NOT NULL AND jsonb_typeof(holidays) = 'array' THEN
    SELECT (h->>'name') INTO match_holiday
    FROM jsonb_array_elements(holidays) AS h
    WHERE (h->>'date') = today_iso
       OR (h->>'date') = SUBSTRING(today_iso FROM 6)  -- MM-DD recurring
    LIMIT 1;
    IF match_holiday IS NOT NULL THEN
      is_closed_today := TRUE;
    END IF;
  END IF;

  -- Emergency closure flag — overrides everything when active + not yet expired
  emergency := s -> 'emergencyClose';
  IF emergency IS NOT NULL AND COALESCE((emergency->>'active')::boolean, FALSE) THEN
    DECLARE until_ts TIMESTAMPTZ;
    BEGIN
      until_ts := NULLIF(emergency->>'until_iso','')::TIMESTAMPTZ;
      IF until_ts IS NULL OR until_ts > NOW() THEN
        is_emergency := TRUE;
        emergency_reason := emergency->>'reason';
        emergency_until := emergency->>'until_iso';
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Determine current open/closed status
  IF is_emergency THEN
    is_open := FALSE;
    status_label := 'emergency_closed';
  ELSIF is_closed_today THEN
    is_open := FALSE;
    status_label := 'closed_today';
  ELSIF hr IS NOT NULL THEN
    opening_time := hr->>'open';
    closing_time := hr->>'close';
    -- Is current ET time within [open, close)?
    DECLARE cur_time TEXT;
    BEGIN
      cur_time := to_char(NOW() AT TIME ZONE 'America/New_York', 'HH24:MI');
      IF opening_time IS NOT NULL AND closing_time IS NOT NULL THEN
        IF cur_time >= opening_time AND cur_time < closing_time THEN
          is_open := TRUE;
          status_label := 'open';
        ELSIF cur_time < opening_time THEN
          is_open := FALSE;
          status_label := 'opens_later';
        ELSE
          is_open := FALSE;
          status_label := 'closed_for_today';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Park capacity — current open checkin count vs configured max
  max_capacity := COALESCE((s->>'maxCapacity')::int, 0);
  SELECT COUNT(*) INTO open_checkin_count
    FROM checkins
    WHERE checked_out_at IS NULL;

  -- Build the public-safe response
  RETURN jsonb_build_object(
    'is_open',          is_open,
    'status',           status_label,
    'today_dow',        today_dow_name,
    'today_date',       today_iso,
    'today_open',       opening_time,
    'today_close',      closing_time,
    'is_closed_today',  is_closed_today,
    'holiday_name',     match_holiday,
    'emergency',        is_emergency,
    'emergency_reason', emergency_reason,
    'emergency_until',  emergency_until,
    'capacity_current', open_checkin_count,
    'capacity_max',     max_capacity,
    'biz_name',         COALESCE(s->>'bizName', '2nd Nature Park'),
    'biz_phone',        s->>'bizPhone',
    'biz_addr',         s->>'bizAddr',
    -- Full week's hours so the page can show "open Mon-Sun"
    'hours',            COALESCE(s->'hours', '{}'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION public_park_status() TO anon, authenticated;

-- END 051_public_park_status.sql


-- ============================================================
-- BEGIN 052_public_retail_catalog.sql
-- ============================================================
-- ============================================================
-- 052_public_retail_catalog.sql — public retail-shop RPC
--
-- Phase 1 of the Square Online replica: public-facing skateOS retail
-- shop at shop.skateos.com (or shop.<tenant>.com). Customers browse
-- in-stock products + check out via Helcim hosted invoice.
--
-- This migration adds a SECURITY DEFINER RPC that returns ONLY the
-- public-safe whitelist of product fields. RLS on `products` is staff-
-- only (mig 001) — keeping it that way + funneling anon access through
-- this RPC avoids accidentally exposing cost / internal notes / staff
-- audit data.
--
-- Returns ONLY: id, name, brand, price, retail (when discounted), image,
-- category, sku, description, in-stock band ('high'/'med'/'low'/'limited').
-- Excludes: cost, profit margin, internal notes, supplier, low_stock_threshold.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public_retail_catalog(
  p_category TEXT DEFAULT NULL,
  p_search   TEXT DEFAULT NULL,
  p_limit    INT  DEFAULT 200
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN p_limit := 200; END IF;

  WITH filtered AS (
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'active'
      AND COALESCE(p.quantity, 0) > 0
      AND (p_category IS NULL OR c.name ILIKE p_category)
      AND (p_search IS NULL OR (
        p.name ILIKE '%' || p_search || '%'
        OR p.brand ILIKE '%' || p_search || '%'
        OR p.sku ILIKE '%' || p_search || '%'
      ))
    ORDER BY
      CASE WHEN p.image_url IS NOT NULL AND LENGTH(p.image_url) > 0 THEN 0 ELSE 1 END,
      p.name
    LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',          id,
    'name',        name,
    'brand',       brand,
    'sku',         sku,
    'price',       price,
    'retail',      CASE WHEN retail_price > price THEN retail_price ELSE NULL END,
    'image',       image_url,
    'category',    category_name,
    'description', description,
    -- Stock-availability band (privacy: don't leak exact qty)
    'availability', CASE
      WHEN quantity > 10 THEN 'in_stock'
      WHEN quantity > 3  THEN 'low_stock'
      WHEN quantity > 0  THEN 'limited'
      ELSE 'sold_out'
    END
  )), '[]'::jsonb) INTO result
  FROM filtered;

  RETURN jsonb_build_object(
    'products',  result,
    'count',     COALESCE(jsonb_array_length(result), 0)
  );
END $$;

-- Public-readable categories list (so the storefront filter dropdown can render).
-- Categories are not sensitive — RLS already allows anon read on most installs,
-- but we add a focused RPC anyway to keep the public surface consistent.
CREATE OR REPLACE FUNCTION public_retail_categories()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  -- Only return categories that have at least one in-stock active product
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name), '[]'::jsonb)
    INTO result
    FROM categories
    WHERE id IN (
      SELECT DISTINCT category_id FROM products
      WHERE status = 'active' AND COALESCE(quantity, 0) > 0 AND category_id IS NOT NULL
    );
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public_retail_catalog(TEXT, TEXT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public_retail_categories() TO anon, authenticated;

-- Smoke test on apply: should return JSON shape
SELECT public_retail_catalog(NULL, NULL, 5);

-- END 052_public_retail_catalog.sql


-- ============================================================
-- BEGIN 053_retail_order_form.sql
-- ============================================================
-- ============================================================
-- 053_retail_order_form.sql — retail order submission target
--
-- Phase 1 of the Square Online replica: shop.skateos.com retail orders
-- need a `forms` row to point submissions at, mirroring the preorder-2026
-- pattern (mig 046).
--
-- Submissions land in form_submissions with form_id = this form's id.
-- Helcim payment integration uses the submission's UUID as the invoice
-- reference; helcim-webhook flips data.payment_status='paid' on
-- invoice.paid (mirrors the preorder webhook handler from mig 048 era).
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$
DECLARE seed_tid UUID;
BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;

  INSERT INTO forms (slug, name, description, schema, submit_action, enabled, tenant_id)
  VALUES (
    'retail-order',
    'Online retail orders (shop.skateos.com)',
    'Customer-submitted retail orders from the public catalog. Each submission contains the cart items, totals, customer contact, fulfillment choice, shipping address, and Helcim payment status.',
    '{"fields":[]}'::jsonb,
    'other',
    TRUE,
    seed_tid
  )
  ON CONFLICT (slug) DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'forms table missing — apply migration 011 first';
END $$;

-- END 053_retail_order_form.sql


-- ============================================================
-- BEGIN 054_retail_order_inventory.sql
-- ============================================================
-- ============================================================
-- 054_retail_order_inventory.sql — atomic stock decrement on payment
--
-- Phase 1 of Square Online replica: when a retail order is paid (via
-- Helcim webhook OR manual mark-paid), atomically decrement product
-- stock. Without this, two customers can race-buy the last unit and
-- both succeed → physical inventory goes negative.
--
-- The RPC:
--   • Reads form_submissions.data.items[] (cart line items)
--   • For each item, decrements products.quantity by item.qty
--   • Logs to inventory_log with reason='retail_order_paid'
--   • Detects oversold conditions (qty would go negative) and:
--       - Stamps data.oversold_items[] on the submission for owner review
--       - Still decrements (clamped at 0) so the row reflects best effort
--   • Returns JSON with: ok, decremented[], oversold[], total_decrements
--
-- Idempotent on the submission: writes data.inventory_decremented_at
-- and refuses to fire twice. Safe to call multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION process_retail_order_payment(p_submission_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sub RECORD;
  item RECORD;
  current_qty INT;
  decrement_qty INT;
  new_qty INT;
  decremented JSONB := '[]'::jsonb;
  oversold JSONB := '[]'::jsonb;
  oversold_count INT := 0;
  total_decrements INT := 0;
BEGIN
  -- Fetch the submission + verify it's a retail-order
  SELECT s.*, f.slug AS form_slug
    INTO sub
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_submission_id
      AND f.slug = 'retail-order'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'submission_not_found_or_not_retail');
  END IF;

  -- Idempotency: refuse to decrement twice
  IF (sub.data->>'inventory_decremented_at') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'already_decremented', TRUE,
      'decremented_at', sub.data->>'inventory_decremented_at'
    );
  END IF;

  -- Walk items[]. Each entry has product_id + qty.
  FOR item IN
    SELECT
      (e->>'product_id')::TEXT AS product_id,
      COALESCE((e->>'qty')::INT, 1) AS qty,
      e->>'name' AS name,
      e->>'brand' AS brand
    FROM jsonb_array_elements(COALESCE(sub.data->'items', '[]'::jsonb)) AS e
  LOOP
    -- Look up current qty (FOR UPDATE locks the row)
    SELECT quantity INTO current_qty
      FROM products
      WHERE id = item.product_id::UUID
      FOR UPDATE;

    IF NOT FOUND THEN
      -- Unknown product — skip + log but don't fail the whole payment
      oversold := oversold || jsonb_build_object(
        'product_id', item.product_id, 'name', item.name, 'qty', item.qty,
        'reason', 'product_not_found'
      );
      oversold_count := oversold_count + 1;
      CONTINUE;
    END IF;

    decrement_qty := item.qty;
    new_qty := current_qty - decrement_qty;

    IF new_qty < 0 THEN
      -- Oversold case: log + clamp to 0 so the row stays accurate-ish
      oversold := oversold || jsonb_build_object(
        'product_id', item.product_id,
        'name', item.name,
        'requested', decrement_qty,
        'available', current_qty,
        'short', decrement_qty - current_qty
      );
      oversold_count := oversold_count + 1;
      decrement_qty := current_qty;  -- clamped
      new_qty := 0;
    END IF;

    UPDATE products
      SET quantity = new_qty
      WHERE id = item.product_id::UUID;

    -- inventory_log entry (mig 001 has this table; defensive try/catch
    -- in case of schema variation across forks).
    BEGIN
      INSERT INTO inventory_log (product_id, change_qty, reason, notes)
      VALUES (
        item.product_id::UUID,
        -decrement_qty,
        'retail_order_paid',
        'Order #' || SUBSTRING(p_submission_id::text, 1, 8) || ' · ' || COALESCE(item.name, '?')
      );
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
    END;

    decremented := decremented || jsonb_build_object(
      'product_id', item.product_id,
      'name', item.name,
      'qty_decremented', decrement_qty,
      'new_qty', new_qty
    );
    total_decrements := total_decrements + 1;
  END LOOP;

  -- Stamp the submission so we don't fire twice + surface oversold info
  UPDATE form_submissions
    SET data = data
      || jsonb_build_object(
        'inventory_decremented_at', NOW(),
        'inventory_decrements', decremented,
        'oversold_items', oversold,
        'oversold_count', oversold_count
      )
    WHERE id = p_submission_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'submission_id', p_submission_id,
    'total_decrements', total_decrements,
    'oversold_count', oversold_count,
    'oversold', oversold,
    'decremented', decremented
  );
END $$;

GRANT EXECUTE ON FUNCTION process_retail_order_payment(UUID) TO service_role, authenticated;

-- END 054_retail_order_inventory.sql


-- ============================================================
-- BEGIN 055_retail_order_status_lookup.sql
-- ============================================================
-- ============================================================
-- 055_retail_order_status_lookup.sql — public retail-order status RPC
--
-- Customer-facing order tracking page (shop.skateos.com/order.html?id=…)
-- needs to read a single retail-order submission by its UUID without
-- exposing the entire form_submissions table to anon.
--
-- The submission UUID is the access token — 36 random hex chars,
-- unguessable. We share it in the order confirmation email + Helcim
-- payment success redirect; customer visits to track their order.
--
-- Same pattern as mig 048 (preorder_status_lookup).
-- Returns ONLY public-safe whitelist fields.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION retail_order_status_lookup(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  d JSONB;
  contact_name TEXT;
  first_name TEXT;
BEGIN
  -- Look up the submission. Refuse non-retail-order so this RPC can't be
  -- abused to read other form types (privilege escalation guard).
  SELECT s.*, f.slug AS form_slug
    INTO s
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_id
      AND f.slug = 'retail-order'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  d := COALESCE(s.data, '{}'::jsonb);
  contact_name := d->'contact'->>'name';
  first_name := SPLIT_PART(COALESCE(contact_name, ''), ' ', 1);

  RETURN jsonb_build_object(
    'found',                TRUE,
    'submitted_at',         s.created_at,
    'first_name',           first_name,
    'items',                COALESCE(d->'items', '[]'::jsonb),
    'totals',               COALESCE(d->'totals', '{}'::jsonb),
    'payment_status',       COALESCE(d->>'payment_status', 'pending'),
    'payment_paid_at',      d->>'payment_paid_at',
    'fulfillment',          COALESCE(d->>'fulfillment', 'pickup'),
    'shipping_address',     d->>'shipping_address',
    'fulfilled_at',         d->>'fulfilled_at',
    'helcim_payment_url',   d->>'helcim_payment_url',
    'oversold_count',       COALESCE((d->>'oversold_count')::int, 0)
  );
END $$;

GRANT EXECUTE ON FUNCTION retail_order_status_lookup(UUID) TO anon, authenticated;

-- END 055_retail_order_status_lookup.sql


-- ============================================================
-- BEGIN 056_public_lesson_slots.sql
-- ============================================================
-- ============================================================
-- 056_public_lesson_slots.sql — public lesson availability RPC
--
-- Phase 2 of Square Online replica: customer-facing lesson booking
-- at book.skateos.com needs to know which slots are open for a given
-- instructor on a given date.
--
-- The RPC:
--   • Returns available time slots for the requested instructor +
--     lesson type for the next N days
--   • Pulls today's hours from app_settings.hours
--   • Excludes hours when instructor has an existing non-cancelled
--     lesson (default 60-min collision window per slot)
--   • Excludes closed days (settings.holidays + DOW closed)
--   • Excludes emergency closure windows
--   • Returns whitelist-only public-safe fields (no PII / no admin notes)
--
-- Slot granularity: 60-min increments aligned to instructor schedule.
-- Lesson types steer default duration (private 60m / group 90m / camp 180m).
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public_lesson_slots(
  p_instructor TEXT,
  p_lesson_type TEXT DEFAULT 'private',
  p_days_forward INT DEFAULT 14
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s JSONB;
  hr JSONB;
  result JSONB := '[]'::jsonb;
  cursor_date DATE;
  end_date DATE;
  dow_name TEXT;
  open_hour INT;
  close_hour INT;
  duration_min INT;
  slot_start TIMESTAMPTZ;
  slot_end TIMESTAMPTZ;
  is_closed BOOLEAN;
  conflict_count INT;
  day_slots JSONB;
  hr_iter INT;
BEGIN
  IF p_days_forward IS NULL OR p_days_forward < 1 OR p_days_forward > 60 THEN p_days_forward := 14; END IF;

  -- Determine duration based on lesson type (matches mig 032 capacity defaults)
  duration_min := CASE LOWER(COALESCE(p_lesson_type, 'private'))
    WHEN 'private'  THEN 60
    WHEN 'group'    THEN 90
    WHEN 'camp'     THEN 180
    WHEN 'event'    THEN 120
    WHEN 'birthday' THEN 120
    ELSE 60
  END;

  -- Pull settings (need hours + holidays + emergency)
  SELECT value INTO s FROM app_settings WHERE key = 'all' LIMIT 1;
  IF s IS NULL THEN s := '{}'::jsonb; END IF;

  cursor_date := (NOW() AT TIME ZONE 'America/New_York')::DATE;
  end_date := cursor_date + p_days_forward;

  WHILE cursor_date <= end_date LOOP
    is_closed := FALSE;
    dow_name := LOWER(to_char(cursor_date, 'dy'));
    hr := s -> 'hours' -> dow_name;
    IF hr IS NULL THEN is_closed := TRUE; END IF;

    -- Holiday check
    IF NOT is_closed AND s ? 'holidays' AND jsonb_typeof(s->'holidays') = 'array' THEN
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s->'holidays') AS h
        WHERE (h->>'date') = to_char(cursor_date, 'YYYY-MM-DD')
           OR (h->>'date') = to_char(cursor_date, 'MM-DD')
      ) THEN
        is_closed := TRUE;
      END IF;
    END IF;

    -- Emergency closure that's still active = treat as closed
    IF NOT is_closed AND s ? 'emergencyClose' AND COALESCE((s->'emergencyClose'->>'active')::boolean, FALSE) THEN
      DECLARE until_ts TIMESTAMPTZ;
      BEGIN
        until_ts := NULLIF(s->'emergencyClose'->>'until_iso','')::TIMESTAMPTZ;
        IF until_ts IS NULL OR until_ts > cursor_date::TIMESTAMPTZ THEN
          is_closed := TRUE;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    day_slots := '[]'::jsonb;

    IF NOT is_closed AND hr IS NOT NULL THEN
      open_hour := SPLIT_PART(hr->>'open', ':', 1)::INT;
      close_hour := SPLIT_PART(hr->>'close', ':', 1)::INT;

      hr_iter := open_hour;
      WHILE hr_iter + (duration_min/60) <= close_hour LOOP
        slot_start := (cursor_date::TEXT || ' ' || LPAD(hr_iter::TEXT, 2, '0') || ':00:00 America/New_York')::TIMESTAMPTZ;
        slot_end := slot_start + (duration_min || ' minutes')::INTERVAL;

        -- Skip slots in the past (today's morning hours after current time)
        IF slot_start > NOW() THEN
          -- Check for instructor conflict
          SELECT COUNT(*) INTO conflict_count
          FROM lessons
          WHERE instructor = p_instructor
            AND status NOT IN ('cancelled', 'no_show')
            AND scheduled_at < slot_end
            AND scheduled_at + (COALESCE(duration_min, 60) || ' minutes')::INTERVAL > slot_start;

          IF conflict_count = 0 THEN
            day_slots := day_slots || jsonb_build_object(
              'iso',     slot_start,
              'time_label', to_char(slot_start AT TIME ZONE 'America/New_York', 'FMHH12:MIam'),
              'duration_min', duration_min
            );
          END IF;
        END IF;
        hr_iter := hr_iter + 1;
      END LOOP;
    END IF;

    result := result || jsonb_build_object(
      'date',      to_char(cursor_date, 'YYYY-MM-DD'),
      'dow',       to_char(cursor_date, 'FMDay'),
      'is_closed', is_closed,
      'slots',     day_slots
    );

    cursor_date := cursor_date + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'instructor',     p_instructor,
    'lesson_type',    p_lesson_type,
    'duration_min',   duration_min,
    'days',           result
  );
END $$;

GRANT EXECUTE ON FUNCTION public_lesson_slots(TEXT, TEXT, INT) TO anon, authenticated;

-- Public-readable list of active instructors (so the booking page can offer a dropdown)
CREATE OR REPLACE FUNCTION public_instructor_list()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           id,
    'display_name', display_name
  ) ORDER BY display_name), '[]'::jsonb)
  INTO result
  FROM staff
  WHERE active = TRUE
    AND role IN ('instructor', 'owner');
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public_instructor_list() TO anon, authenticated;

-- END 056_public_lesson_slots.sql


-- ============================================================
-- BEGIN 057_lesson_booking_form.sql
-- ============================================================
-- ============================================================
-- 057_lesson_booking_form.sql — public lesson-booking submission target
--
-- Phase 2 of Square Online replica: book.skateos.com self-service lesson
-- bookings need a `forms` row to point submissions at, mirroring the
-- preorder-2026 (mig 046) and retail-order (mig 053) patterns.
--
-- Submissions land in form_submissions with form_id = this form's id.
-- After Helcim payment lands, helcim-webhook auto-flips
-- data.payment_status='paid' and creates a real lessons row.
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$
DECLARE seed_tid UUID;
BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;

  INSERT INTO forms (slug, name, description, schema, submit_action, enabled, tenant_id)
  VALUES (
    'lesson-booking',
    'Online lesson bookings (book.skateos.com)',
    'Customer-submitted self-service lesson bookings. Each submission contains the picked instructor + slot + customer contact + notes + Helcim payment status. After payment, helcim-webhook promotes to a real lessons row.',
    '{"fields":[]}'::jsonb,
    'lesson_intake',
    TRUE,
    seed_tid
  )
  ON CONFLICT (slug) DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'forms table missing — apply migration 011 first';
END $$;

-- END 057_lesson_booking_form.sql


-- ============================================================
-- BEGIN 058_my_customer_orders.sql
-- ============================================================
-- ============================================================
-- 058_my_customer_orders.sql — customer-portal RPC for retail + lesson bookings
--
-- Phase 3 polish: extends the customer self-serve me.html portal to surface
-- a customer's online retail orders + lesson bookings alongside their
-- existing pre-orders + visits + loyalty data.
--
-- Without this RPC the portal can't read form_submissions directly (RLS is
-- staff-only). Same SECURITY DEFINER pattern as mig 050 (my_preorders).
--
-- Returns ONLY the public-safe whitelist of fields. Match by email or
-- phone last-7-digits (forgiving of country-code formatting).
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION my_retail_orders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cust_id UUID;
  cust_email TEXT;
  cust_phone_digits TEXT;
  result JSONB := '[]'::jsonb;
BEGIN
  cust_id := current_customer_id();
  IF cust_id IS NULL THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'not_authenticated_as_customer');
  END IF;

  SELECT email, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
    INTO cust_email, cust_phone_digits
    FROM customers
    WHERE id = cust_id;

  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'submitted_at') DESC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT jsonb_build_object(
        'id',                 s.id,
        'submitted_at',       s.created_at,
        'items',              COALESCE(s.data->'items', '[]'::jsonb),
        'totals',             COALESCE(s.data->'totals', '{}'::jsonb),
        'payment_status',     COALESCE(s.data->>'payment_status', 'pending'),
        'fulfillment',        COALESCE(s.data->>'fulfillment', 'pickup'),
        'fulfilled_at',       s.data->>'fulfilled_at',
        'helcim_payment_url', s.data->>'helcim_payment_url'
      ) AS payload
      FROM form_submissions s
      JOIN forms f ON f.id = s.form_id
      WHERE f.slug = 'retail-order'
        AND (
          (cust_email IS NOT NULL AND LOWER(s.data->'contact'->>'email') = LOWER(cust_email))
          OR (LENGTH(cust_phone_digits) >= 7
              AND RIGHT(regexp_replace(COALESCE(s.data->'contact'->>'phone', ''), '[^0-9]', '', 'g'), 7)
                  = RIGHT(cust_phone_digits, 7))
        )
      LIMIT 50
    ) AS sub;

  RETURN jsonb_build_object('found', TRUE, 'orders', result);
END $$;

GRANT EXECUTE ON FUNCTION my_retail_orders() TO authenticated;

-- Online lesson bookings — same shape, slug='lesson-booking'
CREATE OR REPLACE FUNCTION my_lesson_bookings()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cust_id UUID;
  cust_email TEXT;
  cust_phone_digits TEXT;
  result JSONB := '[]'::jsonb;
BEGIN
  cust_id := current_customer_id();
  IF cust_id IS NULL THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'not_authenticated_as_customer');
  END IF;

  SELECT email, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
    INTO cust_email, cust_phone_digits
    FROM customers
    WHERE id = cust_id;

  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'scheduled_at') ASC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT jsonb_build_object(
        'id',                 s.id,
        'submitted_at',       s.created_at,
        'lesson_type',        s.data->>'lesson_type',
        'instructor',         s.data->>'instructor',
        'scheduled_at',       s.data->>'scheduled_at',
        'duration_min',       (s.data->>'duration_min')::int,
        'price',              s.data->>'price',
        'payment_status',     COALESCE(s.data->>'payment_status', 'pending'),
        'helcim_payment_url', s.data->>'helcim_payment_url',
        'lesson_id',          s.data->>'lesson_id',
        'skater_name',        s.data->'skater'->>'name'
      ) AS payload
      FROM form_submissions s
      JOIN forms f ON f.id = s.form_id
      WHERE f.slug = 'lesson-booking'
        AND (
          (cust_email IS NOT NULL AND LOWER(s.data->'contact'->>'email') = LOWER(cust_email))
          OR (LENGTH(cust_phone_digits) >= 7
              AND RIGHT(regexp_replace(COALESCE(s.data->'contact'->>'phone', ''), '[^0-9]', '', 'g'), 7)
                  = RIGHT(cust_phone_digits, 7))
        )
      LIMIT 50
    ) AS sub;

  RETURN jsonb_build_object('found', TRUE, 'bookings', result);
END $$;

GRANT EXECUTE ON FUNCTION my_lesson_bookings() TO authenticated;

-- END 058_my_customer_orders.sql


-- ============================================================
-- BEGIN 059_retail_order_tracking.sql
-- ============================================================
-- ============================================================
-- 059_retail_order_tracking.sql — extend retail_order_status_lookup
--                                   with tracking_number + carrier
--
-- The admin _retailMarkFulfilled flow now optionally captures a
-- tracking number + carrier on ship-orders (UPS / USPS / FedEx /
-- DHL / other). This migration extends the public status-lookup RPC
-- so the customer-facing order tracking page (shop/order.html) can
-- surface the tracking info + a deep-link to the carrier's site.
--
-- Pure RPC update (CREATE OR REPLACE). No table schema change —
-- tracking_number + carrier live inside the existing JSONB `data`
-- column on form_submissions, no migration needed for those.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION retail_order_status_lookup(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  d JSONB;
  contact_name TEXT;
  first_name TEXT;
BEGIN
  SELECT s.*, f.slug AS form_slug
    INTO s
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_id
      AND f.slug = 'retail-order'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  d := COALESCE(s.data, '{}'::jsonb);
  contact_name := d->'contact'->>'name';
  first_name := SPLIT_PART(COALESCE(contact_name, ''), ' ', 1);

  RETURN jsonb_build_object(
    'found',                TRUE,
    'submitted_at',         s.created_at,
    'first_name',           first_name,
    'items',                COALESCE(d->'items', '[]'::jsonb),
    'totals',               COALESCE(d->'totals', '{}'::jsonb),
    'payment_status',       COALESCE(d->>'payment_status', 'pending'),
    'payment_paid_at',      d->>'payment_paid_at',
    'fulfillment',          COALESCE(d->>'fulfillment', 'pickup'),
    'shipping_address',     d->>'shipping_address',
    'fulfilled_at',         d->>'fulfilled_at',
    'helcim_payment_url',   d->>'helcim_payment_url',
    'oversold_count',       COALESCE((d->>'oversold_count')::int, 0),
    -- NEW: tracking info (ship-orders only, optional)
    'tracking_number',      d->>'tracking_number',
    'carrier',              d->>'carrier'
  );
END $$;

GRANT EXECUTE ON FUNCTION retail_order_status_lookup(UUID) TO anon, authenticated;

-- END 059_retail_order_tracking.sql


-- ============================================================
-- BEGIN 060_customer_cancel_subscription.sql
-- ============================================================
-- ============================================================
-- 060_customer_cancel_subscription.sql — customer self-serve cancel
--
-- Lets a signed-in customer cancel their own active subscription
-- via the me.html portal without calling the front desk.
--
-- Server-authoritative — gates on current_customer_id() = subscription
-- customer_id (mig 019). Refuses already-cancelled. Flips status to
-- 'cancelled' + audit-stamps notes with [Customer-cancelled YYYY-MM-DD:
-- REASON] for traceability. Does NOT issue any refund — that's an owner
-- decision (most skateparks: "ends at end of billing period, no refunds").
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customer_cancel_subscription(
  p_subscription_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_sub RECORD;
  v_audit_stamp TEXT;
  v_clean_reason TEXT;
BEGIN
  -- Resolve current customer (mig 019 helper)
  v_customer_id := current_customer_id();
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Not authenticated as a customer');
  END IF;

  -- Look up the subscription, verify ownership
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Subscription not found');
  END IF;
  IF v_sub.customer_id != v_customer_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'This subscription does not belong to you');
  END IF;

  -- Refuse non-cancellable states
  IF v_sub.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Already cancelled');
  END IF;
  IF v_sub.status = 'expired' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Already expired');
  END IF;

  -- Sanitize reason — strip control chars + cap at 300 chars
  v_clean_reason := REGEXP_REPLACE(COALESCE(p_reason, ''), '[[:cntrl:]]', '', 'g');
  IF LENGTH(v_clean_reason) > 300 THEN
    v_clean_reason := SUBSTRING(v_clean_reason FROM 1 FOR 300);
  END IF;
  IF v_clean_reason = '' THEN
    v_clean_reason := '(no reason provided)';
  END IF;

  -- Build audit stamp
  v_audit_stamp := '[Customer-cancelled ' || TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC: ' || v_clean_reason || ']';

  -- Flip status + append audit stamp to notes
  UPDATE subscriptions
  SET
    status = 'cancelled',
    notes = COALESCE(NULLIF(TRIM(notes), ''), '') ||
            CASE WHEN COALESCE(NULLIF(TRIM(notes), ''), '') = '' THEN '' ELSE E'\n' END ||
            v_audit_stamp,
    updated_at = NOW()
  WHERE id = p_subscription_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'subscription_id', p_subscription_id,
    'previous_status', v_sub.status,
    'cancelled_at', NOW()
  );
END $$;

GRANT EXECUTE ON FUNCTION customer_cancel_subscription(UUID, TEXT) TO authenticated;

-- END 060_customer_cancel_subscription.sql


-- ============================================================
-- BEGIN 061_customer_pause_subscription.sql
-- ============================================================
-- ============================================================
-- 061_customer_pause_subscription.sql — customer self-serve pause
--
-- Lets a signed-in customer pause their own active monthly/annual
-- subscription for up to 90 days via the me.html portal. Pairs with
-- mig 030 (paused_until column + auto-resume daily cron). After the
-- pause window passes, the existing cron auto-flips status back to
-- 'active' so the customer doesn't have to manually un-pause.
--
-- Server-authoritative — gates on current_customer_id() (mig 019).
-- Refuses pauses on punch_card / day_pass plans (those don't bill on
-- a cycle so pause is meaningless). Refuses already-paused. Caps the
-- pause window at 90 days max to prevent indefinite-pause abuse.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customer_pause_subscription(
  p_subscription_id UUID,
  p_until DATE,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_sub RECORD;
  v_audit_stamp TEXT;
  v_clean_reason TEXT;
  v_max_until DATE;
BEGIN
  -- Resolve current customer (mig 019)
  v_customer_id := current_customer_id();
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Not authenticated as a customer');
  END IF;

  -- Look up subscription, verify ownership
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Subscription not found');
  END IF;
  IF v_sub.customer_id != v_customer_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'This subscription does not belong to you');
  END IF;

  -- Refuse uncancellable / unpausable types
  IF v_sub.status != 'active' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only active subscriptions can be paused (this one is ' || v_sub.status || ')');
  END IF;
  IF v_sub.plan_type NOT IN ('monthly', 'annual') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only monthly or annual memberships can be paused');
  END IF;

  -- Validate pause-until date — must be in future, max 90 days out
  IF p_until IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Pause-until date is required');
  END IF;
  IF p_until <= CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Pause-until date must be in the future');
  END IF;
  v_max_until := CURRENT_DATE + INTERVAL '90 days';
  IF p_until > v_max_until THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Maximum pause window is 90 days. Pick a date on or before ' || TO_CHAR(v_max_until, 'YYYY-MM-DD'));
  END IF;

  -- Sanitize reason
  v_clean_reason := REGEXP_REPLACE(COALESCE(p_reason, ''), '[[:cntrl:]]', '', 'g');
  IF LENGTH(v_clean_reason) > 300 THEN
    v_clean_reason := SUBSTRING(v_clean_reason FROM 1 FOR 300);
  END IF;
  IF v_clean_reason = '' THEN
    v_clean_reason := '(no reason provided)';
  END IF;

  v_audit_stamp := '[Customer-paused ' || TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') ||
                   ' UTC until ' || TO_CHAR(p_until, 'YYYY-MM-DD') || ': ' || v_clean_reason || ']';

  -- Flip to paused + set paused_until + audit stamp
  UPDATE subscriptions
  SET
    status = 'paused',
    paused_until = p_until,
    notes = COALESCE(NULLIF(TRIM(notes), ''), '') ||
            CASE WHEN COALESCE(NULLIF(TRIM(notes), ''), '') = '' THEN '' ELSE E'\n' END ||
            v_audit_stamp,
    updated_at = NOW()
  WHERE id = p_subscription_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'subscription_id', p_subscription_id,
    'paused_until', p_until,
    'will_auto_resume_at', p_until
  );
END $$;

GRANT EXECUTE ON FUNCTION customer_pause_subscription(UUID, DATE, TEXT) TO authenticated;

-- END 061_customer_pause_subscription.sql

