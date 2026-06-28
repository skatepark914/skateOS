-- 075_square_sales_import.sql
--
-- Adds the columns + indexes needed to import Square Orders into `sales`
-- without duplicating on re-runs.
--
-- WHY: We're pulling historical sales from Square's Orders API into skateOS
-- so reports + customer purchase history have continuity at cutover.
-- Each Square order maps to ONE `sales` row + N `sale_items` rows.
-- The dedupe key is the Square order_id.
--
-- Apply via Supabase Management API (no DB-password gate) or paste in SQL editor.
-- Idempotent: every ALTER / CREATE INDEX uses IF NOT EXISTS.

------------------------------------------------------------
-- 1. Square dedupe column on sales
------------------------------------------------------------
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS square_order_id TEXT;

-- Unique index so re-running the importer is safe.
-- Partial so existing skateOS-native sales (NULL) don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS sales_square_order_id_key
  ON public.sales(square_order_id)
  WHERE square_order_id IS NOT NULL;

-- Helpful for "show me imported vs native" filters on the dashboard.
CREATE INDEX IF NOT EXISTS sales_square_imported_at
  ON public.sales(created_at)
  WHERE square_order_id IS NOT NULL;

------------------------------------------------------------
-- 2. Square dedupe on sale_items (the LineItem uid)
------------------------------------------------------------
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS square_line_uid TEXT;

CREATE INDEX IF NOT EXISTS sale_items_square_line_uid
  ON public.sale_items(square_line_uid)
  WHERE square_line_uid IS NOT NULL;

------------------------------------------------------------
-- 3. Customer Square cross-ref (for fuzzy customer linkage)
-- The `customers` table already has square_id from the customer importer.
-- This index speeds the lookup the sales importer does N times per batch.
------------------------------------------------------------
CREATE INDEX IF NOT EXISTS customers_square_customer_id_idx
  ON public.customers(square_customer_id)
  WHERE square_customer_id IS NOT NULL;

------------------------------------------------------------
-- 4. Progress tracking — let the importer resume mid-batch
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.square_import_state (
  kind       TEXT PRIMARY KEY,                    -- 'orders', 'customers', etc
  cursor     TEXT,                                -- Square's pagination cursor
  last_run_at TIMESTAMPTZ DEFAULT now(),
  rows_seen  INT DEFAULT 0,
  rows_inserted INT DEFAULT 0,
  rows_skipped  INT DEFAULT 0,
  errors     INT DEFAULT 0,
  status     TEXT DEFAULT 'idle',                 -- idle | running | done | error
  notes      TEXT
);

-- Seed the orders row so the importer can UPDATE without an existence check
INSERT INTO public.square_import_state(kind) VALUES('orders')
  ON CONFLICT (kind) DO NOTHING;

------------------------------------------------------------
-- 5. Verification probe
------------------------------------------------------------
DO $$
DECLARE
  has_sales_col BOOLEAN;
  has_items_col BOOLEAN;
  has_state_tbl BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_name='sales' AND column_name='square_order_id') INTO has_sales_col;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_name='sale_items' AND column_name='square_line_uid') INTO has_items_col;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_name='square_import_state' AND table_schema='public') INTO has_state_tbl;

  RAISE NOTICE '075 verification: sales.square_order_id=% sale_items.square_line_uid=% square_import_state=%',
    has_sales_col, has_items_col, has_state_tbl;
END $$;
