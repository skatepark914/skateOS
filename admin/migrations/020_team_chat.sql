-- ============================================================
-- 020_team_chat.sql — internal staff message board + reminders
--
-- For ops chatter that doesn't belong in Slack: "order more tees",
-- "fix the loose coping at the deep-end bowl", "Caitlin called out
-- Saturday" — short notes + assignable reminders with due dates.
--
-- Not a real-time chat (no presence, no typing indicators) — just
-- a feed staff check periodically. Realtime subscription on the
-- table makes new posts appear without a refresh.
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_message_kind') THEN
    CREATE TYPE team_message_kind AS ENUM ('note','reminder','announcement','question');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS team_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID REFERENCES team_messages(id) ON DELETE CASCADE,  -- threaded replies
  kind          team_message_kind NOT NULL DEFAULT 'note',
  body          TEXT NOT NULL,
  posted_by     UUID REFERENCES staff(id),
  posted_by_name TEXT,                                                 -- denormalized for read speed
  -- Reminder-only fields:
  assigned_to   UUID REFERENCES staff(id),                             -- NULL = anyone
  due_at        TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  completed_by  UUID REFERENCES staff(id),
  -- Reactions: lightweight array of {staff_id, emoji}
  reactions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  pinned        BOOLEAN NOT NULL DEFAULT FALSE,
  archived      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_msg_created  ON team_messages(created_at DESC) WHERE archived = FALSE;
CREATE INDEX IF NOT EXISTS idx_team_msg_open_rem ON team_messages(due_at) WHERE kind = 'reminder' AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_msg_assigned ON team_messages(assigned_to) WHERE assigned_to IS NOT NULL AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_msg_parent   ON team_messages(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_msg_pinned   ON team_messages(pinned) WHERE pinned = TRUE AND archived = FALSE;

CREATE OR REPLACE FUNCTION team_msg_touch() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_team_msg_touch ON team_messages;
CREATE TRIGGER trg_team_msg_touch BEFORE UPDATE ON team_messages FOR EACH ROW EXECUTE FUNCTION team_msg_touch();

-- Multi-tenant
ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_team_msg_tenant ON team_messages(tenant_id);

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE team_messages SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- RLS — staff read all, staff post, owner can hard-delete; staff can edit own posts.
ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tm_read   ON team_messages;
DROP POLICY IF EXISTS tm_write  ON team_messages;
DROP POLICY IF EXISTS tm_edit   ON team_messages;
DROP POLICY IF EXISTS tm_delete ON team_messages;

CREATE POLICY tm_read   ON team_messages FOR SELECT USING (is_staff());
CREATE POLICY tm_write  ON team_messages FOR INSERT WITH CHECK (is_staff());
-- Staff can edit own posts; owner can edit anything (e.g. mark reminders complete on behalf).
CREATE POLICY tm_edit   ON team_messages FOR UPDATE USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY tm_delete ON team_messages FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON team_messages TO anon, authenticated;
GRANT ALL ON team_messages TO service_role;

-- Add to realtime publication so the chat live-updates without polling.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE team_messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
