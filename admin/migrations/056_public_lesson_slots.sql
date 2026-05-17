-- ============================================================
-- 056_public_lesson_slots.sql — public lesson availability RPC
--
-- Phase 2 of Square Online replica: customer-facing lesson booking
-- at book.skateos.com needs to know which slots are open for a given
-- instructor on a given date.
--
-- The RPC:
--   • Returns available time slots for the requested instructor +
--     lesson type for the next N days
--   • Pulls today's hours from app_settings.hours
--   • Excludes hours when instructor has an existing non-cancelled
--     lesson (default 60-min collision window per slot)
--   • Excludes closed days (settings.holidays + DOW closed)
--   • Excludes emergency closure windows
--   • Returns whitelist-only public-safe fields (no PII / no admin notes)
--
-- Slot granularity: 60-min increments aligned to instructor schedule.
-- Lesson types steer default duration (private 60m / group 90m / camp 180m).
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public_lesson_slots(
  p_instructor TEXT,
  p_lesson_type TEXT DEFAULT 'private',
  p_days_forward INT DEFAULT 14
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s JSONB;
  hr JSONB;
  result JSONB := '[]'::jsonb;
  cursor_date DATE;
  end_date DATE;
  dow_name TEXT;
  open_hour INT;
  close_hour INT;
  duration_min INT;
  slot_start TIMESTAMPTZ;
  slot_end TIMESTAMPTZ;
  is_closed BOOLEAN;
  conflict_count INT;
  day_slots JSONB;
  hr_iter INT;
BEGIN
  IF p_days_forward IS NULL OR p_days_forward < 1 OR p_days_forward > 60 THEN p_days_forward := 14; END IF;

  -- Determine duration based on lesson type (matches mig 032 capacity defaults)
  duration_min := CASE LOWER(COALESCE(p_lesson_type, 'private'))
    WHEN 'private'  THEN 60
    WHEN 'group'    THEN 90
    WHEN 'camp'     THEN 180
    WHEN 'event'    THEN 120
    WHEN 'birthday' THEN 120
    ELSE 60
  END;

  -- Pull settings (need hours + holidays + emergency)
  SELECT value INTO s FROM app_settings WHERE key = 'all' LIMIT 1;
  IF s IS NULL THEN s := '{}'::jsonb; END IF;

  cursor_date := (NOW() AT TIME ZONE 'America/New_York')::DATE;
  end_date := cursor_date + p_days_forward;

  WHILE cursor_date <= end_date LOOP
    is_closed := FALSE;
    dow_name := LOWER(to_char(cursor_date, 'dy'));
    hr := s -> 'hours' -> dow_name;
    IF hr IS NULL THEN is_closed := TRUE; END IF;

    -- Holiday check
    IF NOT is_closed AND s ? 'holidays' AND jsonb_typeof(s->'holidays') = 'array' THEN
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s->'holidays') AS h
        WHERE (h->>'date') = to_char(cursor_date, 'YYYY-MM-DD')
           OR (h->>'date') = to_char(cursor_date, 'MM-DD')
      ) THEN
        is_closed := TRUE;
      END IF;
    END IF;

    -- Emergency closure that's still active = treat as closed
    IF NOT is_closed AND s ? 'emergencyClose' AND COALESCE((s->'emergencyClose'->>'active')::boolean, FALSE) THEN
      DECLARE until_ts TIMESTAMPTZ;
      BEGIN
        until_ts := NULLIF(s->'emergencyClose'->>'until_iso','')::TIMESTAMPTZ;
        IF until_ts IS NULL OR until_ts > cursor_date::TIMESTAMPTZ THEN
          is_closed := TRUE;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    day_slots := '[]'::jsonb;

    IF NOT is_closed AND hr IS NOT NULL THEN
      open_hour := SPLIT_PART(hr->>'open', ':', 1)::INT;
      close_hour := SPLIT_PART(hr->>'close', ':', 1)::INT;

      hr_iter := open_hour;
      WHILE hr_iter + (duration_min/60) <= close_hour LOOP
        slot_start := (cursor_date::TEXT || ' ' || LPAD(hr_iter::TEXT, 2, '0') || ':00:00 America/New_York')::TIMESTAMPTZ;
        slot_end := slot_start + (duration_min || ' minutes')::INTERVAL;

        -- Skip slots in the past (today's morning hours after current time)
        IF slot_start > NOW() THEN
          -- Check for instructor conflict
          SELECT COUNT(*) INTO conflict_count
          FROM lessons
          WHERE instructor = p_instructor
            AND status NOT IN ('cancelled', 'no_show')
            AND scheduled_at < slot_end
            AND scheduled_at + (COALESCE(duration_min, 60) || ' minutes')::INTERVAL > slot_start;

          IF conflict_count = 0 THEN
            day_slots := day_slots || jsonb_build_object(
              'iso',     slot_start,
              'time_label', to_char(slot_start AT TIME ZONE 'America/New_York', 'FMHH12:MIam'),
              'duration_min', duration_min
            );
          END IF;
        END IF;
        hr_iter := hr_iter + 1;
      END LOOP;
    END IF;

    result := result || jsonb_build_object(
      'date',      to_char(cursor_date, 'YYYY-MM-DD'),
      'dow',       to_char(cursor_date, 'FMDay'),
      'is_closed', is_closed,
      'slots',     day_slots
    );

    cursor_date := cursor_date + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'instructor',     p_instructor,
    'lesson_type',    p_lesson_type,
    'duration_min',   duration_min,
    'days',           result
  );
END $$;

GRANT EXECUTE ON FUNCTION public_lesson_slots(TEXT, TEXT, INT) TO anon, authenticated;

-- Public-readable list of active instructors (so the booking page can offer a dropdown)
CREATE OR REPLACE FUNCTION public_instructor_list()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           id,
    'display_name', display_name
  ) ORDER BY display_name), '[]'::jsonb)
  INTO result
  FROM staff
  WHERE active = TRUE
    AND role IN ('instructor', 'owner');
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public_instructor_list() TO anon, authenticated;
