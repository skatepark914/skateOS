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
