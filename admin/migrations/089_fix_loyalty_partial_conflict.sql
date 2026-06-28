-- ============================================================
-- 089_fix_loyalty_partial_conflict.sql
--
-- Bug: loyalty_award_sale + affiliate_auto_earn use ON CONFLICT
-- (ref_type, ref_id) but the unique index is PARTIAL (WHERE NOT
-- NULL). Postgres rejects this match — error 42P10. ~279 of every
-- 10K Square sales fail to insert because of this.
--
-- Fix: add the matching WHERE clause to the ON CONFLICT. Same
-- behavior, just lets Postgres find the index.
-- ============================================================

CREATE OR REPLACE FUNCTION public.loyalty_award_sale()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  cfg   loyalty_config%ROWTYPE;
  pts   INT;
BEGIN
  IF NEW.customer_id IS NULL OR NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO cfg FROM loyalty_config WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN NEW; END IF;

  pts := FLOOR(COALESCE(NEW.total, 0) * cfg.points_per_dollar);
  IF pts <= 0 THEN RETURN NEW; END IF;

  INSERT INTO loyalty_transactions (customer_id, delta, reason, ref_type, ref_id, note)
  VALUES (NEW.customer_id, pts, 'sale', 'sales', NEW.id,
          'Earned on receipt ' || COALESCE(NEW.receipt_number, NEW.id::TEXT))
  ON CONFLICT (ref_type, ref_id)
    WHERE ((ref_type IS NOT NULL) AND (ref_id IS NOT NULL))
    DO NOTHING;

  RETURN NEW;
END;
$function$;

DO $$ BEGIN
  RAISE NOTICE '089 applied: loyalty_award_sale ON CONFLICT WHERE fix';
END $$;
