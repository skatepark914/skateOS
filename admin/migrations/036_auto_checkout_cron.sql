-- ============================================================
-- 036_auto_checkout_cron.sql — close lingering check-ins overnight
--
-- Real ops gap: front desk forgets to "End session" on stragglers,
-- so Monday morning the in-park grid is full of Sunday's open rows.
-- The mass-close button (shipped earlier) helps when staff remembers
-- — this is the safety net for when they don't.
--
-- Daily cron at 08:00 UTC (~3am ET / midnight PT — well past park close)
-- closes any checkins row open longer than the configured threshold
-- (default 8 hours). Stamps a small note so the audit trail explains
-- the auto-close.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Add notes column for the audit stamp (nullable; legacy rows untouched)
ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- RPC: close any check-in older than p_threshold_min minutes that's still open.
-- Returns the count flipped. Manual-callable too — the admin gets a button.
CREATE OR REPLACE FUNCTION auto_checkout_lingering(p_threshold_min INT DEFAULT 480)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  flipped INT;
BEGIN
  IF p_threshold_min IS NULL OR p_threshold_min < 30 THEN
    p_threshold_min := 480;  -- 8h default; never below 30 min for safety
  END IF;
  WITH updated AS (
    UPDATE checkins
       SET checked_out_at = NOW(),
           notes = COALESCE(notes||E'\n','') || '[Auto-closed at park-close cron — was open '||
                   ROUND(EXTRACT(EPOCH FROM (NOW() - checked_in_at))/60)||' min]'
     WHERE checked_out_at IS NULL
       AND checked_in_at < NOW() - (p_threshold_min || ' minutes')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*) INTO flipped FROM updated;
  RETURN flipped;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_checkout_lingering(INT) TO authenticated;

-- pg_cron: run daily at 08:00 UTC (~3am ET / midnight PT)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-checkout-lingering-daily') THEN
      PERFORM cron.unschedule('auto-checkout-lingering-daily');
    END IF;
    PERFORM cron.schedule(
      'auto-checkout-lingering-daily',
      '0 8 * * *',
      $cmd$ SELECT auto_checkout_lingering(480); $cmd$
    );
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Inspection:
--   SELECT * FROM cron.job WHERE jobname = 'auto-checkout-lingering-daily';
--   SELECT * FROM cron.job_run_details WHERE jobname = 'auto-checkout-lingering-daily'
--     ORDER BY end_time DESC LIMIT 10;
