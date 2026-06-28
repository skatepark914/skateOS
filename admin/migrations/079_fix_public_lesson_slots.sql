-- ============================================================
-- 079_fix_public_lesson_slots.sql
--
-- Migration 056 had an "ambiguous column reference" bug: the local
-- variable `duration_min` conflicts with the `lessons.duration_min`
-- column in the conflict-check sub-query. The RPC errored at runtime
-- with: 'column reference "duration_min" is ambiguous'.
--
-- Fix: alias the `lessons` table and explicitly qualify the column.
-- Also rename the local variable to `_dur_min` to remove the conflict.
--
-- Idempotent (replaces the function).
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
  _dur_min INT;
  slot_start TIMESTAMPTZ;
  slot_end TIMESTAMPTZ;
  is_closed BOOLEAN;
  conflict_count INT;
  day_slots JSONB;
  hr_iter INT;
BEGIN
  IF p_days_forward IS NULL OR p_days_forward < 1 OR p_days_forward > 60 THEN
    p_days_forward := 14;
  END IF;

  _dur_min := CASE LOWER(COALESCE(p_lesson_type, 'private'))
    WHEN 'private'  THEN 60
    WHEN 'group'    THEN 90
    WHEN 'camp'     THEN 180
    WHEN 'event'    THEN 120
    WHEN 'birthday' THEN 120
    ELSE 60
  END;

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

    -- Emergency closure
    IF NOT is_closed AND s ? 'emergencyClose'
       AND COALESCE((s->'emergencyClose'->>'active')::boolean, FALSE) THEN
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
      WHILE hr_iter + (_dur_min/60) <= close_hour LOOP
        slot_start := (cursor_date::TEXT || ' ' || LPAD(hr_iter::TEXT, 2, '0') || ':00:00 America/New_York')::TIMESTAMPTZ;
        slot_end := slot_start + (_dur_min || ' minutes')::INTERVAL;

        IF slot_start > NOW() THEN
          -- Qualified `l.duration_min` removes the ambiguity (was the bug in mig 056)
          SELECT COUNT(*) INTO conflict_count
          FROM lessons l
          WHERE l.instructor = p_instructor
            AND l.status NOT IN ('cancelled', 'no_show')
            AND l.scheduled_at < slot_end
            AND l.scheduled_at + (COALESCE(l.duration_min, 60) || ' minutes')::INTERVAL > slot_start;

          IF conflict_count = 0 THEN
            day_slots := day_slots || jsonb_build_object(
              'iso',          slot_start,
              'time_label',   to_char(slot_start AT TIME ZONE 'America/New_York', 'FMHH12:MIam'),
              'duration_min', _dur_min
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
    'instructor',   p_instructor,
    'lesson_type',  p_lesson_type,
    'duration_min', _dur_min,
    'days',         result
  );
END $$;

GRANT EXECUTE ON FUNCTION public_lesson_slots(TEXT, TEXT, INT) TO anon, authenticated;

------------------------------------------------------------
-- public_book_lesson — anon-callable booking RPC.
-- Inserts a lesson server-side (bypasses RLS via SECURITY DEFINER).
-- Re-validates the slot is still open at insert time so two
-- customers racing for the same slot can't double-book.
-- Returns { ok, lesson_id, confirmation }.
------------------------------------------------------------
DROP FUNCTION IF EXISTS public_book_lesson(TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, INT);
CREATE OR REPLACE FUNCTION public_book_lesson(
  p_instructor   TEXT,
  p_lesson_type  TEXT,
  p_slot_iso     TIMESTAMPTZ,
  p_skater_name  TEXT,
  p_skater_email TEXT,
  p_skater_phone TEXT,
  p_parent_name  TEXT DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL,
  p_duration_min INT  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _dur_min INT;
  conflict_count INT;
  _slot_end TIMESTAMPTZ;
  _lesson_id UUID;
  _customer_id UUID;
BEGIN
  -- Validate inputs
  IF p_instructor IS NULL OR p_instructor = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing instructor');
  END IF;
  IF p_slot_iso IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing slot time');
  END IF;
  IF p_slot_iso < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Slot is in the past');
  END IF;
  IF p_skater_name IS NULL OR p_skater_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing skater name');
  END IF;
  IF (p_skater_email IS NULL OR p_skater_email = '')
     AND (p_skater_phone IS NULL OR p_skater_phone = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Need at least email or phone');
  END IF;

  _dur_min := COALESCE(p_duration_min,
    CASE LOWER(COALESCE(p_lesson_type, 'private'))
      WHEN 'private'  THEN 60
      WHEN 'group'    THEN 90
      WHEN 'camp'     THEN 180
      WHEN 'event'    THEN 120
      WHEN 'birthday' THEN 120
      ELSE 60
    END);

  _slot_end := p_slot_iso + (_dur_min || ' minutes')::INTERVAL;

  -- Re-validate slot is still open (race-safe at insert time)
  SELECT COUNT(*) INTO conflict_count
  FROM lessons l
  WHERE l.instructor = p_instructor
    AND l.status NOT IN ('cancelled', 'no_show')
    AND l.scheduled_at < _slot_end
    AND l.scheduled_at + (COALESCE(l.duration_min, 60) || ' minutes')::INTERVAL > p_slot_iso;
  IF conflict_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Slot was just taken — pick another time');
  END IF;

  -- Find or create customer
  SELECT id INTO _customer_id
  FROM customers
  WHERE (p_skater_email IS NOT NULL AND p_skater_email <> '' AND LOWER(email) = LOWER(p_skater_email))
     OR (p_skater_phone IS NOT NULL AND p_skater_phone <> '' AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_skater_phone, '\D', '', 'g'))
  ORDER BY created_at DESC
  LIMIT 1;

  IF _customer_id IS NULL THEN
    INSERT INTO customers (first_name, email, phone, parent_name, notes)
    VALUES (
      p_skater_name,
      NULLIF(p_skater_email, ''),
      NULLIF(p_skater_phone, ''),
      NULLIF(p_parent_name, ''),
      '[Online booking ' || to_char(NOW(), 'YYYY-MM-DD') || ']'
    )
    RETURNING id INTO _customer_id;
  END IF;

  -- Insert the lesson
  INSERT INTO lessons (
    customer_id, instructor, type, scheduled_at, duration_min, status, notes
  ) VALUES (
    _customer_id,
    p_instructor,
    COALESCE(p_lesson_type, 'private'),
    p_slot_iso,
    _dur_min,
    'scheduled',
    '[Online booking] ' || COALESCE(NULLIF(p_notes, ''), '')
  )
  RETURNING id INTO _lesson_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'lesson_id',    _lesson_id,
    'customer_id',  _customer_id,
    'confirmation', UPPER(SUBSTRING(_lesson_id::TEXT, 1, 8))
  );
END $$;

GRANT EXECUTE ON FUNCTION public_book_lesson(TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, INT)
  TO anon, authenticated;

DO $$ BEGIN
  RAISE NOTICE '079 fix: public_lesson_slots ambiguity fixed, public_book_lesson added';
END $$;
