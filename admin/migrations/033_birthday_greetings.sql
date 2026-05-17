-- ============================================================
-- 033_birthday_greetings.sql — daily birthday email + idempotency stamp
--
-- Adds the column the birthday-greetings Edge Function uses to skip
-- already-greeted customers within a day, and schedules pg_cron to
-- fire it once daily at 13:00 UTC (~9am ET).
--
-- The Edge Function itself (supabase/functions/birthday-greetings)
-- gracefully handles missing column — until this migration runs, it
-- just sends every time without dedupe.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS last_birthday_email_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_dob_mmdd
  ON customers ((to_char(dob, 'MM-DD')))
  WHERE dob IS NOT NULL;

-- pg_cron: run daily at 13:00 UTC (~9am ET / 6am PT)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'birthday-greetings-daily') THEN
      PERFORM cron.unschedule('birthday-greetings-daily');
    END IF;
    -- pg_net.http_post fires the Edge Function with the service-role JWT.
    -- Adjust the URL to your project ref. The service-role Authorization
    -- is read by the function from `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`.
    PERFORM cron.schedule(
      'birthday-greetings-daily',
      '0 13 * * *',
      $cmd$
        SELECT net.http_post(
          url := current_setting('app.settings.supabase_url', true) || '/functions/v1/birthday-greetings',
          headers := jsonb_build_object(
            'Content-Type','application/json',
            'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)
          ),
          body := '{}'::jsonb
        );
      $cmd$
    );
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Inspection:
--   SELECT * FROM cron.job WHERE jobname = 'birthday-greetings-daily';
--   SELECT * FROM cron.job_run_details WHERE jobname = 'birthday-greetings-daily'
--     ORDER BY end_time DESC LIMIT 10;
--
-- IF pg_net call fails with "missing setting", set the per-database settings:
--   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://zecurmlenxyxanqucrga.supabase.co';
--   ALTER DATABASE postgres SET app.settings.service_role_key = 'eyJhbGc...';
-- (Same pattern as migration 016 for lesson-reminders.)
