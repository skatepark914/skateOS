-- ============================================================
-- 094_fix_discounts_cron.sql
--
-- P1 BUG: mig 091 used current_setting('app.settings.supabase_url')
-- for the URL, but that GUC isn't set in this DB. Cron has failed
-- every run since 2026-06-19 (4 consecutive failures).
--
-- Pattern matched with the working crons (083, 087): hard-code the
-- URL, use coalesce(..., '', true) on the service_role_key GUC.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN PERFORM cron.unschedule('square-discounts-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'square-discounts-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/square-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
    ),
    body    := jsonb_build_object('what', 'discounts')
  );
  $$
);

DO $$ BEGIN
  RAISE NOTICE '094 applied: square-discounts-daily now uses hard-coded URL + safe GUC pattern';
END $$;
