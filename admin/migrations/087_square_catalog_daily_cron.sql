-- 087_square_catalog_daily_cron.sql
-- ============================================================
-- Daily full CATALOG + INVENTORY sync via square-import.
-- Complements 083 (which only syncs sales + bookings). This keeps
-- price changes, stock levels, and brand-new items flowing from
-- Square automatically — closing the catalog-parity gap.
--
-- chunk=2000 processes the whole catalog in one invocation; the
-- upsert path is fast and finishes well under the 150s edge limit.
-- Idempotent (upsert on square_catalog_id).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN PERFORM cron.unschedule('square-catalog-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 4:30am ET (08:30 UTC) — fully off-hours, before the sales/bookings crons
SELECT cron.schedule(
  'square-catalog-daily',
  '30 8 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/square-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
    ),
    body    := jsonb_build_object(
      'action', 'commit',
      'what',   'products',
      'offset', 0,
      'chunk',  2000
    ),
    timeout_milliseconds := 150000
  ) AS request_id;
  $$
);

DO $$ BEGIN RAISE NOTICE '087 applied: daily Square catalog + inventory sync scheduled (4:30am ET)'; END $$;
