-- ============================================================
-- 038_lesson_followups.sql — post-lesson follow-up tracking
--
-- Pairs with the `send-lesson-followups` Edge Function. After a
-- lesson is marked attended/completed, a daily cron emails the
-- skater (or guardian for minors) a one-shot:
--   • "How was your lesson? Leave a Google review"
--   • Optional "Tip your instructor — Venmo/CashApp link"
--
-- Idempotency: stamp `lessons.followup_sent_at` after the email
-- lands so re-runs the same week skip already-followed-up rows.
--
-- Owner-tunable via `app_settings` key='followups':
--   {
--     enabled: true,
--     review_url: "https://g.page/r/.../review",
--     tip_enabled: true,
--     tip_url:    "https://venmo.com/u/2ndnature-park",
--     window_min_h: 2,        -- earliest hours after attended_at
--     window_max_h: 48,       -- latest hours after attended_at
--     subject:      "...",    -- optional template; {{first}} {{biz}}
--     body_html:    "...",    -- optional template
--     min_lesson_price: 0     -- skip free lessons (0 = include all)
--   }
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS followup_sent_at TIMESTAMPTZ;

-- Index just for the cron's lookup pattern (recently-attended, not-yet-followed-up).
-- Partial index keeps it tiny — only rows that need the cron's attention.
CREATE INDEX IF NOT EXISTS idx_lessons_followup_pending
  ON lessons (attended_at)
  WHERE attended_at IS NOT NULL AND followup_sent_at IS NULL;

-- pg_cron schedule: every hour at :15 past, calls the Edge Function via pg_net.
-- Same pattern as migration 016 (lesson reminders) and 033 (birthday greetings).
-- Requires database settings `app.settings.supabase_url` + `service_role_key`
-- (see migration 016 footer for the one-time setup).
DO $$
DECLARE
  fn_url TEXT;
  svc_key TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping lesson-followups schedule';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed — skipping lesson-followups schedule';
    RETURN;
  END IF;

  BEGIN
    fn_url  := current_setting('app.settings.supabase_url') || '/functions/v1/send-lesson-followups';
    svc_key := current_setting('app.settings.service_role_key');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'app.settings.supabase_url/service_role_key not configured — see migration 016 footer';
    RETURN;
  END;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lesson-followups-hourly') THEN
    PERFORM cron.unschedule('lesson-followups-hourly');
  END IF;
  PERFORM cron.schedule(
    'lesson-followups-hourly',
    '15 * * * *',
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
--   SELECT * FROM cron.job WHERE jobname = 'lesson-followups-hourly';
--   SELECT * FROM cron.job_run_details WHERE jobname = 'lesson-followups-hourly'
--     ORDER BY end_time DESC LIMIT 10;
--   SELECT id, scheduled_at, attended_at, followup_sent_at FROM lessons
--    WHERE attended_at > now() - interval '7 days' ORDER BY attended_at DESC;
