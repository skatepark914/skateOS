-- ============================================================
-- 022_lesson_attended.sql — track lesson attendance via check-in
--
-- When a customer checks in within ±15min of a scheduled lesson
-- they own, the JS auto-stamps attended_at on that lesson row.
-- This migration just adds the column.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS attended_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attended_via TEXT;  -- 'checkin_auto' | 'manual' | 'lesson_complete'

CREATE INDEX IF NOT EXISTS idx_lessons_attended ON lessons(attended_at) WHERE attended_at IS NOT NULL;
