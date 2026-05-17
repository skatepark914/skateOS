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
