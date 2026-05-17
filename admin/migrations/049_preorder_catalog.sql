-- ============================================================
-- 049_preorder_catalog.sql — Supabase-backed pre-order product catalog
--
-- Currently the 15 products on preorder.skateos.com are hardcoded in
-- preorder/index.html. This migration moves them into a real table so:
--   • Doug can add/remove products via Supabase Table Editor (or future admin UI)
--     without touching code or redeploying
--   • The catalog can drift per-tenant (multi-tenant skateOS resale)
--   • Inventory can be tracked alongside (post-MVP)
--
-- The preorder/index.html is updated to fetch from this table on load.
-- If the fetch fails (RLS issue, network blip, table missing), the page
-- falls back to a small hardcoded seed so the catalog never goes blank.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS preorder_products (
  id            TEXT PRIMARY KEY,                              -- slug like 's1-lifer-black-matte'
  brand         TEXT NOT NULL,
  name          TEXT NOT NULL,
  price         NUMERIC(10,2) NOT NULL,                        -- pre-order price (what customer pays)
  retail        NUMERIC(10,2) NOT NULL,                        -- MSRP (for strikethrough display)
  sale          BOOLEAN NOT NULL DEFAULT FALSE,                -- show "Pre-order sale" ribbon
  soon          BOOLEAN NOT NULL DEFAULT FALSE,                -- show "Coming · 1-2 wks" ribbon
  category      TEXT NOT NULL CHECK (category IN ('decks','helmets','apparel','wheels','trucks','bearings','accessories','safety','other')),
  image         TEXT NOT NULL,                                 -- supplier CDN URL
  sort_order    INTEGER NOT NULL DEFAULT 100,                  -- lower = earlier in grid
  active        BOOLEAN NOT NULL DEFAULT TRUE,                 -- false = hidden from catalog (don't delete, audit trail)
  notes         TEXT,                                          -- admin-only notes (supplier ETA, low stock warning, etc.)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_preorder_products_active   ON preorder_products(active) WHERE active;
CREATE INDEX IF NOT EXISTS idx_preorder_products_category ON preorder_products(category, sort_order);
CREATE INDEX IF NOT EXISTS idx_preorder_products_tenant   ON preorder_products(tenant_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION preorder_products_touch_updated() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_preorder_products_touch ON preorder_products;
CREATE TRIGGER trg_preorder_products_touch
  BEFORE UPDATE ON preorder_products
  FOR EACH ROW EXECUTE FUNCTION preorder_products_touch_updated();

-- RLS: anon can read active products (public catalog needs this);
--      staff can read all + write
ALTER TABLE preorder_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS preorder_products_anon_read ON preorder_products;
DROP POLICY IF EXISTS preorder_products_staff_read ON preorder_products;
DROP POLICY IF EXISTS preorder_products_staff_write ON preorder_products;
DROP POLICY IF EXISTS preorder_products_staff_update ON preorder_products;
DROP POLICY IF EXISTS preorder_products_staff_delete ON preorder_products;

-- Anon can only read ACTIVE products (so deleted/disabled ones don't leak)
CREATE POLICY preorder_products_anon_read   ON preorder_products FOR SELECT TO anon USING (active = TRUE);
-- Authenticated staff can read everything (active or not, for admin UI)
CREATE POLICY preorder_products_staff_read  ON preorder_products FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY preorder_products_staff_write ON preorder_products FOR INSERT TO authenticated WITH CHECK (is_owner());
CREATE POLICY preorder_products_staff_update ON preorder_products FOR UPDATE TO authenticated USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY preorder_products_staff_delete ON preorder_products FOR DELETE TO authenticated USING (is_owner());

GRANT SELECT ON preorder_products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON preorder_products TO authenticated;
GRANT ALL ON preorder_products TO service_role;

-- ── Seed the 15 current products ────────────────────────────────────
DO $$
DECLARE seed_tid UUID;
BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;

  -- S1 Helmets — 25% off restock
  INSERT INTO preorder_products (id, brand, name, price, retail, sale, soon, category, image, sort_order, tenant_id) VALUES
    ('s1-lifer-black-matte',  'S1', 'Lifer Helmet · Black Matte',         59.99, 79.99, TRUE,  FALSE, 'helmets', 'https://cdn11.bigcommerce.com/s-yn3wzm/images/stencil/500x500/products/147/3623/S1_Lifer_Skateboard_Helmet_34_view__66963.1687909292.jpg?c=2', 10, seed_tid),
    ('s1-lifer-white-gloss',  'S1', 'Lifer Helmet · White Gloss',         59.99, 79.99, TRUE,  FALSE, 'helmets', 'https://cdn11.bigcommerce.com/s-yn3wzm/images/stencil/500x500/products/166/2556/Lifer_WhiteGloss_34__48956.1710591970.jpg?c=2', 11, seed_tid),
    ('s1-lifer-purple-matte', 'S1', 'Lifer Helmet · Purple Matte',        59.99, 79.99, TRUE,  FALSE, 'helmets', 'https://cdn11.bigcommerce.com/s-yn3wzm/images/stencil/500x500/products/164/1050/Lifer_PurpleMatte_34__67769.1685582094.jpg?c=2', 12, seed_tid),
    ('s1-lifer-glitter',      'S1', 'Lifer Helmet · Black Gloss Glitter', 67.49, 89.99, TRUE,  FALSE, 'helmets', 'https://cdn11.bigcommerce.com/s-yn3wzm/images/stencil/500x500/products/146/1722/Lifer_BlackGlitter3_34__26996.1710317937.jpg?c=2', 13, seed_tid),
    ('s1-retro-lifer-hosoi',  'S1', 'Retro Lifer · Hosoi Black Leopard',  67.49, 89.99, TRUE,  FALSE, 'helmets', 'https://cdn11.bigcommerce.com/s-yn3wzm/images/stencil/500x500/products/551/4103/black_leopard_retro_-_hosoi_collection-s1-helmets_-_Cropped__08004.1764026502.jpg?c=2', 14, seed_tid)
  ON CONFLICT (id) DO NOTHING;

  -- GX1000 SU26 — coming 1-2 weeks
  INSERT INTO preorder_products (id, brand, name, price, retail, sale, soon, category, image, sort_order, tenant_id) VALUES
    ('gx-skydive-825',        'GX1000', 'Sky Dive Willow · 8.25"',       78,  78,  FALSE, TRUE, 'decks',   'https://gx1000.com/cdn/shop/files/GX1000SU226Board10Bottom_large.jpg?v=1778251647', 20, seed_tid),
    ('gx-skydive-850',        'GX1000', 'Sky Dive Willow · 8.50"',       78,  78,  FALSE, TRUE, 'decks',   'https://gx1000.com/cdn/shop/files/GX1000SU226Board10Bottom_8c29e685-6c6b-406e-9537-aed7a2764d0a_large.jpg?v=1778251672', 21, seed_tid),
    ('gx-viking-natural-825', 'GX1000', 'Viking Willow Natural · 8.25"', 78,  78,  FALSE, TRUE, 'decks',   'https://gx1000.com/cdn/shop/files/GX1000SU226Board11Bottom_large.jpg?v=1778251710', 22, seed_tid),
    ('gx-ranch-jacket',       'GX1000', 'Ranch Jacket · Black',          148, 148, FALSE, TRUE, 'apparel', 'https://gx1000.com/cdn/shop/files/GX1000SummerSMS1front_large.jpg?v=1778030511', 23, seed_tid),
    ('gx-leaf-hoodie',        'GX1000', 'Leaf Hoodie · Black',           120, 120, FALSE, TRUE, 'apparel', 'https://gx1000.com/cdn/shop/files/GX1000SummerSMS16front_large.jpg?v=1777425189', 24, seed_tid)
  ON CONFLICT (id) DO NOTHING;

  -- Theories Distribution — 12% prebook
  INSERT INTO preorder_products (id, brand, name, price, retail, sale, soon, category, image, sort_order, tenant_id) VALUES
    ('theories-nyle-lovett',     'Theories',      'Nyle Lovett "Champ" Pro Deck',      66.84, 75.95, TRUE, FALSE, 'decks', 'https://www.theoriesofatlantis.com/cdn/shop/files/THEORIES-NYLE-LOVETT-CHAMP-SKATEBOARD-DECK-BOTTOM.jpg?v=1773614098&width=800', 30, seed_tid),
    ('theories-tentacles',       'Theories',      'Tentacles of Destruction Deck',     65.08, 73.95, TRUE, FALSE, 'decks', 'https://www.theoriesofatlantis.com/cdn/shop/files/THEORIES-TENTACLES-SKATEBOARD-DECK-BOTTOM.jpg?v=1773614032&width=800', 31, seed_tid),
    ('killing-floor-wainwright', 'Killing Floor', 'Danny Wainwright Guest Deck',       65.08, 73.95, TRUE, FALSE, 'decks', 'https://www.theoriesofatlantis.com/cdn/shop/files/killing-floor-danny-wainwright-skateboard-deck-main.jpg?v=1774285751&width=800', 32, seed_tid),
    ('snack-gatekeeper',         'Snack',         'Gatekeeper Black Deck',             66.88, 76,    TRUE, FALSE, 'decks', 'https://www.theoriesofatlantis.com/cdn/shop/files/Snack-Skateboards-GateKeeper-Deck.jpg?v=1776185187&width=800', 33, seed_tid),
    ('magenta-rooftop',          'Magenta',       'Leo Valls × Glen Fox Rooftop Deck', 72.60, 82.50, TRUE, FALSE, 'decks', 'https://www.theoriesofatlantis.com/cdn/shop/files/MAGENTA-SKATEBOARDS-LEO-VALLS-ROOFTOP-SERIES-DECK-BOTTOM.jpg?v=1777313506&width=800', 34, seed_tid)
  ON CONFLICT (id) DO NOTHING;

EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'tenants table missing — apply migration 009 first';
END $$;
