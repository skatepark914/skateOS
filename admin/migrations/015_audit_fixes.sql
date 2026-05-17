-- ============================================================
-- 015_audit_fixes.sql — fixes flagged in 2026-04-30 code audit
--
-- (1) ALTER TYPE inside-transaction risk from 008 — re-attempt
--     using a defensive pattern that works in both transactional
--     and non-transactional Supabase migration runners.
-- (2) Webhook log for forensic debugging of helcim-webhook (and
--     future webhook handlers).
--
-- Multi-tenant dynamic-table-list refactor is a v2 task — defer
-- until we add the next business table. For now the array in
-- 009 is documented as a known gotcha.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Make sure 'instructor' is in staff_role
--    (008 attempted this; this is a safety re-attempt that won't
--    fail if the value already exists.)
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'staff_role'::regtype AND enumlabel = 'instructor'
  ) THEN
    ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'instructor';
  END IF;
EXCEPTION WHEN feature_not_supported THEN
  RAISE NOTICE 'Could not add staff_role enum value (likely transactional context). Run separately: ALTER TYPE staff_role ADD VALUE IF NOT EXISTS ''instructor'';';
WHEN OTHERS THEN
  RAISE NOTICE 'staff_role.instructor enum extension skipped: %', SQLERRM;
END $$;

-- ------------------------------------------------------------
-- 2. webhook_log — forensic table for inbound webhook events.
--    helcim-webhook (and future Stripe / Smartwaiver webhooks)
--    write a row here on every event so silent failures leave a
--    trail.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,                  -- 'helcim', 'smartwaiver', 'stripe', etc.
  event_type      TEXT,                           -- e.g. 'cardTransaction.success'
  event_id        TEXT,                           -- provider's id
  status          TEXT NOT NULL CHECK (status IN ('received','processed','error','signature_mismatch','ignored')),
  ref_table       TEXT,                           -- which local table was updated
  ref_id          UUID,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message   TEXT,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_source ON webhook_log(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_log_errors ON webhook_log(status) WHERE status IN ('error','signature_mismatch');
CREATE INDEX IF NOT EXISTS idx_webhook_log_event  ON webhook_log(event_id) WHERE event_id IS NOT NULL;

-- Multi-tenant
ALTER TABLE webhook_log ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_webhook_log_tenant ON webhook_log(tenant_id);

-- RLS — owner-only read; Edge Functions write via service_role (bypasses RLS).
ALTER TABLE webhook_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wl_read   ON webhook_log;
DROP POLICY IF EXISTS wl_delete ON webhook_log;
CREATE POLICY wl_read   ON webhook_log FOR SELECT USING (is_owner());
CREATE POLICY wl_delete ON webhook_log FOR DELETE USING (is_owner());

GRANT SELECT, INSERT ON webhook_log TO authenticated;
GRANT ALL            ON webhook_log TO service_role;

-- ------------------------------------------------------------
-- 3. Tighten forms RLS — only EXPOSE enabled forms publicly.
--    (Audit found: anon could list every form schema, exposing
--    metadata of disabled / draft forms.)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS forms_read ON forms;
CREATE POLICY forms_read ON forms FOR SELECT USING (
  enabled = TRUE OR is_staff()
);

-- ------------------------------------------------------------
-- 4. Equipment status guard — prevent "lost" or "retired" items
--    from being silently flipped back to in_stock by the loan
--    sync trigger when an open loan is closed.
-- ------------------------------------------------------------
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
        -- ONLY flip to 'in_stock' if equipment is currently 'loaned'.
        -- Skip if maintenance / retired / lost so we don't undo manual interventions.
        UPDATE equipment SET status = 'in_stock', updated_at = NOW()
         WHERE id = NEW.equipment_id AND status = 'loaned';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;
