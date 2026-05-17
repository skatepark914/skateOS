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
