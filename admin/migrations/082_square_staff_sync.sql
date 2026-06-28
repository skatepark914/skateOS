-- ============================================================
-- 082_square_staff_sync.sql
--
-- Adds the columns needed to mirror Square's team_members on
-- skateOS staff. Each Square team_member becomes one staff row
-- with their email, phone, job title, hourly rate, etc.
-- Dedupe by square_team_member_id so re-sync is safe.
--
-- New job_assignments table to hold the full list — Square allows
-- a team member to hold multiple jobs (Instructor + Shop + Group)
-- with different rates each.
-- ============================================================

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS square_team_member_id TEXT,
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS hire_date DATE,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS staff_square_tm_id_key
  ON public.staff(square_team_member_id)
  WHERE square_team_member_id IS NOT NULL;

-- Multiple job assignments per staff member (Instructor + Group Inst + Shop).
-- Square supports this natively — we mirror it.
CREATE TABLE IF NOT EXISTS public.staff_job_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  job_title   TEXT NOT NULL,
  pay_rate    NUMERIC,
  pay_type    TEXT DEFAULT 'hourly',  -- 'hourly' | 'annual'
  is_primary  BOOLEAN DEFAULT false,
  tenant_id   UUID,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_job_assignments_staff_id_idx
  ON public.staff_job_assignments(staff_id);

ALTER TABLE public.staff_job_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_job_assignments_authenticated" ON public.staff_job_assignments;
CREATE POLICY "staff_job_assignments_authenticated"
  ON public.staff_job_assignments
  TO authenticated
  USING (true) WITH CHECK (true);

DO $$ BEGIN
  RAISE NOTICE '082 applied: staff payroll/Square fields + job_assignments table';
END $$;
