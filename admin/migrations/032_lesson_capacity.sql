-- ============================================================
-- 032_lesson_capacity.sql — group lesson / camp capacity model
--
-- Today, a "Saturday Beginner Camp" with 8 kids is 8 separate
-- lesson rows — calendar gets cluttered, the cashier has to file
-- 8 bookings, and "X/Y booked" is impossible to display.
--
-- This adds:
--   * lessons.max_attendees INT DEFAULT 1
--     (1 = solo flow stays unchanged)
--   * lesson_attendees join table — one row per kid in a group
--     lesson, tracks attendance + status independently of the
--     parent lesson row.
--
-- Existing rows are backfilled — every solo lesson with a customer_id
-- gets one matching lesson_attendees row so the "attendees count" UI
-- works uniformly. Solo flow continues using the existing customer_id
-- column as the primary booker; the join row is just a mirror.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- 1. Capacity column on lessons
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS max_attendees INT NOT NULL DEFAULT 1;

-- 2. Attendee join table
CREATE TABLE IF NOT EXISTS lesson_attendees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','attended','no_show','cancelled','waitlist')),
  attended_at   TIMESTAMPTZ,
  attended_via  TEXT,                 -- 'checkin_auto' | 'manual' | 'lesson_complete'
  -- Capture who paid + how on a per-attendee basis (split-pay friendly)
  paid_by_customer_id UUID REFERENCES customers(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_id, customer_id)     -- one row per kid per lesson
);

CREATE INDEX IF NOT EXISTS idx_lesson_attendees_lesson   ON lesson_attendees(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_attendees_customer ON lesson_attendees(customer_id);
CREATE INDEX IF NOT EXISTS idx_lesson_attendees_status   ON lesson_attendees(status) WHERE status = 'booked';

-- 3. Backfill: existing solo lessons get one mirror row per attendee
--    Idempotent thanks to the UNIQUE (lesson_id, customer_id) — re-runs no-op.
INSERT INTO lesson_attendees (lesson_id, customer_id, status, attended_at, attended_via)
SELECT
  l.id,
  l.customer_id,
  CASE
    WHEN l.status = 'no_show'   THEN 'no_show'
    WHEN l.status = 'cancelled' THEN 'cancelled'
    WHEN l.attended_at IS NOT NULL OR l.status = 'completed' THEN 'attended'
    ELSE 'booked'
  END,
  l.attended_at,
  l.attended_via
FROM lessons l
WHERE l.customer_id IS NOT NULL
ON CONFLICT (lesson_id, customer_id) DO NOTHING;

-- 3b. Auto-mirror trigger: when a lesson is INSERTed (or its customer_id
--     changes), insert a matching lesson_attendees row so booked_count starts
--     at 1 immediately for solo lessons and the primary booker shows up in
--     the roster for group lessons. Idempotent via the (lesson_id, customer_id)
--     UNIQUE — re-points won't double-insert.
CREATE OR REPLACE FUNCTION lesson_mirror_primary_attendee() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO lesson_attendees (lesson_id, customer_id, status, attended_at, attended_via)
  VALUES (
    NEW.id,
    NEW.customer_id,
    CASE
      WHEN NEW.status = 'no_show'   THEN 'no_show'
      WHEN NEW.status = 'cancelled' THEN 'cancelled'
      WHEN NEW.attended_at IS NOT NULL OR NEW.status = 'completed' THEN 'attended'
      ELSE 'booked'
    END,
    NEW.attended_at,
    NEW.attended_via
  )
  ON CONFLICT (lesson_id, customer_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_mirror_primary ON lessons;
CREATE TRIGGER trg_lesson_mirror_primary
  AFTER INSERT OR UPDATE OF customer_id ON lessons
  FOR EACH ROW EXECUTE FUNCTION lesson_mirror_primary_attendee();

-- 4. Helper view: lessons with current attendee count + capacity
--    "X/Y booked" lookup is one query, not per-row.
CREATE OR REPLACE VIEW lessons_with_attendance AS
  SELECT
    l.*,
    COALESCE((SELECT COUNT(*) FROM lesson_attendees a WHERE a.lesson_id = l.id AND a.status IN ('booked','attended')), 0) AS booked_count,
    GREATEST(0, l.max_attendees -
      COALESCE((SELECT COUNT(*) FROM lesson_attendees a WHERE a.lesson_id = l.id AND a.status IN ('booked','attended')), 0)
    ) AS seats_left
  FROM lessons l;

GRANT SELECT ON lessons_with_attendance TO authenticated;

-- 5. RLS — same posture as lessons (staff read/write inheritable from main table policy).
ALTER TABLE lesson_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS la_read   ON lesson_attendees;
DROP POLICY IF EXISTS la_write  ON lesson_attendees;
DROP POLICY IF EXISTS la_edit   ON lesson_attendees;
DROP POLICY IF EXISTS la_delete ON lesson_attendees;
CREATE POLICY la_read   ON lesson_attendees FOR SELECT USING (is_staff());
CREATE POLICY la_write  ON lesson_attendees FOR INSERT WITH CHECK (is_staff());
CREATE POLICY la_edit   ON lesson_attendees FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY la_delete ON lesson_attendees FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON lesson_attendees TO anon, authenticated;
GRANT ALL ON lesson_attendees TO service_role;

-- 6. Multi-tenant tag — Phase A additive, mirrors migration 009 pattern.
ALTER TABLE lesson_attendees
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE lesson_attendees SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;
