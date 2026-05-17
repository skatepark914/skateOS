-- ============================================================
-- 047_preorder_weekly_cron.sql — schedule the weekly pre-order digest
--
-- The Edge Function `weekly-preorder-digest` rolls up every preorder-2026
-- submission from the prior week into a supplier-order email for Doug.
-- This migration schedules it via pg_cron to fire shortly after the Sunday
-- midnight ET cutoff.
--
-- Schedule: Mon 5:00 UTC = Sun midnight EST OR Mon 1am EDT — both fire AFTER
-- Sunday-midnight ET cutoff so the digest captures the full week's submissions.
-- pg_cron runs UTC-only; this is the cleanest cross-DST-safe time.
--
-- Setup:
--   1. Apply this migration: paste into Supabase SQL editor → Run
--   2. Set the two GUC params (one-time per database):
--        ALTER DATABASE postgres SET app.settings.supabase_url   = 'https://zecurmlenxyxanqucrga.supabase.co';
--        ALTER DATABASE postgres SET app.settings.service_role_key = 'eyJhbGc...';
--      (Skip this step if migration 016 already set them — they're shared.)
--   3. Deploy the Edge Function: bash admin/deploy-functions.sh
--
-- Manual fire (for testing or off-cycle digests):
--   curl -X POST https://zecurmlenxyxanqucrga.supabase.co/functions/v1/weekly-preorder-digest \
--     -H "Authorization: Bearer <service-role>" \
--     -d '{"window_days": 7}'
--
-- Inspect cron run history:
--   SELECT * FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'weekly-preorder-digest')
--   ORDER BY end_time DESC LIMIT 10;
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Required extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any prior version of this job before re-creating, so
-- re-running the migration doesn't pile up duplicate schedules.
DO $$ BEGIN
  PERFORM cron.unschedule('weekly-preorder-digest');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Schedule: Monday 05:00 UTC (every week)
SELECT cron.schedule(
  'weekly-preorder-digest',
  '0 5 * * 1',
  $$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/weekly-preorder-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('window_days', 7)
    ) AS request_id;
  $$
);

-- Sanity check: verify the schedule landed
DO $$
DECLARE jid BIGINT;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'weekly-preorder-digest';
  IF jid IS NULL THEN
    RAISE NOTICE 'WARNING: weekly-preorder-digest schedule did not land. Check pg_cron extension is enabled.';
  ELSE
    RAISE NOTICE 'Scheduled weekly-preorder-digest (jobid=%) for Monday 05:00 UTC', jid;
  END IF;
END $$;
