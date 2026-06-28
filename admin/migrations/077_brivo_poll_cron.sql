-- ============================================================
-- 077_brivo_poll_cron.sql
--
-- Schedules brivo-poll Edge Function every minute via pg_cron.
--
-- Why polling instead of webhooks: Doug's Brivo tier only supports
-- email notifications, not URL webhooks. The brivo-poll function
-- fetches /v1/api/events on a cron and reconstructs the same
-- downstream effects (access_log + auto-checkin + staff prompt).
--
-- Each run reads brivo_poll_state (key='brivo_poll_state') in
-- app_settings, fetches new events since the prior cursor, then
-- updates the cursor. First run pulls the last hour to avoid replay.
--
-- Cadence: every minute = 1440 runs/day. Each run is small (typically
-- <5 events) so cost is negligible. Drop to every-5-minutes if Brivo
-- API quota is tight.
--
-- Idempotent. Safe to re-run — drops + re-adds schedule.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop prior schedule so re-running this migration replaces it
DO $$ BEGIN
  PERFORM cron.unschedule('brivo-poll-1min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'brivo-poll-1min',
  '* * * * *',                                -- every minute
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/brivo-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        current_setting('app.settings.service_role_key', true),
        ''
      )
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 50000
  ) AS request_id;
  $$
);

-- NOTE: Until BRIVO_CLIENT_ID/SECRET/API_KEY/ACCOUNT_ID are set as Supabase
-- secrets, brivo-poll returns a 500 with a clear error every minute. Those
-- failures land in cron.job_run_details but don't affect anything else.
-- Pause the job manually via Supabase SQL editor if the noise bothers you:
--   UPDATE cron.job SET active=false WHERE jobname='brivo-poll-1min';
-- Resume after secrets are set:
--   UPDATE cron.job SET active=true WHERE jobname='brivo-poll-1min';

-- Verification probe
DO $$
DECLARE
  job_count INT;
BEGIN
  SELECT count(*) INTO job_count FROM cron.job WHERE jobname = 'brivo-poll-1min';
  RAISE NOTICE '077 brivo-poll cron: % schedule registered', job_count;
END $$;

-- ----------------------------------------------------------------
-- Inspection:
--   SELECT jobid, schedule, command FROM cron.job WHERE jobname='brivo-poll-1min';
--   SELECT * FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname='brivo-poll-1min') ORDER BY end_time DESC LIMIT 10;
--   SELECT value FROM app_settings WHERE key='brivo_poll_state';
-- Manual fire:
--   SELECT cron.run('brivo-poll-1min');
-- Pause (without losing the schedule):
--   UPDATE cron.job SET active=false WHERE jobname='brivo-poll-1min';
--   UPDATE cron.job SET active=true  WHERE jobname='brivo-poll-1min';
-- ----------------------------------------------------------------
