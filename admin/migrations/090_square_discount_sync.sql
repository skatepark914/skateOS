-- ============================================================
-- 090_square_discount_sync.sql
--
-- Wires Square's DISCOUNT catalog into our promo_codes table
-- (mig 024). Doug has 77 active discount codes in Square
-- ("CLASSFREE", "TEST", etc) — cashiers expect these to work
-- without re-defining them in skateOS.
--
-- Adds a partial unique index on square_discount_id so the
-- square-import flow can UPSERT.
-- ============================================================

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS square_discount_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_square_id_uniq
  ON public.promo_codes(square_discount_id)
  WHERE square_discount_id IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE '090 applied: promo_codes.square_discount_id + uniq index';
END $$;
