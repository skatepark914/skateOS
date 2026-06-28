-- ============================================================
-- 083_square_daily_sync_cron.sql
--
-- Daily pg_cron that pulls yesterday's Square sales + Square
-- Appointments bookings into skateOS so reports/calendar/customer
-- portal stay live as Doug keeps using Square for in-person POS.
--
-- Runs every day at 10:00 UTC (~6am ET) — quiet enough that POS
-- isn't running yet, late enough that all of yesterday's Square
-- payments have closed_at stamped.
--
-- Importers are idempotent (dedupe via square_order_id + square_booking_id)
-- so re-running is safe.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop prior schedules so re-running this migration replaces them
DO $$ BEGIN PERFORM cron.unschedule('square-sales-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('square-bookings-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 6am ET daily — pull yesterday + today so far (handles edge-of-midnight)
SELECT cron.schedule(
  'square-sales-daily',
  '0 10 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/square-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
    ),
    body    := jsonb_build_object(
      'action', 'commit',
      'what',   'orders',
      'since',  to_char((NOW() AT TIME ZONE 'America/New_York')::DATE - 2, 'YYYY-MM-DD'),
      'until',  to_char((NOW() AT TIME ZONE 'America/New_York')::DATE + 1, 'YYYY-MM-DD')
    ),
    timeout_milliseconds := 150000
  ) AS request_id;
  $$
);

-- 6:05am ET daily — pull yesterday + next 90 days of bookings
SELECT cron.schedule(
  'square-bookings-daily',
  '5 10 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/square-bookings-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
    ),
    body    := jsonb_build_object(
      'action', 'commit',
      'since',  to_char((NOW() AT TIME ZONE 'America/New_York')::DATE - 2, 'YYYY-MM-DD'),
      'until',  to_char((NOW() AT TIME ZONE 'America/New_York')::DATE + 90, 'YYYY-MM-DD')
    ),
    timeout_milliseconds := 150000
  ) AS request_id;
  $$
);

DO $$
DECLARE
  ct INT;
BEGIN
  SELECT count(*) INTO ct FROM cron.job WHERE jobname IN ('square-sales-daily','square-bookings-daily');
  RAISE NOTICE '083 applied: % daily Square sync jobs scheduled', ct;
END $$;

-- Inspection:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'square-%';
--   SELECT * FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'square-%') ORDER BY end_time DESC LIMIT 10;
-- Manual fire:
--   SELECT cron.run((SELECT jobid FROM cron.job WHERE jobname='square-sales-daily'));
