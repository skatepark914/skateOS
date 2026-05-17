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
