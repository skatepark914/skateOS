-- ============================================================
-- 025_sales_tip.sql — gratuity / tip on a sale
--
-- For instructors getting tipped on lessons, or shop staff getting
-- a few bucks on a $200 deck setup. Tip lives separately from
-- discount + tax so reports don't conflate gratuity with revenue.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS tip NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tip_for_staff_id UUID REFERENCES staff(id);  -- nullable; lets shop split tips per instructor

CREATE INDEX IF NOT EXISTS idx_sales_tip ON sales(tip_for_staff_id) WHERE tip_for_staff_id IS NOT NULL;
