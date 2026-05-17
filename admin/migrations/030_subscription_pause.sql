-- ============================================================
-- 030_subscription_pause.sql — pause/resume support for memberships
--
-- Common scenarios:
--   * Skater on vacation, asks to skip a billing cycle
--   * Skater breaks an arm, freezes for 6 weeks
--   * Family pulls out for the season
--
-- Schema already has 'paused' status (from 001_init.sql line 158) but
-- no way to track "until when" — so the resume was always manual. This
-- adds `paused_until DATE` so a future billing cron can auto-resume.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS paused_until DATE;

-- Helper view (optional — useful for cron / reports):
-- subscriptions whose pause has expired and should be auto-resumed.
CREATE OR REPLACE VIEW subscriptions_due_to_resume AS
  SELECT *
  FROM subscriptions
  WHERE status = 'paused'
    AND paused_until IS NOT NULL
    AND paused_until <= CURRENT_DATE;

GRANT SELECT ON subscriptions_due_to_resume TO authenticated;

-- Index for the cron filter
CREATE INDEX IF NOT EXISTS idx_subs_paused_until
  ON subscriptions(paused_until)
  WHERE status = 'paused' AND paused_until IS NOT NULL;

-- ------------------------------------------------------------
-- Auto-resume RPC + pg_cron schedule: every morning, flip any
-- paused subscriptions whose paused_until has arrived back to active.
-- Stamps a note onto subscriptions.notes so the audit trail stays clean.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_resume_paused_subs()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  flipped INT;
BEGIN
  WITH updated AS (
    UPDATE subscriptions
       SET status       = 'active',
           paused_until = NULL,
           notes        = COALESCE(notes||E'\n','') ||
                          '[Auto-resumed '||CURRENT_DATE||' (paused_until reached)]',
           updated_at   = NOW()
     WHERE status       = 'paused'
       AND paused_until IS NOT NULL
       AND paused_until <= CURRENT_DATE
    RETURNING id
  )
  SELECT COUNT(*) INTO flipped FROM updated;
  RETURN flipped;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_resume_paused_subs() TO authenticated;

-- pg_cron: run daily at 06:00 UTC (~2am ET / 11pm PT). Clears overnight.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-resume-subs-daily') THEN
      PERFORM cron.unschedule('auto-resume-subs-daily');
    END IF;
    PERFORM cron.schedule(
      'auto-resume-subs-daily',
      '0 6 * * *',
      $cmd$ SELECT auto_resume_paused_subs(); $cmd$
    );
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
