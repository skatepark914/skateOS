-- ============================================================
-- 084_square_shifts_import.sql
--
-- Adds the columns needed to import Square Payroll shifts into
-- time_entries. Each Square shift → one time_entries row.
-- Dedupe by Square's shift id.
-- ============================================================

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS square_shift_id TEXT,
  ADD COLUMN IF NOT EXISTS imported_from TEXT,
  ADD COLUMN IF NOT EXISTS wage_at_clock_in NUMERIC,
  ADD COLUMN IF NOT EXISTS wage_job_title TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS time_entries_square_shift_id_key
  ON public.time_entries(square_shift_id)
  WHERE square_shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS time_entries_imported_from_idx
  ON public.time_entries(imported_from)
  WHERE imported_from IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE '084 applied: time_entries.square_shift_id + wage fields';
END $$;
