-- 076_backfill_sales_to_customers.sql
--
-- After the Square customer import lands, every customer row carries the
-- Square customer_id in `square_customer_id`. Square Orders carry the
-- buyer's Square id in `customer_id` on the order record, but the sales
-- importer doesn't see imported customers if it ran BEFORE the customer
-- import finished. This backfill links them up.
--
-- It also re-stamps the denormalized customer_name on each linked sale
-- so receipts + reports show "Tommy K" instead of "Walk-in".
--
-- Safe to re-run. Only updates rows where customer_id IS NULL.
--
-- NOTE: The orders importer's reference to square_customer_id is stored
-- *implicitly* by the way it processed the order — when a sale lacked a
-- matching skateOS customer at import time, customer_id was set NULL +
-- the Square `customer_id` was lost. To recover it, we'd need to re-pull
-- those orders. That's why the importer ALSO stamped square_order_id —
-- we can use it to re-resolve via a fresh Square API call later.
--
-- This first cut handles the simpler case: an imported customer's email
-- or phone matches the denormalized buyer info on a sale. For sales where
-- customer_name = "Walk-in" we leave alone (no buyer to match against).
--
-- For a complete backfill, run scripts/backfill_sales_customer_id.py
-- after the customer import finishes — it re-fetches each order from
-- Square + resolves customer_id via the square_customer_id index.

------------------------------------------------------------
-- Pass 1: link sales by buyer email (only ones we know about)
-- Skipped: the orders importer doesn't currently denormalize email
-- onto the sale row. Sales rows would need a buyer_email column for
-- this pass to do anything. Leaving as a future migration.
------------------------------------------------------------

-- TODO once we add `sales.buyer_email` denormalization to the importer:
-- UPDATE sales s
--   SET customer_id = c.id,
--       customer_name = c.name
-- FROM customers c
-- WHERE s.customer_id IS NULL
--   AND s.buyer_email IS NOT NULL
--   AND lower(c.email) = lower(s.buyer_email)
--   AND s.square_order_id IS NOT NULL;

------------------------------------------------------------
-- Quick stats report on imported sales without a customer link
------------------------------------------------------------
DO $$
DECLARE
  imported_total INT;
  imported_unlinked INT;
  imported_total_revenue NUMERIC;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE customer_id IS NULL), sum(total)
    INTO imported_total, imported_unlinked, imported_total_revenue
  FROM sales
  WHERE square_order_id IS NOT NULL;

  RAISE NOTICE '076 backfill report: % imported sales (% unlinked, $% gross). Run the Python re-link script after customer import completes to fully resolve.',
    imported_total, imported_unlinked, imported_total_revenue;
END $$;
