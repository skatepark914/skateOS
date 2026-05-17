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
