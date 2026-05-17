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
