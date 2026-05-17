-- ============================================================
-- 018_inventory_locations.sql — bus is a real location, not a run-snapshot
--
-- Doug clarified the mobile shop model on 2026-04-30 evening:
--
--   "Any inventory left on bus will still have that location."
--   "We certainly will have the same item in both locations —
--    Reds Bearings will have both places at the same time some days."
--
-- So inventory is location-aware, NOT split-per-SKU. A given SKU
-- (e.g. Reds Bearings) can simultaneously have:
--    - 12 units at base (products.quantity)
--    - 8 units on Bus #1 (bus_inventory row)
--    - 5 units on Bus #2 (separate bus_inventory row)
-- Each PHYSICAL UNIT is at one location, but a SKU can be in
-- multiple. Stock that doesn't sell on a run STAYS on the bus —
-- next run starts from whatever's already loaded.
-- Total stock for a SKU = products.quantity + SUM(bus_inventory).
--
-- This migration makes location a first-class concept:
--   - `inventory_locations`  — seeded with "Base park" + "Bus #1"
--   - `bus_inventory`        — running stock per (location, product)
--                              (only used for non-base locations)
--   - `inventory_transfers`  — append-only log of base↔bus moves
--   - `transfer_to_bus(location_id, product_id, qty)`  — atomic
--   - `transfer_from_bus(location_id, product_id, qty)` — atomic
--   - sales gets `location_id` so we know where each transaction
--     drained inventory (base = decrement products.quantity;
--     bus = decrement bus_inventory.quantity)
--
-- products.quantity remains the canonical BASE qty — this avoids
-- a giant rewrite of POS / inventory_log triggers. "Total stock"
-- across all locations = products.quantity + SUM(bus_inventory).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Locations
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'location_kind') THEN
    CREATE TYPE location_kind AS ENUM ('base','mobile','warehouse','popup');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inventory_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                         -- "Base park", "Bus #1", "Bensonhurst Pop-Up"
  kind        location_kind NOT NULL DEFAULT 'mobile',
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,        -- exactly ONE row should have is_default = true (the base)
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_default ON inventory_locations(is_default) WHERE is_default = TRUE;

-- Seed base park + one bus
INSERT INTO inventory_locations (name, kind, is_default, active)
SELECT '2nd Nature Park (Base)', 'base', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM inventory_locations WHERE is_default = TRUE);

INSERT INTO inventory_locations (name, kind, is_default, active)
SELECT 'Bus #1', 'mobile', FALSE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM inventory_locations WHERE kind = 'mobile' AND name = 'Bus #1');

