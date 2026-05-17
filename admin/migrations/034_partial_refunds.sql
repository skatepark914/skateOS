-- ============================================================
-- 034_partial_refunds.sql — partial refund support
--
-- Today refundSale() is all-or-nothing: flips sale status to
-- 'refunded' and that's it. Real-world ops need: "customer returns
-- just the wheels, keeps the deck — refund $50 of the $200 sale."
--
-- This adds:
--   * sales.refunded_amount  NUMERIC(10,2) DEFAULT 0
--   * sales.refunded_at      TIMESTAMPTZ
--   * sales.refunded_by      UUID
--
-- Effective-revenue queries become:
--   SUM(total) - SUM(refunded_amount)  WHERE status IN ('completed','refunded')
--
-- The existing 'refunded' status keeps full-refund semantics. A sale
-- where refunded_amount = total is functionally equivalent to status =
-- 'refunded'. The JS flow chooses one or the other based on amount.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_by     UUID REFERENCES staff(id);

-- Index for partial-refund reports
CREATE INDEX IF NOT EXISTS idx_sales_partial_refunded
  ON sales(refunded_at)
  WHERE refunded_amount > 0;

-- Loyalty reversal trigger (from migration 028) currently fires on full
-- refund only. Extend it to also fire on partial-refund — proportional
-- to the refunded amount. We keep the original full-refund path AND add
-- a partial path that uses the new refunded_amount column.
CREATE OR REPLACE FUNCTION loyalty_reverse_sale() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  earn_pts INT;
  reverse_pts INT;
  earn_total NUMERIC(10,2);
  refund_pct NUMERIC;
  earn_note TEXT;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  -- Find the original earn row, if any
  SELECT delta INTO earn_pts
    FROM loyalty_transactions
   WHERE ref_type = 'sales' AND ref_id = NEW.id AND delta > 0
   LIMIT 1;
  IF earn_pts IS NULL OR earn_pts <= 0 THEN RETURN NEW; END IF;

  earn_total := COALESCE(OLD.total, NEW.total);

  -- FULL refund/void path (unchanged from 028)
  IF NEW.status IN ('refunded','voided')
     AND OLD.status = 'completed'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
    VALUES (NEW.customer_id, -earn_pts, 'refund', 'sales_refund', NEW.id,
            'Reversed on '||NEW.status||' — receipt '||COALESCE(NEW.receipt_number, NEW.id::TEXT))
    ON CONFLICT (ref_type, ref_id) DO NOTHING;
    RETURN NEW;
  END IF;

  -- PARTIAL refund path — fires when refunded_amount transitions up
  -- (e.g. from 0 to 50). Reverse points proportional to (refunded_amount / total).
  IF (OLD.refunded_amount IS DISTINCT FROM NEW.refunded_amount)
     AND COALESCE(NEW.refunded_amount, 0) > COALESCE(OLD.refunded_amount, 0)
     AND NEW.status = 'completed'
     AND earn_total > 0 THEN
    refund_pct := (NEW.refunded_amount - COALESCE(OLD.refunded_amount, 0)) / earn_total;
    reverse_pts := FLOOR(earn_pts * refund_pct);
    IF reverse_pts > 0 THEN
      -- Use a unique ref so multiple partial refunds on same sale don't collide
      INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
      VALUES (NEW.customer_id, -reverse_pts, 'partial_refund', 'sales_partial_refund_'||to_char(NOW(),'YYYYMMDDHH24MISS'), NEW.id,
              'Partial refund $'||(NEW.refunded_amount - COALESCE(OLD.refunded_amount, 0))::TEXT||' on receipt '||COALESCE(NEW.receipt_number, NEW.id::TEXT));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_reverse_sale ON sales;
CREATE TRIGGER trg_loyalty_reverse_sale
  AFTER UPDATE OF status, refunded_amount ON sales
  FOR EACH ROW EXECUTE FUNCTION loyalty_reverse_sale();
