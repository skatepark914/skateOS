-- ============================================================
-- 027_lesson_no_shows.sql — auto-mark lesson no-shows
--
-- Lessons that have started 30+ minutes ago AND were never marked
-- attended (no `attended_at` from migration 022's auto-stamp on
-- check-in, and no manual mark on the lesson page) get flipped from
-- 'scheduled' → 'no_show'.
--
-- Why this matters:
--   * Instructor pay needs to know which lessons actually happened
--   * Reports / attendance rates get accurate
--   * Front desk can see "Skater no-show'd 3x in 60 days" in customer
--     detail and gate further bookings if Doug wants
--   * Punch-card lessons should not double-deduct on no-show retries
--
-- Status enum already has 'no_show' (from 001_init.sql line 195).
-- We add: an idempotent RPC + a 15-min pg_cron schedule.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- RPC: scan lessons in the no-show window and flip status atomically.
-- Returns the count of lessons that were flipped.
CREATE OR REPLACE FUNCTION mark_lesson_no_shows(p_window_min INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  flipped INT;
BEGIN
  IF p_window_min IS NULL OR p_window_min < 0 THEN
    p_window_min := 30;
  END IF;

  -- 1. Flip the parent lesson rows — applies to both solo and group lessons.
  --    Solo lessons use lessons.attended_at as the truth.
  --    Group lessons use lesson_attendees rows (flipped in step 2 below);
  --    we still mark the parent row so reports keep working uniformly.
  WITH updated AS (
    UPDATE lessons
       SET status = 'no_show',
           updated_at = NOW()
     WHERE status = 'scheduled'
       AND attended_at IS NULL
       AND scheduled_at IS NOT NULL
       AND scheduled_at < NOW() - (p_window_min || ' minutes')::INTERVAL
       -- Don't flip really old ones — those probably mean the lesson
       -- happened but no one logged it. 7-day cutoff keeps the surface
       -- area small and means a stale row doesn't suddenly flip months later.
       AND scheduled_at > NOW() - INTERVAL '7 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO flipped FROM updated;

  -- 2. For group lessons (migration 032), also flip individual attendee rows
  --    that are still 'booked'. Skips silently if the table doesn't exist yet.
  BEGIN
    UPDATE lesson_attendees a
       SET status = 'no_show'
      FROM lessons l
     WHERE a.lesson_id = l.id
       AND a.status = 'booked'
       AND l.scheduled_at IS NOT NULL
       AND l.scheduled_at < NOW() - (p_window_min || ' minutes')::INTERVAL
       AND l.scheduled_at > NOW() - INTERVAL '7 days';
  EXCEPTION WHEN undefined_table THEN
    -- migration 032 not applied yet — group support disabled, fine.
    NULL;
  END;

  RETURN flipped;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_lesson_no_shows(INT) TO authenticated, anon;

-- Useful index for the scan
CREATE INDEX IF NOT EXISTS idx_lessons_scheduled_status
  ON lessons(scheduled_at, status)
  WHERE status = 'scheduled';

-- ------------------------------------------------------------
-- pg_cron: run every 15 minutes
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Drop any prior schedule with the same name so this migration is idempotent
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mark-lesson-no-shows-15min') THEN
      PERFORM cron.unschedule('mark-lesson-no-shows-15min');
    END IF;
    PERFORM cron.schedule(
      'mark-lesson-no-shows-15min',
      '*/15 * * * *',
      $cmd$ SELECT mark_lesson_no_shows(30); $cmd$
    );
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Inspection:
--   SELECT * FROM cron.job WHERE jobname = 'mark-lesson-no-shows-15min';
--   SELECT * FROM cron.job_run_details WHERE jobname = 'mark-lesson-no-shows-15min'
--     ORDER BY end_time DESC LIMIT 10;
