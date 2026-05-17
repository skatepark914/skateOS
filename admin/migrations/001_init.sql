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
