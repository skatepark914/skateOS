-- ============================================================
-- 014_lesson_reminders.sql — track lesson reminder sends
--
-- Adds `reminder_sent_at` to lessons + a stamp for which channel(s)
-- the reminder went through. Lets the send-lesson-reminders Edge
-- Function be safely called repeatedly (idempotent — won't re-send).
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS reminder_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_channels TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_lessons_reminder_unsent
  ON lessons(scheduled_at)
  WHERE reminder_sent_at IS NULL AND status IN ('scheduled', 'confirmed');
