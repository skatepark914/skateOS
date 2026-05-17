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
