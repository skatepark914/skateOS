-- ============================================================
-- 028_loyalty_refund_reversal.sql — reverse loyalty earn on refund/void
--
-- Closes a financial leak: migration 006 awards loyalty_points on
-- completed sales but never reverses them when the sale is later
-- refunded or voided. A skater could buy a $200 board, get 200 points,
-- refund the next day, and keep the points. This reverses the earn.
--
-- Design:
--   * New trigger fires when sales.status transitions
--     from 'completed' → 'refunded' or 'voided'.
--   * Looks up the original earn (loyalty_transactions where
--     ref_type='sales' AND ref_id=sale.id AND delta>0) and inserts
--     a matching negative row with ref_type='sales_refund' so the
--     existing (ref_type, ref_id) UNIQUE INDEX doesn't conflict.
--   * loyalty_apply_delta() trigger from 006 already handles the
--     customer.loyalty_points sync (negative delta → balance drops,
--     clamped at 0 by GREATEST(0, ...)).
--
-- Edge cases handled:
--   * If no original earn (e.g. loyalty was disabled at sale time),
--     the trigger no-ops.
--   * If a sale is "un-refunded" (status flipped back), no re-award
--     happens automatically — Doug would handle as a manual adjust.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION loyalty_reverse_sale() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  earn_pts INT;
  earn_note TEXT;
BEGIN
  -- Only fire on transition INTO refunded/voided FROM completed
  IF NEW.status NOT IN ('refunded','voided') THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF OLD.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  -- Find the original earn row, if any. The 006 trigger uses
  -- ON CONFLICT (ref_type, ref_id) DO NOTHING so there's at most one.
  SELECT delta INTO earn_pts
    FROM loyalty_transactions
   WHERE ref_type = 'sales' AND ref_id = NEW.id AND delta > 0
   LIMIT 1;

  IF earn_pts IS NULL OR earn_pts <= 0 THEN
    RETURN NEW;  -- nothing to reverse (loyalty was disabled, or never awarded)
  END IF;

  earn_note := 'Reversed on '||NEW.status||' — receipt '||COALESCE(NEW.receipt_number, NEW.id::TEXT);

  -- Use ref_type='sales_refund' so the existing UNIQUE (ref_type, ref_id)
  -- doesn't conflict with the original earn row.
  INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
  VALUES (NEW.customer_id, -earn_pts, 'refund', 'sales_refund', NEW.id, earn_note)
  ON CONFLICT (ref_type, ref_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_reverse_sale ON sales;
CREATE TRIGGER trg_loyalty_reverse_sale
  AFTER UPDATE OF status ON sales
  FOR EACH ROW EXECUTE FUNCTION loyalty_reverse_sale();
