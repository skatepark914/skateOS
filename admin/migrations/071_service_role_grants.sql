-- ============================================================
-- Migration 071 — service_role grants on tables that were missed
--
-- Edge Functions run as `service_role`. SECURITY INVOKER trigger
-- functions on customers (waiver_set_expiry, brivo_trg_customer_change,
-- audit_trigger) read from app_settings — and the smartwaiver-webhook
-- insert path hit "permission denied for table app_settings" because
-- service_role had no grants on it. Same problem on every table added
-- by migrations 041 (gift cards), 045 (affiliate), 064-069 (Brivo +
-- Frigate + tenant_brivo_config).
--
-- Fix: give service_role the same DML grants the other Supabase roles
-- already have. Idempotent — GRANT is additive, re-runs are no-ops.
-- service_role bypasses RLS, so this doesn't widen tenant access.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON app_settings TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  affiliate_codes,
  affiliate_earnings,
  affiliate_programs,
  affiliate_redemptions,
  brivo_access_log,
  brivo_event_passes,
  frigate_cameras,
  frigate_events,
  gift_card_transactions,
  gift_cards,
  tenant_brivo_config
TO service_role;

-- Future-proof: any table created in `public` should also be readable
-- by service_role automatically. Cloudflare-style default-grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

DO $$ BEGIN
  RAISE NOTICE 'Migration 071 applied: service_role now has DML on app_settings + 11 newer tables';
END $$;
