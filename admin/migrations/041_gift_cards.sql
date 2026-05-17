-- ============================================================
-- 041_gift_cards.sql — gift card sale + redemption
--
-- Two tables:
--   gift_cards               — one row per issued card
--   gift_card_transactions   — append-only ledger of every balance change
--
-- Workflow:
--   1. Cashier sells a gift card → POST sales row (synthetic line item)
--      + INSERT gift_cards (code, original_amount, balance=original_amount, ...)
--      + INSERT gift_card_transactions (delta=+original_amount, balance_after=original_amount)
--   2. Cashier redeems → at POS, types code → admin looks up card,
--      validates balance + status, applies min(balance, subtotal) as discount
--   3. On sale finalize → INSERT gift_card_transactions (delta=-applied,
--      balance_after=new_balance, sale_id=...)
--      + UPDATE gift_cards SET balance=new_balance,
--        status='redeemed' if balance hits 0
--
-- Codes: 12 random digits (collision-safe at skatepark scale, easy to type
-- off a printed receipt). Generated client-side; UNIQUE INDEX is the safety net.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS gift_cards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,
  original_amount       NUMERIC(10,2) NOT NULL CHECK (original_amount > 0),
  balance               NUMERIC(10,2) NOT NULL CHECK (balance >= 0),
  status                TEXT NOT NULL DEFAULT 'issued'
                          CHECK (status IN ('issued','partial','redeemed','refunded','expired','cancelled')),
  issued_to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  issued_to_name        TEXT,
  issued_to_email       TEXT,
  recipient_name        TEXT,                 -- gift recipient (often different from buyer)
  recipient_email       TEXT,
  recipient_phone       TEXT,                 -- so the buyer can text the code to the recipient
  message               TEXT,                 -- "happy birthday Tommy!"
  expires_at            DATE,
  notes                 TEXT,
  issued_by             UUID REFERENCES staff(id),
  issued_sale_id        UUID REFERENCES sales(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id             UUID REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_code     ON gift_cards (code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status   ON gift_cards (status) WHERE status IN ('issued','partial');
CREATE INDEX IF NOT EXISTS idx_gift_cards_customer ON gift_cards (issued_to_customer_id) WHERE issued_to_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id    UUID NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  sale_id         UUID REFERENCES sales(id) ON DELETE SET NULL,
  delta           NUMERIC(10,2) NOT NULL,    -- +amount on issue, -amount on redeem, +amount on refund
  balance_after   NUMERIC(10,2) NOT NULL,
  reason          TEXT NOT NULL DEFAULT 'redeem'
                    CHECK (reason IN ('issue','redeem','refund','adjust','expire','cancel')),
  actor_id        UUID REFERENCES staff(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gct_card  ON gift_card_transactions (gift_card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gct_sale  ON gift_card_transactions (sale_id) WHERE sale_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION gift_cards_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gift_cards_updated_at ON gift_cards;
CREATE TRIGGER trg_gift_cards_updated_at
  BEFORE UPDATE ON gift_cards
  FOR EACH ROW EXECUTE FUNCTION gift_cards_set_updated_at();

-- RLS — match the rest of the app's pattern: authenticated reads/writes,
-- multi-tenant ready (tenant_id checked via current_tenant_id() helper from
-- migration 009). Skip RLS Part B equivalent for now since the rest of the
-- app is also still in Phase A.
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_card_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gift_cards_all ON gift_cards;
CREATE POLICY gift_cards_all ON gift_cards
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS gct_all ON gift_card_transactions;
CREATE POLICY gct_all ON gift_card_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Public balance lookup — anyone with the code can check the balance without
-- logging in (standard gift card UX). The code itself is the access token;
-- 12 random digits = ~10^12 keyspace, brute-force-resistant for casual abuse.
-- Returns ONLY balance + status + recipient + expiry — no buyer or message.
-- SECURITY DEFINER bypasses RLS so anon role can call it.
CREATE OR REPLACE FUNCTION gift_card_balance_lookup(p_code TEXT)
RETURNS TABLE (
  balance         NUMERIC,
  original_amount NUMERIC,
  status          TEXT,
  recipient_name  TEXT,
  expires_at      DATE
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT balance, original_amount, status, recipient_name, expires_at
    FROM gift_cards
   WHERE code = p_code
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION gift_card_balance_lookup(TEXT) TO anon, authenticated;

-- Inspection:
--   SELECT code, original_amount, balance, status, recipient_name FROM gift_cards
--    ORDER BY created_at DESC LIMIT 20;
--   SELECT * FROM gift_card_transactions WHERE gift_card_id = '...' ORDER BY created_at DESC;
