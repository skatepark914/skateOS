-- ============================================================
-- 065_brivo_welcome_email.sql — branded "welcome to 24/7 access"
-- ============================================================
-- Adds an idempotency stamp so the skateOS-branded welcome email
-- (sent in addition to Brivo's generic Mobile Pass invite) never
-- double-fires when brivo-sync-customer retries.
--
-- Email fires from brivo-sync-customer/index.ts after the first
-- successful provision (state transitions to 'pending'). Reads
-- the on/off toggle from app_settings.value.integrations.brivo
-- .welcomeEmailEnabled (default ON). Honors customers.email_opt_out_at.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS brivo_welcome_sent_at TIMESTAMPTZ;

-- No index needed — this column is only read inside the per-customer
-- sync flow which already has the customer row in hand.
