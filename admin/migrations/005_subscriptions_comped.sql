-- ============================================================
-- 005_subscriptions_comped.sql
-- Add 'comped' to subscriptions.plan_type allowed values.
--
-- Why: the admin's renderSubscriptions UI offers "Industry / Comped"
-- as a plan template + the renderSubscriptions render code already
-- handles `s.plan_type === 'comped'` — but the original CHECK
-- constraint in 001_init.sql doesn't allow it, so the INSERT would
-- 400 on save. This migration brings the schema in line with the UI.
--
-- Idempotent: drops the old constraint by name then recreates.
-- ============================================================

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_type_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_type_check
  CHECK (plan_type IN ('monthly','annual','punch_card','day_pass','comped'));
