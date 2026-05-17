-- ============================================================
-- 069_tenant_brivo_config.sql — per-tenant Brivo credentials
-- ============================================================
-- White-label Phase 1 (CLAUDE.md item 8 path B).
--
-- Moves Brivo credentials from Supabase secrets (env vars, one set
-- across all tenants) into a per-tenant table. Each park has their
-- own Brivo account + credentials + group IDs. skateOS resolves
-- credentials by tenant_id at request time.
--
-- SECURITY MODEL:
--   - Credentials NEVER readable by authenticated users (no client SELECT).
--   - Only service_role can read raw secrets — Edge Functions use this.
--   - Owner saves credentials via brivo-save-config Edge Function.
--   - Owner reads back via a metadata view that shows which fields are
--     SET (boolean) + non-secret fields (account_id) but never the
--     raw client_secret / api_key / webhook_secret.
--
-- BACKWARD COMPATIBLE:
--   - When tenant_brivo_config has no row OR row has NULL credentials,
--     _brivo/api.ts falls back to env vars (BRIVO_CLIENT_ID etc).
--   - So 2nd Nature's existing env-var setup keeps working — no
--     forced migration. New tenants use the table; existing tenant
--     can migrate to table-storage anytime.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ── Per-tenant credentials table ─────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_brivo_config (
  tenant_id                      UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- OAuth credentials
  client_id                      TEXT,
  client_secret                  TEXT,
  api_key                        TEXT,
  account_id                     TEXT,
  -- Brivo dashboard config
  active_members_group_id        TEXT,
  park_door_ap_id                TEXT,
  shop_door_ap_id                TEXT,
  operating_hours_schedule_id    TEXT,
  webhook_secret                 TEXT,
  -- Behavior flags
  auto_checkin_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  -- Audit
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_at               TIMESTAMPTZ,                -- updated when test-connection succeeds
  last_verified_by_email         TEXT
);

-- Strict RLS: nobody but service_role reads the raw credentials.
ALTER TABLE tenant_brivo_config ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for anon/authenticated → reads return zero rows.
-- service_role bypasses RLS so Edge Functions still work.
DROP POLICY IF EXISTS tbc_no_client_select ON tenant_brivo_config;
-- (We deliberately do NOT create a SELECT policy. Postgres default with
--  RLS enabled = no access. service_role bypasses RLS by design.)

-- No client INSERT/UPDATE either — owner must go through brivo-save-config
-- Edge Function which runs as service_role.
-- (Again, no policy = no access for client roles.)


-- ── Owner-readable metadata view ─────────────────────────────
-- Shows whether credentials are configured (boolean per field) + non-secret
-- public fields. Used by the Settings UI to render the per-tenant status.
-- Returns at most one row per tenant_id.
CREATE OR REPLACE VIEW tenant_brivo_config_status AS
SELECT
  tenant_id,
  account_id,                                                   -- non-secret, OK to display
  active_members_group_id,                                      -- non-secret
  park_door_ap_id,                                              -- non-secret
  shop_door_ap_id,                                              -- non-secret
  operating_hours_schedule_id,                                  -- non-secret
  auto_checkin_enabled,
  -- Booleans: which secret fields are populated?
  (client_id     IS NOT NULL AND length(client_id)     > 0) AS client_id_set,
  (client_secret IS NOT NULL AND length(client_secret) > 0) AS client_secret_set,
  (api_key       IS NOT NULL AND length(api_key)       > 0) AS api_key_set,
  (webhook_secret IS NOT NULL AND length(webhook_secret) > 0) AS webhook_secret_set,
  -- Last-4 hints (safe to display — these are non-reversible)
  CASE WHEN length(coalesce(client_id, '')) > 4
       THEN '…' || right(client_id, 4) ELSE NULL END AS client_id_last4,
  CASE WHEN length(coalesce(api_key, '')) > 4
       THEN '…' || right(api_key, 4) ELSE NULL END AS api_key_last4,
  last_verified_at,
  last_verified_by_email,
  created_at,
  updated_at
