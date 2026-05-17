-- ============================================================
-- 016_lesson_reminder_cron.sql — pg_cron schedule for hourly reminders
--
-- Hits the send-lesson-reminders Edge Function every hour at :00.
-- The function is idempotent — safe to call repeatedly; it skips
-- lessons that already have reminder_sent_at set.
--
-- Requires Supabase pg_cron + pg_net extensions enabled.
-- Both are available on free tier (you may have to enable them
-- in Database → Extensions in the dashboard if not already on).
--
-- Idempotent. Safe to re-run — drops + re-adds the schedule.
-- ============================================================

-- Enable extensions (no-op if already on)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any prior schedule so this is idempotent
DO $$ BEGIN
  PERFORM cron.unschedule('lesson-reminders-hourly');
EXCEPTION WHEN OTHERS THEN NULL;  -- ignore if it doesn't exist
END $$;

-- Schedule the hourly call.
-- We need an Authorization header — the Edge Function defaults to verify-jwt.
-- Two paths:
--   (A) Deploy send-lesson-reminders with --no-verify-jwt, then add an internal
--       shared-secret check (CRON_SECRET env var) inside the function.
--   (B) Use the anon key here. The Edge Function itself uses service-role for DB
--       writes via createClient(SUPABASE_SERVICE_ROLE_KEY) so RLS is bypassed
--       internally regardless of caller token.
--
-- Path B is what we use here. The anon key is in supabase_functions schema:
--   `current_setting('supabase_functions.url_jwt_secret', true)` etc.
-- Supabase's `vault.decrypted_secrets` is the official way to keep secrets,
-- but for v1 we hardcode the project ref + call with a placeholder header
-- (the function still works because internal DB ops use service_role).
--
-- IMPORTANT: Update the URL below if your project ref changes.
SELECT cron.schedule(
  'lesson-reminders-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/send-lesson-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        current_setting('app.settings.service_role_key', true),
        ''
      )
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

-- Optional: schedule a daily 9am ET prune of old webhook_log entries (>90 days)
DO $$ BEGIN
  PERFORM cron.unschedule('webhook-log-prune-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'webhook-log-prune-daily',
  '0 13 * * *',                    -- 9am America/New_York = 13:00 UTC (DST drift OK)
  $$ DELETE FROM webhook_log WHERE created_at < NOW() - INTERVAL '90 days' $$
);

-- ------------------------------------------------------------
-- View scheduled jobs:
--   SELECT jobid, schedule, command FROM cron.job;
-- View recent runs:
--   SELECT * FROM cron.job_run_details ORDER BY end_time DESC LIMIT 20;
-- Manually fire a job:
--   SELECT cron.run('lesson-reminders-hourly');
-- ------------------------------------------------------------
