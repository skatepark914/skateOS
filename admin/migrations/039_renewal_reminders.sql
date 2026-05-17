-- ============================================================
-- 039_renewal_reminders.sql — membership expiry renewal nudge
--
-- Pairs with the `send-renewal-reminders` Edge Function. Daily cron
-- sweeps active subscriptions whose end_date is within the configured
-- lead window (default 14 days) and emails the customer asking them
-- to renew before it lapses. Each row gets stamped on success so the
-- same membership doesn't get pinged twice in the same window.
--
-- Owner-tunable via `app_settings` key='renewal_reminders' (JSONB):
--   {
--     enabled:       true,
--     lead_days:     14,    -- send when end_date is within N days
--     min_days:      1,     -- skip if expired (already past — let lapsed flow handle)
--     plan_types:    ["monthly","annual","punch_card"], -- which kinds get nudged
--     subject:       "{{biz}} membership expiring soon",
--     body_html:     "..."  -- empty = built-in template
--   }
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS renewal_reminder_sent_at TIMESTAMPTZ;

-- Partial index for the cron's lookup pattern: only active subs that haven't
-- been reminded yet AND have an end_date.
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal_pending
  ON subscriptions (end_date)
  WHERE status = 'active'
    AND end_date IS NOT NULL
    AND renewal_reminder_sent_at IS NULL;

-- pg_cron schedule: daily at 14:00 UTC (~10am ET). Same pattern as
-- migrations 016 (lesson reminders), 033 (birthdays), 038 (followups).
DO $$
DECLARE
  fn_url TEXT;
  svc_key TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping renewal-reminders schedule';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed — skipping renewal-reminders schedule';
    RETURN;
  END IF;

  BEGIN
    fn_url  := current_setting('app.settings.supabase_url') || '/functions/v1/send-renewal-reminders';
    svc_key := current_setting('app.settings.service_role_key');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'app.settings.supabase_url/service_role_key not configured — see migration 016 footer';
    RETURN;
  END;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'renewal-reminders-daily') THEN
    PERFORM cron.unschedule('renewal-reminders-daily');
  END IF;
  PERFORM cron.schedule(
    'renewal-reminders-daily',
    '0 14 * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
        body := '{}'::jsonb
      );
    $cmd$, fn_url, svc_key)
  );
END $$;

-- Inspection:
--   SELECT id, plan_name, end_date, renewal_reminder_sent_at
--     FROM subscriptions
--    WHERE status='active' AND end_date IS NOT NULL
--    ORDER BY end_date ASC LIMIT 20;
--
--   SELECT * FROM cron.job_run_details WHERE jobname = 'renewal-reminders-daily'
--     ORDER BY end_time DESC LIMIT 10;
