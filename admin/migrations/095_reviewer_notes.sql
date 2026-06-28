-- ============================================================
-- 095_reviewer_notes.sql
--
-- Anon-writable annotation layer so a technical reviewer (Kenan)
-- can leave notes on any section of any public page (audit-plan,
-- update, etc) without needing an account. Notes are public-read.
-- Owner-only to resolve/status-flip.
--
-- Idempotent. RLS enabled.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reviewer_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page         TEXT NOT NULL,                                 -- e.g. 'audit-plan'
  section_id   TEXT NOT NULL,                                 -- e.g. 'stability-log'
  reviewer     TEXT NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 80),
  note         TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 4000),
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','addressed','wontfix')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  TEXT
);

CREATE INDEX IF NOT EXISTS reviewer_notes_page_section_idx
  ON public.reviewer_notes(page, section_id, created_at);

CREATE INDEX IF NOT EXISTS reviewer_notes_status_idx
  ON public.reviewer_notes(status)
  WHERE status = 'open';

ALTER TABLE public.reviewer_notes ENABLE ROW LEVEL SECURITY;

-- Public read
DROP POLICY IF EXISTS reviewer_notes_read ON public.reviewer_notes;
CREATE POLICY reviewer_notes_read ON public.reviewer_notes
  FOR SELECT TO anon, authenticated
  USING (true);

-- Public INSERT (anon adds notes) — only the listed columns
DROP POLICY IF EXISTS reviewer_notes_insert ON public.reviewer_notes;
CREATE POLICY reviewer_notes_insert ON public.reviewer_notes
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    page IS NOT NULL AND section_id IS NOT NULL
    AND reviewer IS NOT NULL AND note IS NOT NULL
    AND status = 'open'
    AND resolved_at IS NULL AND resolved_by IS NULL
  );

-- Authenticated owner-only updates (resolve / status-flip)
DROP POLICY IF EXISTS reviewer_notes_update ON public.reviewer_notes;
CREATE POLICY reviewer_notes_update ON public.reviewer_notes
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DO $$ BEGIN
  RAISE NOTICE '095 applied: reviewer_notes table + RLS';
END $$;