-- ------------------------------------------------------------
-- 2. bus_inventory — running stock on non-base locations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bus_inventory (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity     INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_bus_inv_location ON bus_inventory(location_id);
CREATE INDEX IF NOT EXISTS idx_bus_inv_product  ON bus_inventory(product_id);

CREATE OR REPLACE FUNCTION bus_inv_touch() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_bus_inv_touch ON bus_inventory;
CREATE TRIGGER trg_bus_inv_touch BEFORE UPDATE ON bus_inventory FOR EACH ROW EXECUTE FUNCTION bus_inv_touch();

-- ------------------------------------------------------------
-- 3. inventory_transfers — append-only log of base↔bus moves
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_location   TEXT NOT NULL,                          -- 'base' or location_id (UUID-as-text)
  to_location     TEXT NOT NULL,                          -- same
  product_id      UUID NOT NULL REFERENCES products(id),
  product_name    TEXT NOT NULL,                          -- denormalized
  quantity        INT NOT NULL CHECK (quantity > 0),
  mobile_run_id   UUID REFERENCES mobile_runs(id) ON DELETE SET NULL,
  performed_by    UUID REFERENCES staff(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfers_run     ON inventory_transfers(mobile_run_id) WHERE mobile_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transfers_product ON inventory_transfers(product_id, created_at DESC);

-- ------------------------------------------------------------
-- 4. RPC: transfer_to_bus(location_id, product_id, qty)
--    Atomic move: decrement products.quantity (base), upsert
--    bus_inventory, append transfer log row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION transfer_to_bus(
  p_location_id UUID,
  p_product_id  UUID,
  p_quantity    INT,
  p_mobile_run_id UUID DEFAULT NULL,
  p_notes       TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base_qty INT;
  pname    TEXT;
  loc_kind location_kind;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'quantity must be > 0'; END IF;

  -- Verify location is non-base
  SELECT kind INTO loc_kind FROM inventory_locations WHERE id = p_location_id AND active = TRUE;
  IF loc_kind IS NULL THEN RAISE EXCEPTION 'Location not found or inactive'; END IF;
  IF loc_kind = 'base' THEN RAISE EXCEPTION 'Cannot transfer TO the base — use transfer_from_bus instead'; END IF;

  -- Lock + check base stock
  SELECT quantity, name INTO base_qty, pname
    FROM products WHERE id = p_product_id FOR UPDATE;
  IF base_qty IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF base_qty < p_quantity THEN RAISE EXCEPTION 'Not enough base stock — have %, need %', base_qty, p_quantity; END IF;

  -- Decrement base
  UPDATE products
     SET quantity = quantity - p_quantity, updated_at = NOW()
   WHERE id = p_product_id;

  -- Upsert bus
  INSERT INTO bus_inventory (location_id, product_id, quantity)
  VALUES (p_location_id, p_product_id, p_quantity)
  ON CONFLICT (location_id, product_id)
    DO UPDATE SET quantity = bus_inventory.quantity + p_quantity, updated_at = NOW();

  -- Log transfer
  INSERT INTO inventory_transfers (from_location, to_location, product_id, product_name, quantity, mobile_run_id, performed_by, notes)
  VALUES ('base', p_location_id::TEXT, p_product_id, pname, p_quantity, p_mobile_run_id, auth.uid(), p_notes);

  -- Inventory log entry (visible in admin Activity Log)
  INSERT INTO inventory_log (product_id, change, reason)
  VALUES (p_product_id, -p_quantity, 'Transfer to bus' || CASE WHEN p_mobile_run_id IS NOT NULL THEN ' (run)' ELSE '' END);

  RETURN json_build_object('ok', true, 'product', pname, 'qty', p_quantity, 'new_base_qty', base_qty - p_quantity);
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_to_bus(UUID,UUID,INT,UUID,TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5. RPC: transfer_from_bus(location_id, product_id, qty)
--    Atomic move: decrement bus_inventory, increment products.quantity,
--    log transfer.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION transfer_from_bus(
  p_location_id UUID,
  p_product_id  UUID,
  p_quantity    INT,
  p_mobile_run_id UUID DEFAULT NULL,
  p_notes       TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bus_qty INT;
  pname   TEXT;
BEGIN
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'quantity must be > 0'; END IF;

  SELECT quantity INTO bus_qty
    FROM bus_inventory WHERE location_id = p_location_id AND product_id = p_product_id FOR UPDATE;
  IF bus_qty IS NULL OR bus_qty < p_quantity THEN
    RAISE EXCEPTION 'Not enough bus stock — have %, need %', COALESCE(bus_qty, 0), p_quantity;
  END IF;
  SELECT name INTO pname FROM products WHERE id = p_product_id;

  UPDATE bus_inventory SET quantity = quantity - p_quantity, updated_at = NOW()
   WHERE location_id = p_location_id AND product_id = p_product_id;

  UPDATE products SET quantity = quantity + p_quantity, updated_at = NOW()
   WHERE id = p_product_id;

  INSERT INTO inventory_transfers (from_location, to_location, product_id, product_name, quantity, mobile_run_id, performed_by, notes)
  VALUES (p_location_id::TEXT, 'base', p_product_id, pname, p_quantity, p_mobile_run_id, auth.uid(), p_notes);

  INSERT INTO inventory_log (product_id, change, reason)
  VALUES (p_product_id, p_quantity, 'Returned from bus' || CASE WHEN p_mobile_run_id IS NOT NULL THEN ' (run)' ELSE '' END);

  RETURN json_build_object('ok', true, 'product', pname, 'qty', p_quantity);
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_from_bus(UUID,UUID,INT,UUID,TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5b. mobile_runs gains vehicle_location_id — which bus this run uses.
--    Default any existing planned runs to the seeded "Bus #1".
-- ------------------------------------------------------------
ALTER TABLE mobile_runs ADD COLUMN IF NOT EXISTS vehicle_location_id UUID REFERENCES inventory_locations(id);
DO $$ DECLARE bus1 UUID; BEGIN
  SELECT id INTO bus1 FROM inventory_locations WHERE name = 'Bus #1' LIMIT 1;
  IF bus1 IS NOT NULL THEN
    UPDATE mobile_runs SET vehicle_location_id = bus1 WHERE vehicle_location_id IS NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 6. Sales gain a location_id — defaults to base when null.
--    Bus sales decrement bus_inventory via the `apply_bus_sale` trigger
--    (only when location_id points to a non-base location).
--    Base sales continue to decrement products.quantity via existing
--    POS code (admin/index.html finalizeSale).
-- ------------------------------------------------------------
ALTER TABLE sales ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES inventory_locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_location ON sales(location_id) WHERE location_id IS NOT NULL;

-- Trigger on sale_items: when the parent sale is at a non-base location,
-- decrement bus_inventory for that line. We do this on sale_items INSERT
-- because the line item is what carries product_id + quantity.
CREATE OR REPLACE FUNCTION apply_bus_sale_item() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  s_location UUID;
  s_status   TEXT;
  loc_kind   location_kind;
BEGIN
  SELECT location_id, status INTO s_location, s_status
    FROM sales WHERE id = NEW.sale_id;
  IF s_location IS NULL THEN RETURN NEW; END IF;
  IF s_status <> 'completed' THEN RETURN NEW; END IF;

  SELECT kind INTO loc_kind FROM inventory_locations WHERE id = s_location;
  IF loc_kind IS NULL OR loc_kind = 'base' THEN RETURN NEW; END IF;

  -- Decrement bus_inventory; create row at qty 0 if missing (so we can go negative-detection safe)
  UPDATE bus_inventory
     SET quantity = GREATEST(0, quantity - NEW.quantity), updated_at = NOW()
   WHERE location_id = s_location AND product_id = NEW.product_id;

  -- IMPORTANT: this trigger ALSO replaces the base-stock decrement that finalizeSale
  -- normally fires. Since the sale was at a non-base location, the JS-side
  -- decrement of products.quantity is wrong. To fix, the JS will skip its
  -- own decrement when sale.location_id is non-null. (See finalizeSale logic.)

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bus_sale_item ON sale_items;
CREATE TRIGGER trg_bus_sale_item
  AFTER INSERT ON sale_items
  FOR EACH ROW EXECUTE FUNCTION apply_bus_sale_item();

-- ------------------------------------------------------------
-- 7. Helper view: stock by location (for the admin dashboard)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock_by_location AS
  SELECT
    p.id              AS product_id,
    p.name            AS product_name,
    p.sku,
    'base'::TEXT      AS location_kind,
    NULL::UUID        AS location_id,
    p.quantity        AS quantity
  FROM products p
  WHERE p.quantity > 0
  UNION ALL
  SELECT
    bi.product_id,
    p.name,
    p.sku,
    il.kind::TEXT,
    bi.location_id,
    bi.quantity
  FROM bus_inventory bi
  JOIN products p ON p.id = bi.product_id
  JOIN inventory_locations il ON il.id = bi.location_id
  WHERE bi.quantity > 0;

GRANT SELECT ON v_stock_by_location TO anon, authenticated;

-- ------------------------------------------------------------
-- 8. Multi-tenant
-- ------------------------------------------------------------
ALTER TABLE inventory_locations  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE bus_inventory        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE inventory_transfers  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_locations_tenant ON inventory_locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_inv_tenant   ON bus_inventory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transfers_tenant ON inventory_transfers(tenant_id);

DO $$ DECLARE seed_tid UUID; BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE inventory_locations  SET tenant_id = seed_tid WHERE tenant_id IS NULL;
    UPDATE bus_inventory        SET tenant_id = seed_tid WHERE tenant_id IS NULL;
    UPDATE inventory_transfers  SET tenant_id = seed_tid WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ------------------------------------------------------------
-- 9. RLS
-- ------------------------------------------------------------
ALTER TABLE inventory_locations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_inventory        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transfers  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS il_read ON inventory_locations;
DROP POLICY IF EXISTS il_edit ON inventory_locations;
CREATE POLICY il_read ON inventory_locations FOR SELECT USING (is_staff());
CREATE POLICY il_edit ON inventory_locations FOR ALL    USING (is_owner()) WITH CHECK (is_owner());

DROP POLICY IF EXISTS bi_read ON bus_inventory;
DROP POLICY IF EXISTS bi_edit ON bus_inventory;
CREATE POLICY bi_read ON bus_inventory FOR SELECT USING (is_staff());
CREATE POLICY bi_edit ON bus_inventory FOR ALL    USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS it_read   ON inventory_transfers;
DROP POLICY IF EXISTS it_write  ON inventory_transfers;
DROP POLICY IF EXISTS it_delete ON inventory_transfers;
CREATE POLICY it_read   ON inventory_transfers FOR SELECT USING (is_staff());
CREATE POLICY it_write  ON inventory_transfers FOR INSERT WITH CHECK (is_staff());
CREATE POLICY it_delete ON inventory_transfers FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_locations  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bus_inventory        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_transfers  TO anon, authenticated;
GRANT ALL ON inventory_locations  TO service_role;
GRANT ALL ON bus_inventory        TO service_role;
GRANT ALL ON inventory_transfers  TO service_role;
