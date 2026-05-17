-- ============================================================
-- 026_waiver_expiry.sql — annual waiver expiry tracking
--
-- Most parks make skaters re-sign waivers annually. Until now we only
-- tracked `waiver_signed_at` (set-and-forget) — a 5-year-old waiver
-- still showed green at the front desk.
--
-- Adds `waiver_expires_at` (default = signed + 365 days), backfills
-- existing rows, and a trigger that auto-sets expiry whenever
-- waiver_signed_at is bumped (renewal flow).
--
-- Front-desk JS keys off `_isWaiverValid(c)` = signed AND not expired.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS waiver_expires_at TIMESTAMPTZ;

-- Owner-tunable expiry window via app_settings (key='waiver' → {expiry_days: 365}).
-- Default 365 days; some parks want 6mo, others 18mo. Trigger reads this on every fire.
INSERT INTO app_settings (key, value)
VALUES ('waiver', jsonb_build_object('expiry_days', 365))
ON CONFLICT (key) DO NOTHING;

-- Backfill: every existing signed waiver gets +365 days from sign date
UPDATE customers
   SET waiver_expires_at = waiver_signed_at + INTERVAL '365 days'
 WHERE waiver_signed_at IS NOT NULL
   AND waiver_expires_at IS NULL;

-- Auto-set expiry on every renewal (anytime waiver_signed_at is updated).
-- Reads the current org-level expiry window from app_settings (key='waiver').
CREATE OR REPLACE FUNCTION waiver_set_expiry() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  win_days INT;
BEGIN
  IF NEW.waiver_signed_at IS NULL THEN
    NEW.waiver_expires_at := NULL;
    RETURN NEW;
  END IF;
  -- Only set/update expiry if signed-at changed (or expiry is null)
  IF (TG_OP = 'INSERT')
     OR (OLD.waiver_signed_at IS DISTINCT FROM NEW.waiver_signed_at)
     OR (NEW.waiver_expires_at IS NULL) THEN
    SELECT COALESCE((value->>'expiry_days')::INT, 365) INTO win_days
      FROM app_settings WHERE key = 'waiver';
    IF win_days IS NULL OR win_days <= 0 THEN win_days := 365; END IF;
    NEW.waiver_expires_at := NEW.waiver_signed_at + (win_days || ' days')::INTERVAL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_waiver_set_expiry ON customers;
CREATE TRIGGER trg_waiver_set_expiry
  BEFORE INSERT OR UPDATE OF waiver_signed_at ON customers
  FOR EACH ROW EXECUTE FUNCTION waiver_set_expiry();

-- Update search_customers RPC to include waiver_expires_at + photo_url
-- (photo_url was added in migration 023 but never wired into the search
-- RPC; rolling that fix in here too so front-desk hits get a photo and
-- accurate waiver state in one query).
DROP FUNCTION IF EXISTS search_customers(TEXT);

CREATE OR REPLACE FUNCTION search_customers(q TEXT)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  dob DATE,
  waiver_signed_at TIMESTAMPTZ,
  waiver_expires_at TIMESTAMPTZ,
  total_spent NUMERIC,
  last_visit_at TIMESTAMPTZ,
  loyalty_points INT,
  photo_url TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id, first_name, last_name, name, email, phone,
    dob, waiver_signed_at, waiver_expires_at,
    total_spent, last_visit_at,
    loyalty_points, photo_url
  FROM customers
  WHERE
    q IS NULL OR q = ''
    OR lower(first_name)  LIKE lower(q) || '%'
    OR lower(last_name)   LIKE lower(q) || '%'
    OR lower(email)       LIKE '%' || lower(q) || '%'
    OR phone              LIKE '%' || regexp_replace(q, '\D', '', 'g') || '%'
    OR lower(name)        LIKE '%' || lower(q) || '%'
  ORDER BY
    CASE WHEN lower(first_name) = lower(q) THEN 0
         WHEN lower(first_name) LIKE lower(q) || '%' THEN 1
         WHEN lower(last_name)  = lower(q) THEN 2
         WHEN lower(last_name)  LIKE lower(q) || '%' THEN 3
         ELSE 4
    END,
    last_visit_at DESC NULLS LAST,
    name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_customers(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_customers(TEXT) TO authenticated, anon;

-- Helpful index for "expiring soon" queries (admin reminders)
CREATE INDEX IF NOT EXISTS idx_customers_waiver_expires
  ON customers(waiver_expires_at)
  WHERE waiver_expires_at IS NOT NULL;
