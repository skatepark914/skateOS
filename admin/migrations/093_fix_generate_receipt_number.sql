-- ============================================================
-- 093_fix_generate_receipt_number.sql
--
-- P0 BUG: every new POS sale insert was failing because the
-- generate_receipt_number trigger did:
--
--   MAX(CAST(SUBSTRING(receipt_number FROM 5) AS INT))
--
-- That worked when every row was 'REC-00001' format. But mig 075's
-- Square-import path inserts receipts as 'SQ-16hYePXZY' — Square's
-- alphanumeric order ID. CAST('6hYePXZY' AS INT) throws 22P02 and
-- the entire sales INSERT fails.
--
-- Fix: only scan REC-prefixed rows for the next sequence number,
-- and ignore SQ-prefixed (or anything else).
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.receipt_number IS NULL THEN
    NEW.receipt_number := 'REC-' || LPAD(
      (
        SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM 5) AS INT)), 0) + 1
        FROM sales
        WHERE receipt_number IS NOT NULL
          AND receipt_number ~ '^REC-[0-9]+$'   -- only count properly-formatted skateOS receipts
      )::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$function$;

DO $$ BEGIN
  RAISE NOTICE '093 applied: generate_receipt_number now safely ignores SQ-* and other non-REC-* receipts';
END $$;
