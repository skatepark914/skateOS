-- ============================================================
-- 042_split_payments.sql — split payment support on POS
--
-- Adds a JSONB column `sales.payments` containing an array of payment
-- line items: [{ method, amount, ref?, note? }, …]. The existing
-- `sales.payment_method` column stays as the "primary" / largest line
-- so legacy reports keep working unchanged. When `payments` is non-empty,
-- it's the canonical breakdown — receipts + reconciliation read from it.
--
-- Schema:
--   payments[*] = {
--     method:  'Cash' | 'Credit Card' | 'Gift Card' | 'Venmo' | …,
--     amount:  numeric (positive),
--     ref:     optional reference (gift card code, transaction ID, last-4)
--     note:    optional free text
--   }
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS payments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Soft validation — payments must be an array. JSONB schema-validation in PG
-- without an extension is awkward, so we just enforce array-ness via CHECK.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_payments_is_array'
  ) THEN
    ALTER TABLE sales ADD CONSTRAINT sales_payments_is_array
      CHECK (jsonb_typeof(payments) = 'array');
  END IF;
END $$;

-- Index for "all sales with a Cash component" type queries used by reconcile.
-- Partial GIN — only rows where payments has at least one element.
CREATE INDEX IF NOT EXISTS idx_sales_payments
  ON sales USING GIN (payments)
  WHERE jsonb_array_length(payments) > 0;

-- Helper: sum amount across the payments array for one method.
-- Reconciliation uses this to compute "how much cash was tendered today
-- across all sales (including split sales)."
CREATE OR REPLACE FUNCTION sum_payments_by_method(p_sale_id UUID, p_method TEXT)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM((p->>'amount')::numeric), 0)
    FROM sales s, jsonb_array_elements(s.payments) p
   WHERE s.id = p_sale_id
     AND lower(p->>'method') = lower(p_method)
$$;

GRANT EXECUTE ON FUNCTION sum_payments_by_method(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- Override reconcile_expected (originally migration 013) so it understands
-- split-payment rows. For a sale with `payments` array populated, the
-- breakdown uses each line's method + amount. For legacy single-payment
-- rows (empty/null payments), the existing payment_method-based bucketing
-- still applies.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reconcile_expected(p_date DATE)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  cash_total    NUMERIC(10,2) := 0;
  helcim_total  NUMERIC(10,2) := 0;
  cardm_total   NUMERIC(10,2) := 0;
  giftc_total   NUMERIC(10,2) := 0;
  other_total   NUMERIC(10,2) := 0;
  tx_count      INT := 0;
BEGIN
  -- Single-payment legacy rows (no payments[] populated). Sum sales.total by primary method.
  SELECT
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('cash')                                                                          THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('helcim_pay','helcim_invoice','helcim') OR payment_provider = 'helcim'           THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('card_manual','credit card','card')                                              THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) IN ('gift card','giftcard','gift_card')                                              THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN lower(payment_method) NOT IN ('cash','helcim_pay','helcim_invoice','helcim','card_manual','credit card','card','gift card','giftcard','gift_card') OR payment_method IS NULL THEN total ELSE 0 END), 0),
    COUNT(*)
  INTO cash_total, helcim_total, cardm_total, giftc_total, other_total, tx_count
  FROM sales
  WHERE created_at::date = p_date
    AND status = 'completed'
    AND (payments IS NULL OR jsonb_array_length(payments) = 0);

  -- Split-payment rows — for each line in the array, bucket its amount.
  WITH split_lines AS (
    SELECT lower(p->>'method') AS method, (p->>'amount')::numeric AS amount
      FROM sales s, jsonb_array_elements(s.payments) p
     WHERE s.created_at::date = p_date
       AND s.status = 'completed'
       AND s.payments IS NOT NULL
       AND jsonb_array_length(s.payments) > 0
  )
  SELECT
    cash_total   + COALESCE(SUM(CASE WHEN method = 'cash'                                                                  THEN amount ELSE 0 END), 0),
    helcim_total + COALESCE(SUM(CASE WHEN method IN ('helcim_pay','helcim_invoice','helcim')                              THEN amount ELSE 0 END), 0),
    cardm_total  + COALESCE(SUM(CASE WHEN method IN ('card_manual','credit card','card')                                   THEN amount ELSE 0 END), 0),
    giftc_total  + COALESCE(SUM(CASE WHEN method IN ('gift card','giftcard','gift_card')                                   THEN amount ELSE 0 END), 0),
    other_total  + COALESCE(SUM(CASE WHEN method NOT IN ('cash','helcim_pay','helcim_invoice','helcim','card_manual','credit card','card','gift card','giftcard','gift_card') THEN amount ELSE 0 END), 0)
  INTO cash_total, helcim_total, cardm_total, giftc_total, other_total
  FROM split_lines;

  -- Add the split-sale tx count (counted as 1 per sale, not per line)
  tx_count := tx_count + (
    SELECT COUNT(*) FROM sales
     WHERE created_at::date = p_date
       AND status = 'completed'
       AND payments IS NOT NULL
       AND jsonb_array_length(payments) > 0
  );

  RETURN json_build_object(
    'business_date',        p_date,
    'expected_cash',        cash_total,
    'expected_helcim',      helcim_total,
    'expected_card_manual', cardm_total,
    'expected_gift_card',   giftc_total,
    'expected_other',       other_total,
    'expected_total',       cash_total + helcim_total + cardm_total + giftc_total + other_total,
    'expected_tx_count',    tx_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_expected(DATE) TO authenticated;

-- Inspection:
--   SELECT id, payment_method, payments FROM sales WHERE jsonb_array_length(payments) > 0 LIMIT 10;
--   SELECT reconcile_expected(CURRENT_DATE);
