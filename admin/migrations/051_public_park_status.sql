-- ============================================================
-- 051_public_park_status.sql — public "is the park open?" RPC
--
-- Customer-facing status page (admin/park-status.html) needs to know:
--   • Are we open right now?
--   • What are today's hours?
--   • Is there an emergency closure in effect?
--   • How crowded is it right now (vs capacity)?
--
-- Without this RPC anon can't read app_settings (staff-only RLS) or
-- checkins (would expose PII). The RPC returns a strict whitelist that's
-- safe to share publicly + GRANTed to anon.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public_park_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s JSONB;
  hr JSONB;
  emergency JSONB;
  holidays JSONB;
  today_dow_name TEXT;
  today_iso TEXT;
  open_checkin_count INT;
  max_capacity INT;
  is_open BOOLEAN := FALSE;
  is_closed_today BOOLEAN := FALSE;
  is_emergency BOOLEAN := FALSE;
  closing_time TEXT;
  opening_time TEXT;
  status_label TEXT := 'open';
  emergency_reason TEXT;
  emergency_until TEXT;
  match_holiday TEXT;
BEGIN
  -- Pull the full settings blob
  SELECT value INTO s FROM app_settings WHERE key = 'all' LIMIT 1;
  IF s IS NULL THEN s := '{}'::jsonb; END IF;

  -- Today's day-of-week name (sun/mon/tue/wed/thu/fri/sat) in ET
  -- Postgres' to_char + AT TIME ZONE handles tz cleanly across DST.
  today_dow_name := LOWER(to_char(NOW() AT TIME ZONE 'America/New_York', 'dy'));
  today_iso := to_char(NOW() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD');

  -- Today's hours (could be null if closed)
  hr := s -> 'hours' -> today_dow_name;
  IF hr IS NULL THEN
    is_closed_today := TRUE;
  END IF;

  -- Holiday closures override the DOW schedule
  holidays := s -> 'holidays';
  IF holidays IS NOT NULL AND jsonb_typeof(holidays) = 'array' THEN
    SELECT (h->>'name') INTO match_holiday
    FROM jsonb_array_elements(holidays) AS h
    WHERE (h->>'date') = today_iso
       OR (h->>'date') = SUBSTRING(today_iso FROM 6)  -- MM-DD recurring
    LIMIT 1;
    IF match_holiday IS NOT NULL THEN
      is_closed_today := TRUE;
    END IF;
  END IF;

  -- Emergency closure flag — overrides everything when active + not yet expired
  emergency := s -> 'emergencyClose';
  IF emergency IS NOT NULL AND COALESCE((emergency->>'active')::boolean, FALSE) THEN
    DECLARE until_ts TIMESTAMPTZ;
    BEGIN
      until_ts := NULLIF(emergency->>'until_iso','')::TIMESTAMPTZ;
      IF until_ts IS NULL OR until_ts > NOW() THEN
        is_emergency := TRUE;
        emergency_reason := emergency->>'reason';
        emergency_until := emergency->>'until_iso';
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Determine current open/closed status
  IF is_emergency THEN
    is_open := FALSE;
    status_label := 'emergency_closed';
  ELSIF is_closed_today THEN
    is_open := FALSE;
    status_label := 'closed_today';
  ELSIF hr IS NOT NULL THEN
    opening_time := hr->>'open';
    closing_time := hr->>'close';
    -- Is current ET time within [open, close)?
    DECLARE cur_time TEXT;
    BEGIN
      cur_time := to_char(NOW() AT TIME ZONE 'America/New_York', 'HH24:MI');
      IF opening_time IS NOT NULL AND closing_time IS NOT NULL THEN
        IF cur_time >= opening_time AND cur_time < closing_time THEN
          is_open := TRUE;
          status_label := 'open';
        ELSIF cur_time < opening_time THEN
          is_open := FALSE;
          status_label := 'opens_later';
        ELSE
          is_open := FALSE;
          status_label := 'closed_for_today';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Park capacity — current open checkin count vs configured max
  max_capacity := COALESCE((s->>'maxCapacity')::int, 0);
  SELECT COUNT(*) INTO open_checkin_count
    FROM checkins
    WHERE checked_out_at IS NULL;

  -- Build the public-safe response
  RETURN jsonb_build_object(
    'is_open',          is_open,
    'status',           status_label,
    'today_dow',        today_dow_name,
    'today_date',       today_iso,
    'today_open',       opening_time,
    'today_close',      closing_time,
    'is_closed_today',  is_closed_today,
    'holiday_name',     match_holiday,
    'emergency',        is_emergency,
    'emergency_reason', emergency_reason,
    'emergency_until',  emergency_until,
    'capacity_current', open_checkin_count,
    'capacity_max',     max_capacity,
    'biz_name',         COALESCE(s->>'bizName', '2nd Nature Park'),
    'biz_phone',        s->>'bizPhone',
    'biz_addr',         s->>'bizAddr',
    -- Full week's hours so the page can show "open Mon-Sun"
    'hours',            COALESCE(s->'hours', '{}'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION public_park_status() TO anon, authenticated;
