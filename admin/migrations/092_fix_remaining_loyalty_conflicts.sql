-- ============================================================
-- 092_fix_remaining_loyalty_conflicts.sql
--
-- P0 fixes — same bug class as mig 089 (partial unique index +
-- bare ON CONFLICT throws 42P10). Hunt found 2 more functions
-- still affected:
--
--   loyalty_award_checkin → broke EVERY check-in (Brivo
--     auto-checkin + manual check-ins both threw silently)
--   loyalty_reverse_sale  → broke refunds (sale flipped to
--     refunded but points never reversed)
--
-- Fix: add the matching WHERE clause to the ON CONFLICT so
-- Postgres can match the partial index `uniq_loyalty_tx_ref`.
-- ============================================================

-- ── loyalty_award_checkin ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.loyalty_award_checkin()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  cfg loyalty_config%ROWTYPE;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO cfg FROM loyalty_config WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled OR cfg.points_per_checkin <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
  VALUES (NEW.customer_id, cfg.points_per_checkin, 'checkin', 'checkins', NEW.id,
          'Visit bonus')
  ON CONFLICT (ref_type, ref_id)
    WHERE ((ref_type IS NOT NULL) AND (ref_id IS NOT NULL))
    DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ── loyalty_reverse_sale ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.loyalty_reverse_sale()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  earn_pts INT;
  reverse_pts INT;
  earn_total NUMERIC(10,2);
  refund_pct NUMERIC;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  SELECT delta INTO earn_pts
    FROM loyalty_transactions
   WHERE ref_type = 'sales' AND ref_id = NEW.id AND delta > 0
   LIMIT 1;
  IF earn_pts IS NULL OR earn_pts <= 0 THEN RETURN NEW; END IF;

  earn_total := COALESCE(OLD.total, NEW.total);

  -- Full refund / void path
  IF NEW.status IN ('refunded','voided')
     AND OLD.status = 'completed'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
    VALUES (NEW.customer_id, -earn_pts, 'refund', 'sales_refund', NEW.id,
            'Reversed on '||NEW.status||' — receipt '||COALESCE(NEW.receipt_number, NEW.id::TEXT))
    ON CONFLICT (ref_type, ref_id)
      WHERE ((ref_type IS NOT NULL) AND (ref_id IS NOT NULL))
      DO NOTHING;
    RETURN NEW;
  END IF;

  -- Partial refund path
  IF (OLD.refunded_amount IS DISTINCT FROM NEW.refunded_amount)
     AND COALESCE(NEW.refunded_amount, 0) > COALESCE(OLD.refunded_amount, 0)
     AND NEW.status = 'completed'
     AND earn_total > 0 THEN
    refund_pct := (NEW.refunded_amount - COALESCE(OLD.refunded_amount, 0)) / earn_total;
    reverse_pts := FLOOR(earn_pts * refund_pct);
    IF reverse_pts > 0 THEN
      INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
      VALUES (NEW.customer_id, -reverse_pts, 'partial_refund',
              'sales_partial_refund_'||to_char(NOW(),'YYYYMMDDHH24MISS'), NEW.id,
              'Partial refund $'||(NEW.refunded_amount - COALESCE(OLD.refunded_amount, 0))::TEXT||
              ' on receipt '||COALESCE(NEW.receipt_number, NEW.id::TEXT));
      -- This branch uses a unique ref_type per call (timestamp suffix) so it
      -- never hits the index conflict; intentionally no ON CONFLICT here.
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DO $$ BEGIN
  RAISE NOTICE '092 applied: loyalty_award_checkin + loyalty_reverse_sale ON CONFLICT WHERE predicate added';
END $$;
