-- ============================================================
-- 040_overdue_rental_reminders.sql — auto-email overdue rentals
--
-- Pairs with the `send-overdue-rentals` Edge Function. Daily cron
-- sweeps open `equipment_loans` rows where `due_at < now()` and
-- `returned_at IS NULL`, emails the customer asking them to bring
-- the gear back, and stamps `overdue_reminder_sent_at` so the same
-- loan doesn't get pinged twice in the same calendar day.
--
-- The stamp is a TIMESTAMPTZ — the cron only re-emails when more
-- than 24h has passed since the last stamp, so a stuck-out helmet
-- gets a daily reminder until it's returned (or owner manually
-- resets the stamp via SQL).
--
-- Owner-tunable via `app_settings` key='overdue_rentals' (JSONB):
--   {
--     enabled:     true,
--     grace_hours: 0,            -- skip until N hours past due
--     min_gap_h:   23,           -- min hours between reminders for same loan
--     subject:     "...",
--     body_html:   ""            -- empty = built-in template
--   }
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE equipment_loans
  ADD COLUMN IF NOT EXISTS overdue_reminder_sent_at TIMESTAMPTZ;

-- Partial index for the cron's lookup pattern
CREATE INDEX IF NOT EXISTS idx_loans_overdue_pending
  ON equipment_loans (due_at)
  WHERE returned_at IS NULL AND due_at IS NOT NULL;

-- pg_cron schedule: daily at 15:00 UTC (~11am ET). Same pattern as 016 / 033 / 038 / 039.
DO $$
DECLARE
  fn_url TEXT;
  svc_key TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping overdue-rental schedule';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed — skipping overdue-rental schedule';
    RETURN;
  END IF;

  BEGIN
    fn_url  := current_setting('app.settings.supabase_url') || '/functions/v1/send-overdue-rentals';
    svc_key := current_setting('app.settings.service_role_key');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'app.settings.supabase_url/service_role_key not configured — see migration 016 footer';
    RETURN;
  END;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'overdue-rentals-daily') THEN
    PERFORM cron.unschedule('overdue-rentals-daily');
  END IF;
  PERFORM cron.schedule(
    'overdue-rentals-daily',
    '0 15 * * *',
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
--   SELECT id, customer_name, due_at, overdue_reminder_sent_at
--     FROM equipment_loans
--    WHERE returned_at IS NULL AND due_at < NOW()
--    ORDER BY due_at ASC LIMIT 20;
