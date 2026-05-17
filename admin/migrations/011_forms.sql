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
