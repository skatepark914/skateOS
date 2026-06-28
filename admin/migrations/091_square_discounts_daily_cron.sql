-- ============================================================
-- 091_square_discounts_daily_cron.sql
--
-- Daily sync of Square's DISCOUNT catalog → promo_codes.
-- Runs at 5:00am ET (09:00 UTC) — after catalog sync (4:30am
-- ET) finishes, before sales/bookings (6am ET).
--
-- New codes Doug creates in Square (via Square Dashboard or
-- the iPad POS) auto-flow into skateOS overnight.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN PERFORM cron.unschedule('square-discounts-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'square-discounts-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/square-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object('what', 'discounts')
  );
  $$
);

DO $$ BEGIN
  RAISE NOTICE '091 applied: square-discounts-daily cron @ 5am ET';
END $$;
