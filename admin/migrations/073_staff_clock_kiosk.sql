-- 073_staff_clock_kiosk.sql — staff self-clock-in from a shared iPad kiosk.
--
-- Why:
--   Mig 008's timesheet_clock_in/_out RPCs require a JWT — they assume the
--   logged-in user IS the staff member. That works for the owner using
--   admin/index.html, but not for a shared "front desk iPad kiosk" where
--   each staff member walks up + taps their name to clock in/out.
--
-- New RPCs:
--   staff_kiosk_list()                 → anon-readable name + photo + state
--   staff_kiosk_clock_in(p_staff_id)   → opens a time_entries row
--   staff_kiosk_clock_out(p_staff_id)  → closes the open time_entries row
--
-- Security model (v1): anon-callable. The risk is a stranger checking the
-- iPad at the front desk + clocking someone in/out for kicks. Mitigations:
--   1. Front-desk iPad lives behind the counter — physical access control.
--   2. Every action is audit-stamped into time_entries.notes with timestamp.
--   3. Owner reviews timesheets weekly + can correct anomalies.
--
-- v1.5 will add an optional 4-digit PIN per staff for extra friction.

-- Drop auth.users FK on staff.id so we can have kiosk-only staff (no admin login)
-- Original constraint: staff_id_fkey REFERENCES auth.users(id) ON DELETE CASCADE
-- Kiosk staff (front desk hourly, instructors) just clock in/out; only owner needs auth login.
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_id_fkey;
-- Make email nullable too — kiosk-only staff don't need email
ALTER TABLE staff ALTER COLUMN email DROP NOT NULL;
-- Make sure id has a default if it didn't already
ALTER TABLE staff ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Public listing — only returns active staff with display_name. Excludes
-- email/phone/private fields so anyone with the URL can't harvest contact info.
CREATE OR REPLACE FUNCTION staff_kiosk_list()
RETURNS TABLE (
  staff_id     UUID,
  display_name TEXT,
  role         TEXT,
  is_clocked_in BOOLEAN,
  clocked_in_at TIMESTAMPTZ,
  shift_type   TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.display_name,
    s.role::TEXT,
    (te.id IS NOT NULL) AS is_clocked_in,
    te.clock_in,
    COALESCE(te.shift_type::TEXT, NULL)
  FROM staff s
  LEFT JOIN LATERAL (
    SELECT id, clock_in, shift_type
    FROM time_entries
    WHERE staff_id = s.id
      AND clock_in IS NOT NULL
      AND clock_out IS NULL
    ORDER BY clock_in DESC
    LIMIT 1
  ) te ON true
  WHERE s.active = true OR s.active IS NULL
  ORDER BY s.display_name;
$$;
GRANT EXECUTE ON FUNCTION staff_kiosk_list() TO anon, authenticated;

-- Public clock-in
CREATE OR REPLACE FUNCTION staff_kiosk_clock_in(p_staff_id UUID, p_shift_type TEXT DEFAULT 'front_desk')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  open_id UUID;
  new_id  UUID;
  staff_name TEXT;
BEGIN
  SELECT display_name INTO staff_name FROM staff WHERE id = p_staff_id AND (active = true OR active IS NULL);
  IF staff_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Staff not found or inactive.');
  END IF;

  -- Already clocked in? Return current entry without creating another.
  SELECT id INTO open_id FROM time_entries
   WHERE staff_id = p_staff_id AND clock_in IS NOT NULL AND clock_out IS NULL
   ORDER BY clock_in DESC LIMIT 1;
  IF open_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_open', true, 'entry_id', open_id, 'staff_name', staff_name);
  END IF;

  INSERT INTO time_entries(staff_id, clock_in, created_by, shift_type, notes)
  VALUES (p_staff_id, NOW(), p_staff_id, p_shift_type::shift_type, 'Clocked in via front-desk kiosk')
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'entry_id', new_id, 'staff_name', staff_name);
END;
$$;
GRANT EXECUTE ON FUNCTION staff_kiosk_clock_in(UUID, TEXT) TO anon, authenticated;

-- Public clock-out
CREATE OR REPLACE FUNCTION staff_kiosk_clock_out(p_staff_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  open_id    UUID;
  staff_name TEXT;
  worked_min INT;
BEGIN
  SELECT display_name INTO staff_name FROM staff WHERE id = p_staff_id;
  IF staff_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Staff not found.');
  END IF;

  SELECT id INTO open_id FROM time_entries
   WHERE staff_id = p_staff_id AND clock_in IS NOT NULL AND clock_out IS NULL
   ORDER BY clock_in DESC LIMIT 1;

  IF open_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No open shift to close. Are you sure you clocked in?');
  END IF;

  UPDATE time_entries
     SET clock_out = NOW(),
         notes = COALESCE(notes,'') || ' / out via kiosk'
   WHERE id = open_id;

  SELECT EXTRACT(EPOCH FROM (NOW() - clock_in))/60 INTO worked_min FROM time_entries WHERE id = open_id;

  RETURN jsonb_build_object('ok', true, 'entry_id', open_id, 'staff_name', staff_name, 'minutes_worked', worked_min);
END;
$$;
GRANT EXECUTE ON FUNCTION staff_kiosk_clock_out(UUID) TO anon, authenticated;
