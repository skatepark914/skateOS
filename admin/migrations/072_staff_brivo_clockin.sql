-- 072_staff_brivo_clockin.sql — wire staff door taps to a clock-in prompt.
--
-- Why:
--   When staff tap their phone at the park door, skateOS should text them
--   "Clock in?" with one-tap Yes/No links. They often come in when NOT
--   working (pick something up, hang out), so an auto-clock-in would be
--   wrong. SMS prompt lets them confirm.
--
-- Adds:
--   - staff.phone           — for sending the SMS
--   - staff.brivo_user_id   — to identify staff in the Brivo webhook payload
--   - staff_clock_token()   — one-shot signed token RPC so the SMS link can
--                              hit /clock.html without exposing staff_id
--
-- The brivo-webhook Edge Function patch (separate file) checks staff first;
-- if found, fires send-sms with the clock-in URL.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone          TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS brivo_user_id  TEXT;

-- Unique index on brivo_user_id (NULLs allowed — staff w/o Brivo are fine)
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_brivo_user_id
  ON staff(brivo_user_id)
  WHERE brivo_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_phone
  ON staff(phone)
  WHERE phone IS NOT NULL;

-- One-shot link token. Generated when SMS goes out; consumed when staff taps
-- the link. Prevents anyone seeing the URL from later clocking someone in.
CREATE TABLE IF NOT EXISTS staff_clock_tokens (
  token        TEXT PRIMARY KEY,
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  action       TEXT NOT NULL CHECK (action IN ('in','out')),
  brivo_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '2 hours',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_clock_tokens_staff
  ON staff_clock_tokens(staff_id, created_at DESC);

-- ===== Issue a clock token (called by brivo-webhook when staff taps door)
CREATE OR REPLACE FUNCTION issue_staff_clock_token(p_staff_id UUID, p_action TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t TEXT;
BEGIN
  IF p_action NOT IN ('in','out') THEN
    RAISE EXCEPTION 'invalid action: %', p_action;
  END IF;
  t := REPLACE(gen_random_uuid()::TEXT, '-', '');
  INSERT INTO staff_clock_tokens(token, staff_id, action)
  VALUES (t, p_staff_id, p_action);
  RETURN t;
END;
$$;
GRANT EXECUTE ON FUNCTION issue_staff_clock_token(UUID, TEXT)
  TO authenticated, service_role;

-- ===== Consume a token + perform the clock action (called by /clock.html)
-- Opens a new time_entry on 'in', closes the latest open one on 'out'.
CREATE OR REPLACE FUNCTION consume_staff_clock_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tok RECORD;
  open_id UUID;
  result JSONB;
BEGIN
  SELECT * INTO tok FROM staff_clock_tokens
   WHERE token = p_token AND consumed_at IS NULL AND expires_at > NOW()
   LIMIT 1;

  IF tok.staff_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Link expired or already used.');
  END IF;

  IF tok.action = 'in' THEN
    -- Don't double-open: if there's already an open entry today, no-op
    SELECT id INTO open_id FROM time_entries
     WHERE staff_id = tok.staff_id AND clock_in IS NOT NULL AND clock_out IS NULL
     ORDER BY clock_in DESC LIMIT 1;
    IF open_id IS NULL THEN
      INSERT INTO time_entries(staff_id, clock_in, created_by, notes)
      VALUES (tok.staff_id, NOW(), tok.staff_id, 'Clocked in via Brivo door tap')
      RETURNING id INTO open_id;
    END IF;
    result := jsonb_build_object('ok', true, 'action', 'in', 'entry_id', open_id);

  ELSE  -- 'out'
    SELECT id INTO open_id FROM time_entries
     WHERE staff_id = tok.staff_id AND clock_in IS NOT NULL AND clock_out IS NULL
     ORDER BY clock_in DESC LIMIT 1;
    IF open_id IS NULL THEN
      result := jsonb_build_object('ok', false, 'error', 'No open shift to close.');
    ELSE
      UPDATE time_entries SET clock_out = NOW(), notes = COALESCE(notes,'') || ' / out via Brivo'
       WHERE id = open_id;
      result := jsonb_build_object('ok', true, 'action', 'out', 'entry_id', open_id);
    END IF;
  END IF;

  UPDATE staff_clock_tokens SET consumed_at = NOW() WHERE token = p_token;
  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION consume_staff_clock_token(TEXT)
  TO anon, authenticated, service_role;

-- Verify
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'staff' AND column_name IN ('phone','brivo_user_id')
 ORDER BY column_name;
