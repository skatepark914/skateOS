-- ============================================================
-- 008_timesheets.sql — staff time tracking + payroll prep
--
-- Skate-shaped port of Branch Manager's payroll/timesheet pattern
-- (see _bm-reference/src-pages/payroll.js + _bm-reference/migrations/schema.sql).
--
-- Differences from BM:
--   - No `job_id` reference (skateOS has no job concept).
--   - Adds `shift_type` enum: front_desk / instructor / party / cleanup / admin / other.
--   - Approvals stored in a real Supabase table (`timesheet_approvals`),
--     not localStorage — so they survive across devices and sessions.
--   - Pay rate lives on the staff row.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extend staff_role enum to include instructor
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
                  WHERE enumtypid = 'staff_role'::regtype
                    AND enumlabel = 'instructor') THEN
    ALTER TYPE staff_role ADD VALUE 'instructor';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Extend staff table with payroll-relevant fields
-- ------------------------------------------------------------
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS pay_rate            NUMERIC(10,2),  -- hourly $
  ADD COLUMN IF NOT EXISTS phone               TEXT,
  ADD COLUMN IF NOT EXISTS weekly_hours_target INT;            -- target / "expected" hrs/wk

-- ------------------------------------------------------------
-- 3. shift_type enum
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_type') THEN
    CREATE TYPE shift_type AS ENUM ('front_desk','instructor','party','cleanup','admin','other');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. time_entries — append-only log of clock-ins / hour entries
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  shift_type   shift_type NOT NULL DEFAULT 'front_desk',
  entry_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  clock_in     TIMESTAMPTZ,           -- set when staff punches in
  clock_out    TIMESTAMPTZ,           -- set when staff punches out (or NULL = open)
  hours        NUMERIC(5,2),          -- computed from clock times OR entered directly for retroactive
  notes        TEXT,
  created_by   UUID REFERENCES staff(id),  -- who logged this entry (could differ from staff_id when owner adjusts)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_staff_date
  ON time_entries(staff_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_open_clockins
  ON time_entries(staff_id) WHERE clock_in IS NOT NULL AND clock_out IS NULL;

-- Auto-compute hours if both clock_in and clock_out set and hours not explicitly provided.
CREATE OR REPLACE FUNCTION time_entry_compute_hours() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clock_in IS NOT NULL AND NEW.clock_out IS NOT NULL THEN
    -- Always recompute on close-out so manual edits to clock times sync.
    NEW.hours := ROUND(EXTRACT(EPOCH FROM (NEW.clock_out - NEW.clock_in)) / 3600.0, 2);
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_time_entry_compute ON time_entries;
CREATE TRIGGER trg_time_entry_compute
  BEFORE INSERT OR UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION time_entry_compute_hours();

-- ------------------------------------------------------------
-- 5. timesheet_approvals — week-level + day-level approval records
--    Server-side replacement for BM's localStorage-backed approval map.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timesheet_approvals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('day','week')),
  scope_date   DATE NOT NULL,    -- entry_date for 'day', week_start (Mon) for 'week'
  approved_by  UUID NOT NULL REFERENCES staff(id),
  approved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_after BOOLEAN NOT NULL DEFAULT FALSE,
  notes        TEXT,
  UNIQUE (staff_id, scope, scope_date)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_approvals_staff
  ON timesheet_approvals(staff_id, scope, scope_date DESC);

-- If a time_entry is INSERT/UPDATE/DELETE'd after approval, mark the matching
-- day approval as `edited_after = TRUE` so the UI can flag "re-approval needed".
CREATE OR REPLACE FUNCTION timesheet_mark_edited_after() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  the_staff UUID;
  the_date  DATE;
  week_start DATE;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    the_staff := OLD.staff_id;
    the_date  := OLD.entry_date;
  ELSE
    the_staff := NEW.staff_id;
    the_date  := NEW.entry_date;
  END IF;

  -- Compute Monday of that week
  week_start := the_date - ((EXTRACT(DOW FROM the_date)::INT + 6) % 7);

  UPDATE timesheet_approvals
     SET edited_after = TRUE
   WHERE staff_id = the_staff
     AND ((scope = 'day'  AND scope_date = the_date)
       OR (scope = 'week' AND scope_date = week_start));

  IF (TG_OP = 'DELETE') THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_timesheet_edited_after ON time_entries;
CREATE TRIGGER trg_timesheet_edited_after
  AFTER INSERT OR UPDATE OR DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION timesheet_mark_edited_after();

-- ------------------------------------------------------------
-- 6. RLS — staff see/edit own entries; owner sees/edits all.
--    Approvals are owner-only.
-- ------------------------------------------------------------
ALTER TABLE time_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_approvals  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS te_read   ON time_entries;
DROP POLICY IF EXISTS te_insert ON time_entries;
DROP POLICY IF EXISTS te_update ON time_entries;
DROP POLICY IF EXISTS te_delete ON time_entries;

-- Staff: read/write own rows. Owner: read/write any.
CREATE POLICY te_read   ON time_entries FOR SELECT USING (
  is_owner() OR staff_id = auth.uid()
);
CREATE POLICY te_insert ON time_entries FOR INSERT WITH CHECK (
  is_owner() OR staff_id = auth.uid()
);
CREATE POLICY te_update ON time_entries FOR UPDATE USING (
  is_owner() OR staff_id = auth.uid()
) WITH CHECK (
  is_owner() OR staff_id = auth.uid()
);
CREATE POLICY te_delete ON time_entries FOR DELETE USING (is_owner());

DROP POLICY IF EXISTS ta_read   ON timesheet_approvals;
DROP POLICY IF EXISTS ta_write  ON timesheet_approvals;
DROP POLICY IF EXISTS ta_update ON timesheet_approvals;
DROP POLICY IF EXISTS ta_delete ON timesheet_approvals;

CREATE POLICY ta_read   ON timesheet_approvals FOR SELECT USING (
  is_owner() OR staff_id = auth.uid()
);
CREATE POLICY ta_write  ON timesheet_approvals FOR INSERT WITH CHECK (is_owner());
CREATE POLICY ta_update ON timesheet_approvals FOR UPDATE USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY ta_delete ON timesheet_approvals FOR DELETE USING (is_owner());

-- ------------------------------------------------------------
-- 7. RPC: clock_in / clock_out helpers (atomic)
-- ------------------------------------------------------------

-- Open a new clock-in for the calling user. Errors if there's already an open one.
CREATE OR REPLACE FUNCTION timesheet_clock_in(
  p_shift_type shift_type DEFAULT 'front_desk',
  p_notes      TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  open_id UUID;
  new_id  UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO open_id
    FROM time_entries
   WHERE staff_id = auth.uid()
     AND clock_in IS NOT NULL
     AND clock_out IS NULL
   LIMIT 1;

  IF open_id IS NOT NULL THEN
    RAISE EXCEPTION 'You already have an open clock-in (entry %). Clock out first.', open_id;
  END IF;

  INSERT INTO time_entries (staff_id, shift_type, entry_date, clock_in, notes, created_by)
  VALUES (auth.uid(), p_shift_type, CURRENT_DATE, NOW(), p_notes, auth.uid())
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

-- Close out the calling user's open clock-in. Returns the resulting hours.
CREATE OR REPLACE FUNCTION timesheet_clock_out(
  p_notes TEXT DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  open_id  UUID;
  result_h NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO open_id
    FROM time_entries
   WHERE staff_id = auth.uid()
     AND clock_in IS NOT NULL
     AND clock_out IS NULL
   ORDER BY clock_in DESC
   LIMIT 1;

  IF open_id IS NULL THEN
    RAISE EXCEPTION 'No open clock-in to close.';
  END IF;

  UPDATE time_entries
     SET clock_out = NOW(),
         notes     = COALESCE(p_notes, notes)
   WHERE id = open_id
   RETURNING hours INTO result_h;

  RETURN result_h;
END;
$$;

GRANT EXECUTE ON FUNCTION timesheet_clock_in(shift_type, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION timesheet_clock_out(TEXT)            TO authenticated;

-- ------------------------------------------------------------
-- 8. GRANTS
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON time_entries        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON timesheet_approvals TO anon, authenticated;
GRANT ALL ON time_entries        TO service_role;
GRANT ALL ON timesheet_approvals TO service_role;

-- ------------------------------------------------------------
-- END 008_timesheets.sql
-- ------------------------------------------------------------
