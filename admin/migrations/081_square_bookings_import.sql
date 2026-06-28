-- ============================================================
-- 081_square_bookings_import.sql
--
-- Adds the columns + index needed to import Square Appointments
-- bookings into skateOS lessons. Each Square booking → one lessons row.
-- Dedupe by Square's booking id so re-runs are safe.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS square_booking_id TEXT;

-- Unique so re-imports skip dupes (partial — existing skateOS-native
-- lessons stay NULL + don't conflict)
CREATE UNIQUE INDEX IF NOT EXISTS lessons_square_booking_id_key
  ON public.lessons(square_booking_id)
  WHERE square_booking_id IS NOT NULL;

-- "Imported from Square" filter view + per-day count for the dashboard
CREATE INDEX IF NOT EXISTS lessons_imported_at
  ON public.lessons(scheduled_at)
  WHERE square_booking_id IS NOT NULL;

-- Verification probe
DO $$
DECLARE
  has_col BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_name='lessons' AND column_name='square_booking_id') INTO has_col;
  RAISE NOTICE '081 applied: lessons.square_booking_id = %', has_col;
END $$;
