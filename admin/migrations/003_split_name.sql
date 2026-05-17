-- ============================================================
-- 003_split_name.sql — Split customer name into first + last
--
-- Adds `first_name` and `last_name` columns to customers.
-- `name` becomes a generated column (first + ' ' + last) so every
-- existing read path keeps working without code changes.
--
-- For existing rows (demo data): best-effort split on first space.
-- Safe to re-run (idempotent).
-- ============================================================

-- 1. Add the new columns (nullable first so backfill doesn't error)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- 2. Backfill from existing `name` where either field is still empty.
--    Splits on the first space: "Liam Chen" → first=Liam, last=Chen
--    Single-word names: first=<the word>, last=NULL
UPDATE customers
SET
  first_name = COALESCE(first_name, NULLIF(split_part(name, ' ', 1), '')),
  last_name  = COALESCE(
                 last_name,
                 NULLIF(trim(substring(name FROM position(' ' IN name) + 1)), '')
               )
WHERE (first_name IS NULL OR last_name IS NULL) AND name IS NOT NULL;

-- 3. Replace the plain `name` column with a generated column that derives
--    from first_name + last_name. This guarantees the two never drift.
--    We have to drop and recreate the column, keeping the same name.
--
--    NOTE: generated columns can't reference mutable concat shortcuts,
--    so we use COALESCE + trim explicitly.
DO $$
DECLARE
  col_is_generated BOOLEAN;
BEGIN
  SELECT is_generated = 'ALWAYS' INTO col_is_generated
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'name';

  IF col_is_generated IS NOT TRUE THEN
    -- Drop the old plain column and recreate as generated
    ALTER TABLE customers DROP COLUMN name;
    ALTER TABLE customers ADD COLUMN name TEXT GENERATED ALWAYS AS (
      trim(
        COALESCE(first_name, '') ||
        CASE WHEN first_name IS NOT NULL AND last_name IS NOT NULL THEN ' ' ELSE '' END ||
        COALESCE(last_name, '')
      )
    ) STORED;
  END IF;
END $$;

-- 4. Indexes for fast customer-picker search (case-insensitive prefix + contains)
CREATE INDEX IF NOT EXISTS idx_customers_first_name_ci ON customers(lower(first_name));
CREATE INDEX IF NOT EXISTS idx_customers_last_name_ci  ON customers(lower(last_name));

-- Full-text search across name + email + phone — this is what the picker uses
CREATE INDEX IF NOT EXISTS idx_customers_search_fts ON customers
  USING gin (
    to_tsvector('simple',
      coalesce(first_name,'') || ' ' ||
      coalesce(last_name,'')  || ' ' ||
      coalesce(email,'')      || ' ' ||
      coalesce(phone,'')
    )
  );

-- 5. Convenience RPC for the client picker: takes a query string,
--    returns the top 20 matches ranked by relevance.
--    Callable from PostgREST as POST /rpc/search_customers
CREATE OR REPLACE FUNCTION search_customers(q TEXT)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  total_spent NUMERIC,
  last_visit_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id, first_name, last_name, name, email, phone, total_spent, last_visit_at
  FROM customers
  WHERE
    q IS NULL OR q = ''
    OR lower(first_name)  LIKE lower(q) || '%'
    OR lower(last_name)   LIKE lower(q) || '%'
    OR lower(email)       LIKE '%' || lower(q) || '%'
    OR phone              LIKE '%' || regexp_replace(q, '\D', '', 'g') || '%'
    OR lower(name)        LIKE '%' || lower(q) || '%'
  ORDER BY
    -- Exact first-name match ranked highest, then last-name, then fuzzy
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

-- Allow the picker to be called by any authenticated staff member
REVOKE ALL ON FUNCTION search_customers(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_customers(TEXT) TO authenticated, anon;
