-- ============================================================
-- 021_daily_digest_cron.sql — schedule the daily-digest Edge Function
--
-- Fires every morning at 8am America/New_York (12:00 UTC during EDT,
-- 13:00 UTC during EST — picking 12:00 UTC = ~7-8am ET, close enough).
-- Owner gets a styled email with yesterday's stats + today's lessons.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Drop any prior schedule
DO $$ BEGIN
  PERFORM cron.unschedule('daily-digest-morning');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule: 12:00 UTC daily = ~7-8am ET
SELECT cron.schedule(
  'daily-digest-morning',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 90000
  ) AS request_id;
  $$
);

-- Inspect:
--   SELECT * FROM cron.job WHERE jobname = 'daily-digest-morning';
-- Manually fire:
--   SELECT cron.run('daily-digest-morning');
-- Or hit the function directly with curl:
--   curl -X POST https://zecurmlenxyxanqucrga.supabase.co/functions/v1/daily-digest \
--        -H "Authorization: Bearer <service-role-key>"
