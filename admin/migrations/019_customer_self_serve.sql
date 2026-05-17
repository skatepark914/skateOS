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