FROM tenant_brivo_config;

-- View permissions: authenticated users can read but RLS on the underlying
-- table blocks access. We grant SELECT here so the view fronts the metadata,
-- but the table's RLS still blocks raw secret access.
-- Actually no — RLS on the table blocks the view too. To expose metadata,
-- we need a SECURITY DEFINER function instead.
DROP VIEW IF EXISTS tenant_brivo_config_status;

CREATE OR REPLACE FUNCTION brivo_config_status_for_current_tenant()
RETURNS TABLE (
  tenant_id                     UUID,
  account_id                    TEXT,
  active_members_group_id       TEXT,
  park_door_ap_id               TEXT,
  shop_door_ap_id               TEXT,
  operating_hours_schedule_id   TEXT,
  auto_checkin_enabled          BOOLEAN,
  client_id_set                 BOOLEAN,
  client_secret_set             BOOLEAN,
  api_key_set                   BOOLEAN,
  webhook_secret_set            BOOLEAN,
  client_id_last4               TEXT,
  api_key_last4                 TEXT,
  last_verified_at              TIMESTAMPTZ,
  last_verified_by_email        TEXT,
  created_at                    TIMESTAMPTZ,
  updated_at                    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ct UUID := current_tenant_id();
BEGIN
  -- Owner-only — staff shouldn't peek at credentials config either
  IF NOT is_owner() THEN
    RAISE EXCEPTION 'owner only';
  END IF;
  IF ct IS NULL THEN
    -- No tenant context (e.g., single-tenant install or owner without user_tenants row).
    -- Return empty — frontend reads this as "not configured" and falls back to env vars.
    RETURN;
  END IF;
  RETURN QUERY
    SELECT
      t.tenant_id,
      t.account_id,
      t.active_members_group_id,
      t.park_door_ap_id,
      t.shop_door_ap_id,
      t.operating_hours_schedule_id,
      t.auto_checkin_enabled,
      (t.client_id      IS NOT NULL AND length(t.client_id)      > 0),
      (t.client_secret  IS NOT NULL AND length(t.client_secret)  > 0),
      (t.api_key        IS NOT NULL AND length(t.api_key)        > 0),
      (t.webhook_secret IS NOT NULL AND length(t.webhook_secret) > 0),
      CASE WHEN length(coalesce(t.client_id, '')) > 4 THEN '…' || right(t.client_id, 4) END,
      CASE WHEN length(coalesce(t.api_key,   '')) > 4 THEN '…' || right(t.api_key,   4) END,
      t.last_verified_at,
      t.last_verified_by_email,
      t.created_at,
      t.updated_at
    FROM tenant_brivo_config t
    WHERE t.tenant_id = ct;
END;
$$;

GRANT EXECUTE ON FUNCTION brivo_config_status_for_current_tenant() TO authenticated;

-- updated_at trigger
CREATE OR REPLACE FUNCTION tenant_brivo_config_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tenant_brivo_config_touch ON tenant_brivo_config;
CREATE TRIGGER trg_tenant_brivo_config_touch
BEFORE UPDATE ON tenant_brivo_config
FOR EACH ROW EXECUTE FUNCTION tenant_brivo_config_touch();


-- ============================================================
-- Notes:
--
-- READ STATUS (from admin SPA — owner-only):
--   SELECT * FROM brivo_config_status_for_current_tenant();
--
-- SAVE/UPDATE (must go through Edge Function — direct INSERT requires
-- service_role since RLS blocks all client roles). Edge Function:
--   POST /functions/v1/brivo-save-config
--   body: { client_id, client_secret, api_key, account_id, ... }
--
-- INSPECT RAW (via service_role only — psql with service key):
--   SELECT tenant_id, client_id, account_id FROM tenant_brivo_config;
-- ============================================================
