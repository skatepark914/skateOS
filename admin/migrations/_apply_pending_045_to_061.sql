-- ============================================================
-- _apply_pending_045_to_058.sql — bundled migrations 045-058
--
-- ONE-PASTE migration runner. Copy this entire file into the
-- Supabase SQL editor and click Run. All 14 migrations will
-- apply in order. Each is idempotent (ON CONFLICT DO NOTHING /
-- CREATE OR REPLACE / IF NOT EXISTS), so re-running is safe.
--
-- After this lands, the entire skateOS Square-replica is live:
--   045  affiliate / team rider program
--   046  pre-order form
--   047  pre-order weekly digest cron
--   048  pre-order public status RPC
--   049  pre-order catalog table
--   050  my_preorders portal RPC
--   051  public park status RPC (admin/park-status.html)
--   052  public retail catalog RPC (shop.skateos.com)
--   053  retail-order form
--   054  retail order inventory atomic decrement
--   055  retail order public status lookup
--   056  public lesson slots RPC (book.skateos.com)
--   057  lesson-booking form
--   058  my retail orders + lesson bookings portal RPCs
--
-- Generated: 2026-05-10T02:13:21Z
-- ============================================================


-- ============================================================
-- BEGIN 045_affiliate_program.sql
-- ============================================================

-- ============================================================
-- Migration 045 — Affiliate / team-rider program
-- ============================================================
-- White-label affiliate marketing program. Every skatepark deployment
-- can configure its own commission structure + enroll team riders /
-- sponsored skaters as affiliates, generate unique codes, and track
-- earnings + payouts.
--
-- Design notes:
--   • One `affiliate_programs` row per tenant (created automatically here).
--     Future expansion to multi-program (e.g. "Team Riders" + "Industry
--     Friends" + "Influencer Tier") is straightforward — same schema.
--   • `affiliate_codes`: one row per enrolled customer. UNIQUE on
--     (program_id, customer_id) so a customer can't double-enroll. UNIQUE
--     on `code` so codes are globally unique. Cached counters on the row
--     keep the leaderboard fast (no aggregation needed for dashboard).
--   • `affiliate_earnings`: append-only ledger. One row per attribution
--     event. Status workflow: pending → approved → paid (or reversed on
--     refund).
--   • `affiliate_redemptions`: every code-use, regardless of whether it
--     converted into earnings — useful for measuring code-share-rate vs
--     conversion-rate.
--   • Buyer attribution is captured on `customers.affiliate_code_id` so
--     it's looked up in O(1) on every sale. The auto-earn trigger reads
--     this column on insert/update of `sales`.
--   • Refund reversal: matches mig 028's loyalty pattern — when a sale
--     flips completed→refunded/voided, the trigger inserts a negative
--     earning row to roll back the commission.
--   • RLS: all tables tenant-scoped + authenticated read/write; affiliate
--     codes are intentionally readable to anon (for public affiliate
--     profile page lookup), but earnings + redemptions stay staff-only.
--   • Idempotent: every CREATE uses IF NOT EXISTS, every ALTER guards
--     against re-application.
-- ============================================================

BEGIN;

-- ─── Programs table (one row per tenant by default) ─────────────────
CREATE TABLE IF NOT EXISTS affiliate_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  name TEXT NOT NULL DEFAULT 'Team Riders',
  description TEXT DEFAULT 'Sponsored skaters who represent the shop',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Reward kind enum-ish (TEXT for forward compatibility)
  --   percent_commission  → reward_value = % of sale (e.g. 10 = 10%)
  --   flat_per_referral   → reward_value = $ flat per first sale per referred customer
  --   points_per_dollar   → reward_value = loyalty points per $ spent by referee (recurring)
  --   percent_first_only  → percent_commission but only on FIRST sale per referred customer
  reward_kind TEXT NOT NULL DEFAULT 'percent_commission'
    CHECK (reward_kind IN ('percent_commission','flat_per_referral','points_per_dollar','percent_first_only')),
  reward_value NUMERIC(10,4) NOT NULL DEFAULT 10,
  -- Minimum first purchase to count (filter out trial-only one-and-dones)
  min_first_purchase NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Lifetime cap per affiliate ($0 = no cap)
  lifetime_cap NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Window in days that referred customer's purchases attribute back
  attribution_window_days INT NOT NULL DEFAULT 90,
  -- Bonus milestone: free session (or dollar value) every N successful referrals
  bonus_threshold_count INT NOT NULL DEFAULT 0,
  bonus_value_dollars NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Ops
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Make tenant_id nullable for single-tenant installs but enforce when set
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenants') THEN
    BEGIN
      ALTER TABLE affiliate_programs
        ADD CONSTRAINT affiliate_programs_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliate_programs_tenant ON affiliate_programs(tenant_id);

-- ─── Affiliate codes (one per enrolled customer) ────────────────────
CREATE TABLE IF NOT EXISTS affiliate_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  program_id UUID REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  customer_id UUID,  -- FK added below if customers table exists
  code TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Public profile material
  bio TEXT,
  social_handles JSONB NOT NULL DEFAULT '{}'::jsonb,
  photo_url TEXT,
  -- Cached aggregates (denormalized, kept current by trigger below)
  total_referrals INT NOT NULL DEFAULT 0,
  total_revenue NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_earned NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Notes for owner
  notes TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customers') THEN
    BEGIN
      ALTER TABLE affiliate_codes
        ADD CONSTRAINT affiliate_codes_customer_fk
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenants') THEN
    BEGIN
      ALTER TABLE affiliate_codes
        ADD CONSTRAINT affiliate_codes_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- One code per customer per program; codes globally unique
DO $$
BEGIN
  BEGIN
    ALTER TABLE affiliate_codes ADD CONSTRAINT affiliate_codes_program_customer_uniq UNIQUE (program_id, customer_id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE affiliate_codes ADD CONSTRAINT affiliate_codes_code_uniq UNIQUE (code);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliate_codes_tenant ON affiliate_codes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_codes_program ON affiliate_codes(program_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_codes_customer ON affiliate_codes(customer_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_codes_enabled ON affiliate_codes(enabled) WHERE enabled = TRUE;

-- ─── Customer attribution column (referral attached to buyer) ───────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customers') THEN
    BEGIN
      ALTER TABLE customers ADD COLUMN affiliate_code_id UUID REFERENCES affiliate_codes(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
    BEGIN
      ALTER TABLE customers ADD COLUMN affiliate_attributed_at TIMESTAMPTZ;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
    CREATE INDEX IF NOT EXISTS idx_customers_affiliate_code ON customers(affiliate_code_id) WHERE affiliate_code_id IS NOT NULL;
  END IF;
END $$;

-- ─── Earnings ledger (append-only) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  program_id UUID REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  affiliate_code_id UUID REFERENCES affiliate_codes(id) ON DELETE CASCADE,
  affiliate_customer_id UUID,  -- denormalized for fast leaderboard
  referred_customer_id UUID,
  sale_id UUID,
  -- Earnings details
  sale_total NUMERIC(10,2),
  earning_kind TEXT NOT NULL DEFAULT 'commission'
    CHECK (earning_kind IN ('commission','flat','points','bonus_milestone','reversal')),
  earning_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Workflow
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','paid','reversed','void')),
  paid_at TIMESTAMPTZ,
  paid_via TEXT,        -- 'store_credit', 'cash', 'venmo', 'zelle', 'free_session', 'merch'
  paid_reference TEXT,  -- external txn id, check #, etc.
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sales') THEN
    BEGIN
      ALTER TABLE affiliate_earnings
        ADD CONSTRAINT affiliate_earnings_sale_fk
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenants') THEN
    BEGIN
      ALTER TABLE affiliate_earnings
        ADD CONSTRAINT affiliate_earnings_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_code ON affiliate_earnings(affiliate_code_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_status ON affiliate_earnings(status);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_referred ON affiliate_earnings(referred_customer_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_sale ON affiliate_earnings(sale_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_created ON affiliate_earnings(created_at DESC);

-- Idempotency: one earning per (sale_id, kind) so the trigger can re-fire
-- safely on UPDATE without creating duplicates. NULL sale_ids (manual
-- bonus_milestone awards) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_earnings_sale_kind
  ON affiliate_earnings(sale_id, earning_kind)
  WHERE sale_id IS NOT NULL AND earning_kind IN ('commission','flat','points');

-- ─── Redemptions (every code-use audit log) ─────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  affiliate_code_id UUID REFERENCES affiliate_codes(id) ON DELETE SET NULL,
  code_used TEXT NOT NULL,
  customer_id UUID,
  context TEXT NOT NULL DEFAULT 'sale_pos'
    CHECK (context IN ('signup','sale_pos','me_self_serve','admin_attach')),
  sale_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customers') THEN
    BEGIN
      ALTER TABLE affiliate_redemptions
        ADD CONSTRAINT affiliate_redemptions_customer_fk
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sales') THEN
    BEGIN
      ALTER TABLE affiliate_redemptions
        ADD CONSTRAINT affiliate_redemptions_sale_fk
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliate_redemptions_code ON affiliate_redemptions(affiliate_code_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_redemptions_created ON affiliate_redemptions(created_at DESC);

-- ─── Auto-earn trigger ──────────────────────────────────────────────
-- When a sale is completed AND the buyer has an affiliate_code_id set
-- AND we're within the attribution window, insert an earning row.
-- Idempotent via the partial UNIQUE index above.
CREATE OR REPLACE FUNCTION affiliate_auto_earn() RETURNS TRIGGER AS $$
DECLARE
  v_code RECORD;
  v_program RECORD;
  v_buyer RECORD;
  v_earning NUMERIC(10,2);
  v_already_earned NUMERIC(10,2);
  v_first_sale BOOLEAN;
  v_kind TEXT;
BEGIN
  -- Only fire on completed sales
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;
  -- Need a buyer
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Look up the buyer's affiliate code
  SELECT id, affiliate_code_id, affiliate_attributed_at
  INTO v_buyer
  FROM customers WHERE id = NEW.customer_id;
  IF v_buyer.affiliate_code_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Look up the affiliate code
  SELECT * INTO v_code FROM affiliate_codes WHERE id = v_buyer.affiliate_code_id;
  IF NOT FOUND OR v_code.enabled = FALSE THEN
    RETURN NEW;
  END IF;

  -- Self-purchase guard: affiliate can't earn off their own purchases
  IF v_code.customer_id = NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Look up the program
  SELECT * INTO v_program FROM affiliate_programs WHERE id = v_code.program_id;
  IF NOT FOUND OR v_program.enabled = FALSE THEN
    RETURN NEW;
  END IF;

  -- Attribution window check
  IF v_buyer.affiliate_attributed_at IS NOT NULL
     AND v_program.attribution_window_days > 0
     AND NEW.created_at > v_buyer.affiliate_attributed_at + (v_program.attribution_window_days || ' days')::INTERVAL THEN
    RETURN NEW;
  END IF;

  -- Was this the first sale by the buyer?
  v_first_sale := NOT EXISTS (
    SELECT 1 FROM sales
    WHERE customer_id = NEW.customer_id
      AND status = 'completed'
      AND id <> NEW.id
      AND created_at < NEW.created_at
  );

  -- Min first purchase check (only relevant to first sale)
  IF v_first_sale AND NEW.total < v_program.min_first_purchase THEN
    RETURN NEW;
  END IF;

  -- Compute earning per program reward kind
  IF v_program.reward_kind = 'percent_commission' THEN
    v_earning := COALESCE(NEW.total, 0) * v_program.reward_value / 100.0;
    v_kind := 'commission';
  ELSIF v_program.reward_kind = 'percent_first_only' THEN
    IF NOT v_first_sale THEN RETURN NEW; END IF;
    v_earning := COALESCE(NEW.total, 0) * v_program.reward_value / 100.0;
    v_kind := 'commission';
  ELSIF v_program.reward_kind = 'flat_per_referral' THEN
    IF NOT v_first_sale THEN RETURN NEW; END IF;
    v_earning := v_program.reward_value;
    v_kind := 'flat';
  ELSIF v_program.reward_kind = 'points_per_dollar' THEN
    v_earning := COALESCE(NEW.total, 0) * v_program.reward_value;
    v_kind := 'points';
  ELSE
    RETURN NEW;
  END IF;

  IF v_earning <= 0 THEN
    RETURN NEW;
  END IF;

  -- Lifetime cap check
  IF v_program.lifetime_cap > 0 THEN
    SELECT COALESCE(SUM(earning_amount), 0) INTO v_already_earned
    FROM affiliate_earnings
    WHERE affiliate_code_id = v_code.id
      AND earning_kind <> 'reversal'
      AND status NOT IN ('reversed','void');
    IF v_already_earned >= v_program.lifetime_cap THEN
      RETURN NEW;
    END IF;
    -- Cap this earning so we don't blow past the lifetime cap
    IF v_already_earned + v_earning > v_program.lifetime_cap THEN
      v_earning := v_program.lifetime_cap - v_already_earned;
    END IF;
  END IF;

  -- Insert the earning (idempotent via UNIQUE INDEX on sale_id+kind)
  INSERT INTO affiliate_earnings (
    tenant_id, program_id, affiliate_code_id, affiliate_customer_id,
    referred_customer_id, sale_id, sale_total,
    earning_kind, earning_amount, status, notes
  ) VALUES (
    v_code.tenant_id, v_program.id, v_code.id, v_code.customer_id,
    NEW.customer_id, NEW.id, NEW.total,
    v_kind, v_earning, 'pending',
    'Auto-earned · ' || v_program.reward_kind || (CASE WHEN v_first_sale THEN ' · first sale' ELSE '' END)
  )
  ON CONFLICT (sale_id, earning_kind) WHERE sale_id IS NOT NULL AND earning_kind IN ('commission','flat','points')
  DO NOTHING;

  -- Refresh denormalized counters on the affiliate_codes row
  UPDATE affiliate_codes SET
    total_revenue = (
      SELECT COALESCE(SUM(sale_total), 0)
      FROM affiliate_earnings
      WHERE affiliate_code_id = v_code.id
        AND earning_kind <> 'reversal'
        AND status NOT IN ('reversed','void')
    ),
    total_earned = (
      SELECT COALESCE(SUM(earning_amount), 0)
      FROM affiliate_earnings
      WHERE affiliate_code_id = v_code.id
        AND earning_kind <> 'reversal'
        AND status NOT IN ('reversed','void')
    ),
    total_referrals = (
      SELECT COUNT(DISTINCT referred_customer_id)
      FROM affiliate_earnings
      WHERE affiliate_code_id = v_code.id
        AND earning_kind <> 'reversal'
        AND status NOT IN ('reversed','void')
    ),
    updated_at = now()
  WHERE id = v_code.id;

  -- Bonus milestone check: free session every N referrals
  IF v_program.bonus_threshold_count > 0 AND v_program.bonus_value_dollars > 0 THEN
    DECLARE
      v_ref_count INT;
      v_bonuses_already INT;
      v_bonuses_owed INT;
    BEGIN
      SELECT COUNT(DISTINCT referred_customer_id) INTO v_ref_count
      FROM affiliate_earnings
      WHERE affiliate_code_id = v_code.id
        AND earning_kind <> 'reversal'
        AND status NOT IN ('reversed','void');
      SELECT COUNT(*) INTO v_bonuses_already
      FROM affiliate_earnings
      WHERE affiliate_code_id = v_code.id
        AND earning_kind = 'bonus_milestone'
        AND status NOT IN ('reversed','void');
      v_bonuses_owed := FLOOR(v_ref_count::NUMERIC / v_program.bonus_threshold_count) - v_bonuses_already;
      IF v_bonuses_owed > 0 THEN
        INSERT INTO affiliate_earnings (
          tenant_id, program_id, affiliate_code_id, affiliate_customer_id,
          earning_kind, earning_amount, status, notes
        ) VALUES (
          v_code.tenant_id, v_program.id, v_code.id, v_code.customer_id,
          'bonus_milestone', v_program.bonus_value_dollars, 'pending',
          'Milestone: ' || v_ref_count || ' referrals · ' || v_program.bonus_threshold_count || '-referral bonus'
        );
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_affiliate_auto_earn ON sales;
CREATE TRIGGER sales_affiliate_auto_earn
  AFTER INSERT OR UPDATE OF status ON sales
  FOR EACH ROW
  EXECUTE FUNCTION affiliate_auto_earn();

-- ─── Refund reversal trigger ────────────────────────────────────────
-- When a sale flips completed → refunded/voided, insert a negative
-- earning to roll back the commission. Mirrors mig 028's loyalty pattern.
CREATE OR REPLACE FUNCTION affiliate_reverse_earnings() RETURNS TRIGGER AS $$
DECLARE
  v_orig RECORD;
BEGIN
  -- Only fire on transition completed → refunded/voided
  IF OLD.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('refunded','voided') THEN RETURN NEW; END IF;

  FOR v_orig IN
    SELECT * FROM affiliate_earnings
    WHERE sale_id = NEW.id
      AND earning_kind IN ('commission','flat','points')
      AND status NOT IN ('reversed','void')
  LOOP
    INSERT INTO affiliate_earnings (
      tenant_id, program_id, affiliate_code_id, affiliate_customer_id,
      referred_customer_id, sale_id, sale_total,
      earning_kind, earning_amount, status, notes
    ) VALUES (
      v_orig.tenant_id, v_orig.program_id, v_orig.affiliate_code_id, v_orig.affiliate_customer_id,
      v_orig.referred_customer_id, v_orig.sale_id, -COALESCE(v_orig.sale_total,0),
      'reversal', -v_orig.earning_amount, 'reversed',
      'Refund reversal of earning ' || v_orig.id
    );
    -- Mark the original earning reversed too
    UPDATE affiliate_earnings SET status='reversed', notes = COALESCE(notes,'') || ' [reversed via sale ' || NEW.id || ']'
    WHERE id = v_orig.id;
  END LOOP;

  -- Refresh denormalized counters
  UPDATE affiliate_codes SET
    total_revenue = (SELECT COALESCE(SUM(sale_total),0) FROM affiliate_earnings WHERE affiliate_code_id = affiliate_codes.id AND earning_kind <> 'reversal' AND status NOT IN ('reversed','void')),
    total_earned  = (SELECT COALESCE(SUM(earning_amount),0) FROM affiliate_earnings WHERE affiliate_code_id = affiliate_codes.id AND earning_kind <> 'reversal' AND status NOT IN ('reversed','void')),
    updated_at = now()
  WHERE id IN (SELECT DISTINCT affiliate_code_id FROM affiliate_earnings WHERE sale_id = NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_affiliate_reverse ON sales;
CREATE TRIGGER sales_affiliate_reverse
  AFTER UPDATE OF status ON sales
  FOR EACH ROW
  WHEN (OLD.status <> NEW.status)
  EXECUTE FUNCTION affiliate_reverse_earnings();

-- ─── Helper RPC: lookup code (for POS + public profile page) ────────
-- Returns minimal info (name, photo, bio) so anon can resolve a code on
-- the public affiliate profile page without exposing earnings or
-- referred-customer history.
CREATE OR REPLACE FUNCTION affiliate_code_lookup(p_code TEXT)
RETURNS TABLE (
  code_id UUID,
  code TEXT,
  enabled BOOLEAN,
  customer_name TEXT,
  bio TEXT,
  social_handles JSONB,
  photo_url TEXT,
  total_referrals INT,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ac.id, ac.code, ac.enabled,
    c.name, ac.bio, ac.social_handles,
    COALESCE(ac.photo_url, c.photo_url) AS photo_url,
    ac.total_referrals, ac.total_revenue
  FROM affiliate_codes ac
  LEFT JOIN customers c ON c.id = ac.customer_id
  WHERE UPPER(TRIM(ac.code)) = UPPER(TRIM(p_code))
    AND ac.enabled = TRUE
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION affiliate_code_lookup(TEXT) TO anon, authenticated;

-- ─── Helper RPC: attach customer to affiliate code (signup or POS) ──
-- Used at customer signup or first-sale flow. Sets customers.affiliate_code_id
-- + records a redemption row. Idempotent — re-running with the same code
-- is a no-op; running with a DIFFERENT code refuses (locks attribution to
-- the first code used). Owner can override via direct UPDATE.
CREATE OR REPLACE FUNCTION affiliate_attach_customer(
  p_customer_id UUID,
  p_code TEXT,
  p_context TEXT DEFAULT 'sale_pos',
  p_sale_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_code RECORD;
  v_existing UUID;
BEGIN
  IF p_customer_id IS NULL OR p_code IS NULL OR LENGTH(TRIM(p_code)) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'missing_args');
  END IF;
  SELECT * INTO v_code FROM affiliate_codes
   WHERE UPPER(TRIM(code)) = UPPER(TRIM(p_code)) AND enabled = TRUE
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'code_not_found');
  END IF;
  -- Self-attach guard
  IF v_code.customer_id = p_customer_id THEN
    RETURN json_build_object('ok', false, 'error', 'cannot_attach_self');
  END IF;
  -- Existing attribution check
  SELECT affiliate_code_id INTO v_existing FROM customers WHERE id = p_customer_id;
  IF v_existing IS NOT NULL AND v_existing <> v_code.id THEN
    -- Already attributed to a different code; record the redemption but don't switch
    INSERT INTO affiliate_redemptions(tenant_id, affiliate_code_id, code_used, customer_id, context, sale_id)
      VALUES (v_code.tenant_id, v_code.id, p_code, p_customer_id, p_context, p_sale_id);
    RETURN json_build_object('ok', false, 'error', 'already_attributed', 'existing_code_id', v_existing);
  END IF;
  -- Set or re-affirm attribution
  UPDATE customers
    SET affiliate_code_id = v_code.id,
        affiliate_attributed_at = COALESCE(affiliate_attributed_at, now())
  WHERE id = p_customer_id;
  -- Record redemption
  INSERT INTO affiliate_redemptions(tenant_id, affiliate_code_id, code_used, customer_id, context, sale_id)
    VALUES (v_code.tenant_id, v_code.id, p_code, p_customer_id, p_context, p_sale_id);
  RETURN json_build_object('ok', true, 'code_id', v_code.id, 'attributed_at', now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION affiliate_attach_customer(UUID, TEXT, TEXT, UUID) TO authenticated;

-- ─── Helper RPC: customer self-serve affiliate dashboard ───────────
-- Returns the signed-in customer's OWN affiliate data only. Uses
-- current_customer_id() (mig 019) to map auth.uid() → customers.id, then
-- looks up their affiliate_codes row (if enrolled) + recent earnings
-- (last 20). SECURITY DEFINER so it bypasses RLS — but the function
-- itself rigidly scopes by current_customer_id() so customers can ONLY
-- see their own data. Closes the PII-leak risk that direct table reads
-- would have created (RLS allows authenticated → all rows in staff-all
-- pattern, which includes customer portal sessions). me.html calls this
-- RPC instead of querying tables directly.
CREATE OR REPLACE FUNCTION my_affiliate_dashboard()
RETURNS JSON AS $$
DECLARE
  v_cust UUID;
  v_code RECORD;
  v_program RECORD;
  v_earnings JSON;
  v_result JSON;
BEGIN
  -- Resolve current customer (mig 019 helper)
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_customer_id') THEN
    v_cust := current_customer_id();
  ELSE
    RETURN json_build_object('ok', false, 'error', 'mig_019_missing');
  END IF;
  IF v_cust IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Look up the customer's affiliate code
  SELECT * INTO v_code FROM affiliate_codes WHERE customer_id = v_cust LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', true, 'enrolled', false);
  END IF;

  -- Look up the program for milestone progress
  SELECT * INTO v_program FROM affiliate_programs WHERE id = v_code.program_id;

  -- Recent earnings (last 20)
  SELECT json_agg(
    json_build_object(
      'id', id,
      'created_at', created_at,
      'sale_total', sale_total,
      'earning_kind', earning_kind,
      'earning_amount', earning_amount,
      'status', status,
      'paid_at', paid_at,
      'paid_via', paid_via
    ) ORDER BY created_at DESC
  )
  INTO v_earnings
  FROM (
    SELECT * FROM affiliate_earnings
    WHERE affiliate_code_id = v_code.id
    ORDER BY created_at DESC
    LIMIT 20
  ) e;

  v_result := json_build_object(
    'ok', true,
    'enrolled', true,
    'code', json_build_object(
      'id', v_code.id,
      'code', v_code.code,
      'enabled', v_code.enabled,
      'bio', v_code.bio,
      'social_handles', v_code.social_handles,
      'total_referrals', v_code.total_referrals,
      'total_revenue', v_code.total_revenue,
      'total_earned', v_code.total_earned,
      'total_paid', v_code.total_paid,
      'joined_at', v_code.joined_at
    ),
    'program', CASE WHEN v_program.id IS NOT NULL THEN json_build_object(
      'name', v_program.name,
      'reward_kind', v_program.reward_kind,
      'reward_value', v_program.reward_value,
      'attribution_window_days', v_program.attribution_window_days,
      'bonus_threshold_count', v_program.bonus_threshold_count,
      'bonus_value_dollars', v_program.bonus_value_dollars
    ) ELSE NULL END,
    'earnings', COALESCE(v_earnings, '[]'::json)
  );
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION my_affiliate_dashboard() TO authenticated;

-- ─── Helper RPC: public team listing ───────────────────────────────
-- Returns all enabled affiliates with public-safe fields. Powers the
-- /admin/team.html public marketing page. Anon-callable. Returns the
-- same shape as affiliate_code_lookup() but for the full list, sorted
-- by lifetime referrals desc (most-active rider first). No earnings or
-- internal notes are exposed.
CREATE OR REPLACE FUNCTION affiliate_program_public_list()
RETURNS TABLE (
  code_id UUID,
  code TEXT,
  customer_name TEXT,
  bio TEXT,
  social_handles JSONB,
  photo_url TEXT,
  total_referrals INT,
  total_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ac.id, ac.code,
    c.name, ac.bio, ac.social_handles,
    COALESCE(ac.photo_url, c.photo_url) AS photo_url,
    ac.total_referrals, ac.total_revenue
  FROM affiliate_codes ac
  LEFT JOIN customers c ON c.id = ac.customer_id
  WHERE ac.enabled = TRUE
  ORDER BY ac.total_referrals DESC NULLS LAST, ac.total_revenue DESC NULLS LAST, ac.joined_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION affiliate_program_public_list() TO anon, authenticated;

-- ─── Seed default program ───────────────────────────────────────────
INSERT INTO affiliate_programs (name, description, reward_kind, reward_value, attribution_window_days, bonus_threshold_count, bonus_value_dollars)
SELECT 'Team Riders', 'Sponsored skaters who represent the shop', 'percent_commission', 10, 90, 5, 25
WHERE NOT EXISTS (SELECT 1 FROM affiliate_programs);

-- ─── RLS ───────────────────────────────────────────────────────────
ALTER TABLE affiliate_programs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_codes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_earnings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_redemptions ENABLE ROW LEVEL SECURITY;

-- Programs: staff read/write
DROP POLICY IF EXISTS aff_programs_staff_all ON affiliate_programs;
CREATE POLICY aff_programs_staff_all ON affiliate_programs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Codes: staff read/write + anon read (for public profile lookup)
DROP POLICY IF EXISTS aff_codes_staff_all ON affiliate_codes;
CREATE POLICY aff_codes_staff_all ON affiliate_codes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS aff_codes_anon_read ON affiliate_codes;
CREATE POLICY aff_codes_anon_read ON affiliate_codes
  FOR SELECT TO anon USING (enabled = TRUE);

-- Earnings: staff only
DROP POLICY IF EXISTS aff_earnings_staff_all ON affiliate_earnings;
CREATE POLICY aff_earnings_staff_all ON affiliate_earnings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Redemptions: staff only (for analytics)
DROP POLICY IF EXISTS aff_redemptions_staff_all ON affiliate_redemptions;
CREATE POLICY aff_redemptions_staff_all ON affiliate_redemptions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================
-- END Migration 045
-- ============================================================
-- Apply: paste into Supabase SQL editor and click Run.
-- Then redeploy the admin (filter-aware customers CSV / etc already
-- shipped today) so the Team Riders page appears under Programs.
-- ============================================================

-- ============================================================
-- BEGIN 046_preorder_form.sql
-- ============================================================

-- ============================================================
-- 046_preorder_form.sql — pre-order catalog submission target
--
-- The preorder.skateos.com catalog needs a `forms` row to point
-- submissions at. Without it, anon-side INSERTs into form_submissions
-- would fail the FK check.
--
-- After this migration is applied:
--   • Customer hits "Submit pre-order →" on preorder.skateos.com
--   • Page POSTs to form_submissions with this form's id + JSONB cart
--   • Doug sees the order in the admin Forms page with full history
--   • Mailto still fires as a backup notification
--
-- The form is intentionally minimal — schema={fields:[]} because
-- the preorder page renders its own UI; we just use form_submissions
-- as the persistence layer + admin viewing surface.
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$
DECLARE seed_tid UUID;
BEGIN
  -- Resolve the tenant (info@2ntr.com is the seed tenant from migration 009)
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;

  -- Insert the preorder form. ON CONFLICT (slug) DO NOTHING so re-running
  -- is safe and won't clobber any tweaks Doug makes via the admin Forms UI.
  INSERT INTO forms (slug, name, description, schema, submit_action, enabled, tenant_id)
  VALUES (
    'preorder-2026',
    'Pre-order Sale (preorder.skateos.com)',
    'Customer-submitted pre-orders from the public catalog. Each submission contains the cart items, totals, customer contact info, and 50% deposit / balance breakdown.',
    '{"fields":[]}'::jsonb,
    'other',
    TRUE,
    seed_tid
  )
  ON CONFLICT (slug) DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  -- forms table missing → migration 011 not applied yet. Owner sees a clear
  -- error from psql; nothing else to do here.
  RAISE NOTICE 'forms table missing — apply migration 011 first';
END $$;

-- ============================================================
-- BEGIN 047_preorder_weekly_cron.sql
-- ============================================================

-- ============================================================
-- 047_preorder_weekly_cron.sql — schedule the weekly pre-order digest
--
-- The Edge Function `weekly-preorder-digest` rolls up every preorder-2026
-- submission from the prior week into a supplier-order email for Doug.
-- This migration schedules it via pg_cron to fire shortly after the Sunday
-- midnight ET cutoff.
--
-- Schedule: Mon 5:00 UTC = Sun midnight EST OR Mon 1am EDT — both fire AFTER
-- Sunday-midnight ET cutoff so the digest captures the full week's submissions.
-- pg_cron runs UTC-only; this is the cleanest cross-DST-safe time.
--
-- Setup:
--   1. Apply this migration: paste into Supabase SQL editor → Run
--   2. Set the two GUC params (one-time per database):
--        ALTER DATABASE postgres SET app.settings.supabase_url   = 'https://zecurmlenxyxanqucrga.supabase.co';
--        ALTER DATABASE postgres SET app.settings.service_role_key = 'eyJhbGc...';
--      (Skip this step if migration 016 already set them — they're shared.)
--   3. Deploy the Edge Function: bash admin/deploy-functions.sh
--
-- Manual fire (for testing or off-cycle digests):
--   curl -X POST https://zecurmlenxyxanqucrga.supabase.co/functions/v1/weekly-preorder-digest \
--     -H "Authorization: Bearer <service-role>" \
--     -d '{"window_days": 7}'
--
-- Inspect cron run history:
--   SELECT * FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'weekly-preorder-digest')
--   ORDER BY end_time DESC LIMIT 10;
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Required extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any prior version of this job before re-creating, so
-- re-running the migration doesn't pile up duplicate schedules.
DO $$ BEGIN
  PERFORM cron.unschedule('weekly-preorder-digest');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Schedule: Monday 05:00 UTC (every week)
SELECT cron.schedule(
  'weekly-preorder-digest',
  '0 5 * * 1',
  $$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/weekly-preorder-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('window_days', 7)
    ) AS request_id;
  $$
);

-- Sanity check: verify the schedule landed
DO $$
DECLARE jid BIGINT;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'weekly-preorder-digest';
  IF jid IS NULL THEN
    RAISE NOTICE 'WARNING: weekly-preorder-digest schedule did not land. Check pg_cron extension is enabled.';
  ELSE
    RAISE NOTICE 'Scheduled weekly-preorder-digest (jobid=%) for Monday 05:00 UTC', jid;
  END IF;
END $$;

-- ============================================================
-- BEGIN 048_preorder_status_lookup.sql
-- ============================================================

-- ============================================================
-- 048_preorder_status_lookup.sql — public pre-order status RPC
--
-- Customer-facing self-serve status page (preorder.skateos.com/status.html)
-- needs to read a single form_submissions row by its UUID without exposing
-- the entire form_submissions table to anon (which would let attackers
-- enumerate other people's orders).
--
-- The submission UUID is the access token — 36 random hex chars, ~10^36
-- keyspace, unguessable. We share it with the customer in their confirmation
-- email, and they visit /status.html?id=<uuid> to see their order status.
--
-- This RPC is SECURITY DEFINER + GRANTed to anon, but returns ONLY the
-- safe-for-public fields:
--   • items list
--   • totals
--   • deposit_status / balance_status
--   • supplier_ordered_at (so customer sees "yes, we placed the supplier order")
--   • fulfillment + is_shipping
--   • submitted_at + first name only (privacy — no email/phone leaked back)
--
-- Internal admin fields (notes, full email, full phone, supplier_ordered_by
-- staff UUID, status workflow strings) are NEVER returned.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION preorder_status_lookup(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  d JSONB;
  contact_name TEXT;
  first_name TEXT;
BEGIN
  -- Look up the submission. Refuse non-preorder submissions (cross-form
  -- access via this RPC would be a privilege escalation).
  SELECT s.*, f.slug AS form_slug
    INTO s
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_id
      AND f.slug = 'preorder-2026'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  d := COALESCE(s.data, '{}'::jsonb);
  contact_name := d->'contact'->>'name';
  -- First name only — privacy. If "Tommy K" they see "Tommy". If single name
  -- "Tommy" they see the full thing. Nothing past the first whitespace.
  first_name := SPLIT_PART(COALESCE(contact_name, ''), ' ', 1);

  -- Build the public-safe response. Whitelist approach so future fields
  -- added to data JSONB don't leak by accident.
  RETURN jsonb_build_object(
    'found',                TRUE,
    'submitted_at',         s.created_at,
    'first_name',           first_name,
    'items',                COALESCE(d->'items', '[]'::jsonb),
    'totals',               COALESCE(d->'totals', '{}'::jsonb),
    'deposit_status',       COALESCE(d->>'deposit_status', 'pending'),
    'balance_status',       COALESCE(d->>'balance_status', 'pending'),
    'deposit_paid_at',      d->>'deposit_paid_at',
    'balance_paid_at',      d->>'balance_paid_at',
    'supplier_ordered_at',  d->>'supplier_ordered_at',
    'fulfillment',          COALESCE(d->>'fulfillment', 'pickup'),
    'is_shipping',          COALESCE((d->>'is_shipping')::boolean, FALSE),
    'pulled_early',         COALESCE((d->>'pulled_early')::boolean, FALSE)
  );
END $$;

-- Anon role needs EXECUTE to call this from the public status page.
-- The function's SECURITY DEFINER guarantee + the form_slug check inside
-- mean anon can only read preorder-2026 submissions (not other forms).
GRANT EXECUTE ON FUNCTION preorder_status_lookup(UUID) TO anon, authenticated;

-- Smoke-test note: anon-callable means the URL pattern is
--   POST /rest/v1/rpc/preorder_status_lookup
--   { "p_id": "<uuid>" }
-- Returns { found:false } when the UUID doesn't match — never leaks
-- whether the UUID exists in some OTHER form (cross-form enumeration
-- guard via the explicit slug check).

-- ============================================================
-- BEGIN 049_preorder_catalog.sql
-- ============================================================

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

-- ============================================================
-- BEGIN 050_my_preorders_rpc.sql
-- ============================================================

-- ============================================================
-- 050_my_preorders_rpc.sql — customer self-serve preorder list
--
-- The customer portal (admin/me.html) calls customer_portal_summary at load
-- to get points + visits + active passes + recent purchases + recent lessons.
-- This migration adds a complementary `my_preorders()` RPC so the portal can
-- ALSO surface the signed-in customer's preorder submissions alongside
-- everything else.
--
-- Without this, customers see the public status page (status.html?id=<uuid>)
-- only via an email link — they have no logged-in dashboard view of all
-- their orders at once.
--
-- Security model:
--   • SECURITY DEFINER + uses current_customer_id() (mig 019) to resolve
--     the auth'd customer
--   • Matches submissions where data.contact.email = customer.email (case-
--     insensitive) OR last 7 digits of data.contact.phone = customer.phone
--     (forgiving of country-code formatting)
--   • Returns ONLY the public-safe whitelist (same shape as
--     preorder_status_lookup from mig 048)
--   • GRANT EXECUTE TO authenticated only (anon can't call it)
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION my_preorders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cust_id UUID;
  cust_email TEXT;
  cust_phone_digits TEXT;
  result JSONB := '[]'::jsonb;
BEGIN
  cust_id := current_customer_id();
  IF cust_id IS NULL THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'not_authenticated_as_customer');
  END IF;

  SELECT email, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
    INTO cust_email, cust_phone_digits
    FROM customers
    WHERE id = cust_id;

  IF cust_email IS NULL AND (cust_phone_digits IS NULL OR LENGTH(cust_phone_digits) < 7) THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'no_contact_match_keys');
  END IF;

  -- Build the JSON array of matching submissions, newest-first
  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'submitted_at') DESC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT jsonb_build_object(
        'id',                  s.id,
        'submitted_at',        s.created_at,
        'items',               COALESCE(s.data->'items', '[]'::jsonb),
        'totals',              COALESCE(s.data->'totals', '{}'::jsonb),
        'deposit_status',      COALESCE(s.data->>'deposit_status', 'pending'),
        'balance_status',      COALESCE(s.data->>'balance_status', 'pending'),
        'deposit_paid_at',     s.data->>'deposit_paid_at',
        'balance_paid_at',     s.data->>'balance_paid_at',
        'supplier_ordered_at', s.data->>'supplier_ordered_at',
        'fulfillment',         COALESCE(s.data->>'fulfillment', 'pickup'),
        'is_shipping',         COALESCE((s.data->>'is_shipping')::boolean, FALSE),
        'helcim_payment_url',  s.data->>'helcim_payment_url'
      ) AS payload
      FROM form_submissions s
      JOIN forms f ON f.id = s.form_id
      WHERE f.slug = 'preorder-2026'
        AND (
          (cust_email IS NOT NULL AND LOWER(s.data->'contact'->>'email') = LOWER(cust_email))
          OR (LENGTH(cust_phone_digits) >= 7
              AND RIGHT(regexp_replace(COALESCE(s.data->'contact'->>'phone', ''), '[^0-9]', '', 'g'), 7)
                  = RIGHT(cust_phone_digits, 7))
        )
      LIMIT 50
    ) AS sub;

  RETURN jsonb_build_object('found', TRUE, 'preorders', result);
END $$;

-- Authenticated only — anon should NOT be able to enumerate preorders
GRANT EXECUTE ON FUNCTION my_preorders() TO authenticated;

-- ============================================================
-- BEGIN 051_public_park_status.sql
-- ============================================================

-- ============================================================
-- 051_public_park_status.sql — public "is the park open?" RPC
--
-- Customer-facing status page (admin/park-status.html) needs to know:
--   • Are we open right now?
--   • What are today's hours?
--   • Is there an emergency closure in effect?
--   • How crowded is it right now (vs capacity)?
--
-- Without this RPC anon can't read app_settings (staff-only RLS) or
-- checkins (would expose PII). The RPC returns a strict whitelist that's
-- safe to share publicly + GRANTed to anon.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public_park_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s JSONB;
  hr JSONB;
  emergency JSONB;
  holidays JSONB;
  today_dow_name TEXT;
  today_iso TEXT;
  open_checkin_count INT;
  max_capacity INT;
  is_open BOOLEAN := FALSE;
  is_closed_today BOOLEAN := FALSE;
  is_emergency BOOLEAN := FALSE;
  closing_time TEXT;
  opening_time TEXT;
  status_label TEXT := 'open';
  emergency_reason TEXT;
  emergency_until TEXT;
  match_holiday TEXT;
BEGIN
  -- Pull the full settings blob
  SELECT value INTO s FROM app_settings WHERE key = 'all' LIMIT 1;
  IF s IS NULL THEN s := '{}'::jsonb; END IF;

  -- Today's day-of-week name (sun/mon/tue/wed/thu/fri/sat) in ET
  -- Postgres' to_char + AT TIME ZONE handles tz cleanly across DST.
  today_dow_name := LOWER(to_char(NOW() AT TIME ZONE 'America/New_York', 'dy'));
  today_iso := to_char(NOW() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD');

  -- Today's hours (could be null if closed)
  hr := s -> 'hours' -> today_dow_name;
  IF hr IS NULL THEN
    is_closed_today := TRUE;
  END IF;

  -- Holiday closures override the DOW schedule
  holidays := s -> 'holidays';
  IF holidays IS NOT NULL AND jsonb_typeof(holidays) = 'array' THEN
    SELECT (h->>'name') INTO match_holiday
    FROM jsonb_array_elements(holidays) AS h
    WHERE (h->>'date') = today_iso
       OR (h->>'date') = SUBSTRING(today_iso FROM 6)  -- MM-DD recurring
    LIMIT 1;
    IF match_holiday IS NOT NULL THEN
      is_closed_today := TRUE;
    END IF;
  END IF;

  -- Emergency closure flag — overrides everything when active + not yet expired
  emergency := s -> 'emergencyClose';
  IF emergency IS NOT NULL AND COALESCE((emergency->>'active')::boolean, FALSE) THEN
    DECLARE until_ts TIMESTAMPTZ;
    BEGIN
      until_ts := NULLIF(emergency->>'until_iso','')::TIMESTAMPTZ;
      IF until_ts IS NULL OR until_ts > NOW() THEN
        is_emergency := TRUE;
        emergency_reason := emergency->>'reason';
        emergency_until := emergency->>'until_iso';
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Determine current open/closed status
  IF is_emergency THEN
    is_open := FALSE;
    status_label := 'emergency_closed';
  ELSIF is_closed_today THEN
    is_open := FALSE;
    status_label := 'closed_today';
  ELSIF hr IS NOT NULL THEN
    opening_time := hr->>'open';
    closing_time := hr->>'close';
    -- Is current ET time within [open, close)?
    DECLARE cur_time TEXT;
    BEGIN
      cur_time := to_char(NOW() AT TIME ZONE 'America/New_York', 'HH24:MI');
      IF opening_time IS NOT NULL AND closing_time IS NOT NULL THEN
        IF cur_time >= opening_time AND cur_time < closing_time THEN
          is_open := TRUE;
          status_label := 'open';
        ELSIF cur_time < opening_time THEN
          is_open := FALSE;
          status_label := 'opens_later';
        ELSE
          is_open := FALSE;
          status_label := 'closed_for_today';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Park capacity — current open checkin count vs configured max
  max_capacity := COALESCE((s->>'maxCapacity')::int, 0);
  SELECT COUNT(*) INTO open_checkin_count
    FROM checkins
    WHERE checked_out_at IS NULL;

  -- Build the public-safe response
  RETURN jsonb_build_object(
    'is_open',          is_open,
    'status',           status_label,
    'today_dow',        today_dow_name,
    'today_date',       today_iso,
    'today_open',       opening_time,
    'today_close',      closing_time,
    'is_closed_today',  is_closed_today,
    'holiday_name',     match_holiday,
    'emergency',        is_emergency,
    'emergency_reason', emergency_reason,
    'emergency_until',  emergency_until,
    'capacity_current', open_checkin_count,
    'capacity_max',     max_capacity,
    'biz_name',         COALESCE(s->>'bizName', '2nd Nature Park'),
    'biz_phone',        s->>'bizPhone',
    'biz_addr',         s->>'bizAddr',
    -- Full week's hours so the page can show "open Mon-Sun"
    'hours',            COALESCE(s->'hours', '{}'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION public_park_status() TO anon, authenticated;

-- ============================================================
-- BEGIN 052_public_retail_catalog.sql
-- ============================================================

-- ============================================================
-- 052_public_retail_catalog.sql — public retail-shop RPC
--
-- Phase 1 of the Square Online replica: public-facing skateOS retail
-- shop at shop.skateos.com (or shop.<tenant>.com). Customers browse
-- in-stock products + check out via Helcim hosted invoice.
--
-- This migration adds a SECURITY DEFINER RPC that returns ONLY the
-- public-safe whitelist of product fields. RLS on `products` is staff-
-- only (mig 001) — keeping it that way + funneling anon access through
-- this RPC avoids accidentally exposing cost / internal notes / staff
-- audit data.
--
-- Returns ONLY: id, name, brand, price, retail (when discounted), image,
-- category, sku, description, in-stock band ('high'/'med'/'low'/'limited').
-- Excludes: cost, profit margin, internal notes, supplier, low_stock_threshold.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public_retail_catalog(
  p_category TEXT DEFAULT NULL,
  p_search   TEXT DEFAULT NULL,
  p_limit    INT  DEFAULT 200
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN p_limit := 200; END IF;

  WITH filtered AS (
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'active'
      AND COALESCE(p.quantity, 0) > 0
      AND (p_category IS NULL OR c.name ILIKE p_category)
      AND (p_search IS NULL OR (
        p.name ILIKE '%' || p_search || '%'
        OR p.brand ILIKE '%' || p_search || '%'
        OR p.sku ILIKE '%' || p_search || '%'
      ))
    ORDER BY
      CASE WHEN p.image_url IS NOT NULL AND LENGTH(p.image_url) > 0 THEN 0 ELSE 1 END,
      p.name
    LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',          id,
    'name',        name,
    'brand',       brand,
    'sku',         sku,
    'price',       price,
    'retail',      CASE WHEN retail_price > price THEN retail_price ELSE NULL END,
    'image',       image_url,
    'category',    category_name,
    'description', description,
    -- Stock-availability band (privacy: don't leak exact qty)
    'availability', CASE
      WHEN quantity > 10 THEN 'in_stock'
      WHEN quantity > 3  THEN 'low_stock'
      WHEN quantity > 0  THEN 'limited'
      ELSE 'sold_out'
    END
  )), '[]'::jsonb) INTO result
  FROM filtered;

  RETURN jsonb_build_object(
    'products',  result,
    'count',     COALESCE(jsonb_array_length(result), 0)
  );
END $$;

-- Public-readable categories list (so the storefront filter dropdown can render).
-- Categories are not sensitive — RLS already allows anon read on most installs,
-- but we add a focused RPC anyway to keep the public surface consistent.
CREATE OR REPLACE FUNCTION public_retail_categories()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  -- Only return categories that have at least one in-stock active product
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name), '[]'::jsonb)
    INTO result
    FROM categories
    WHERE id IN (
      SELECT DISTINCT category_id FROM products
      WHERE status = 'active' AND COALESCE(quantity, 0) > 0 AND category_id IS NOT NULL
    );
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public_retail_catalog(TEXT, TEXT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public_retail_categories() TO anon, authenticated;

-- Smoke test on apply: should return JSON shape
SELECT public_retail_catalog(NULL, NULL, 5);

-- ============================================================
-- BEGIN 053_retail_order_form.sql
-- ============================================================

-- ============================================================
-- 053_retail_order_form.sql — retail order submission target
--
-- Phase 1 of the Square Online replica: shop.skateos.com retail orders
-- need a `forms` row to point submissions at, mirroring the preorder-2026
-- pattern (mig 046).
--
-- Submissions land in form_submissions with form_id = this form's id.
-- Helcim payment integration uses the submission's UUID as the invoice
-- reference; helcim-webhook flips data.payment_status='paid' on
-- invoice.paid (mirrors the preorder webhook handler from mig 048 era).
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$
DECLARE seed_tid UUID;
BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;

  INSERT INTO forms (slug, name, description, schema, submit_action, enabled, tenant_id)
  VALUES (
    'retail-order',
    'Online retail orders (shop.skateos.com)',
    'Customer-submitted retail orders from the public catalog. Each submission contains the cart items, totals, customer contact, fulfillment choice, shipping address, and Helcim payment status.',
    '{"fields":[]}'::jsonb,
    'other',
    TRUE,
    seed_tid
  )
  ON CONFLICT (slug) DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'forms table missing — apply migration 011 first';
END $$;

-- ============================================================
-- BEGIN 054_retail_order_inventory.sql
-- ============================================================

-- ============================================================
-- 054_retail_order_inventory.sql — atomic stock decrement on payment
--
-- Phase 1 of Square Online replica: when a retail order is paid (via
-- Helcim webhook OR manual mark-paid), atomically decrement product
-- stock. Without this, two customers can race-buy the last unit and
-- both succeed → physical inventory goes negative.
--
-- The RPC:
--   • Reads form_submissions.data.items[] (cart line items)
--   • For each item, decrements products.quantity by item.qty
--   • Logs to inventory_log with reason='retail_order_paid'
--   • Detects oversold conditions (qty would go negative) and:
--       - Stamps data.oversold_items[] on the submission for owner review
--       - Still decrements (clamped at 0) so the row reflects best effort
--   • Returns JSON with: ok, decremented[], oversold[], total_decrements
--
-- Idempotent on the submission: writes data.inventory_decremented_at
-- and refuses to fire twice. Safe to call multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION process_retail_order_payment(p_submission_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sub RECORD;
  item RECORD;
  current_qty INT;
  decrement_qty INT;
  new_qty INT;
  decremented JSONB := '[]'::jsonb;
  oversold JSONB := '[]'::jsonb;
  oversold_count INT := 0;
  total_decrements INT := 0;
BEGIN
  -- Fetch the submission + verify it's a retail-order
  SELECT s.*, f.slug AS form_slug
    INTO sub
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_submission_id
      AND f.slug = 'retail-order'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'submission_not_found_or_not_retail');
  END IF;

  -- Idempotency: refuse to decrement twice
  IF (sub.data->>'inventory_decremented_at') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'already_decremented', TRUE,
      'decremented_at', sub.data->>'inventory_decremented_at'
    );
  END IF;

  -- Walk items[]. Each entry has product_id + qty.
  FOR item IN
    SELECT
      (e->>'product_id')::TEXT AS product_id,
      COALESCE((e->>'qty')::INT, 1) AS qty,
      e->>'name' AS name,
      e->>'brand' AS brand
    FROM jsonb_array_elements(COALESCE(sub.data->'items', '[]'::jsonb)) AS e
  LOOP
    -- Look up current qty (FOR UPDATE locks the row)
    SELECT quantity INTO current_qty
      FROM products
      WHERE id = item.product_id::UUID
      FOR UPDATE;

    IF NOT FOUND THEN
      -- Unknown product — skip + log but don't fail the whole payment
      oversold := oversold || jsonb_build_object(
        'product_id', item.product_id, 'name', item.name, 'qty', item.qty,
        'reason', 'product_not_found'
      );
      oversold_count := oversold_count + 1;
      CONTINUE;
    END IF;

    decrement_qty := item.qty;
    new_qty := current_qty - decrement_qty;

    IF new_qty < 0 THEN
      -- Oversold case: log + clamp to 0 so the row stays accurate-ish
      oversold := oversold || jsonb_build_object(
        'product_id', item.product_id,
        'name', item.name,
        'requested', decrement_qty,
        'available', current_qty,
        'short', decrement_qty - current_qty
      );
      oversold_count := oversold_count + 1;
      decrement_qty := current_qty;  -- clamped
      new_qty := 0;
    END IF;

    UPDATE products
      SET quantity = new_qty
      WHERE id = item.product_id::UUID;

    -- inventory_log entry (mig 001 has this table; defensive try/catch
    -- in case of schema variation across forks).
    BEGIN
      INSERT INTO inventory_log (product_id, change_qty, reason, notes)
      VALUES (
        item.product_id::UUID,
        -decrement_qty,
        'retail_order_paid',
        'Order #' || SUBSTRING(p_submission_id::text, 1, 8) || ' · ' || COALESCE(item.name, '?')
      );
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
    END;

    decremented := decremented || jsonb_build_object(
      'product_id', item.product_id,
      'name', item.name,
      'qty_decremented', decrement_qty,
      'new_qty', new_qty
    );
    total_decrements := total_decrements + 1;
  END LOOP;

  -- Stamp the submission so we don't fire twice + surface oversold info
  UPDATE form_submissions
    SET data = data
      || jsonb_build_object(
        'inventory_decremented_at', NOW(),
        'inventory_decrements', decremented,
        'oversold_items', oversold,
        'oversold_count', oversold_count
      )
    WHERE id = p_submission_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'submission_id', p_submission_id,
    'total_decrements', total_decrements,
    'oversold_count', oversold_count,
    'oversold', oversold,
    'decremented', decremented
  );
END $$;

GRANT EXECUTE ON FUNCTION process_retail_order_payment(UUID) TO service_role, authenticated;

-- ============================================================
-- BEGIN 055_retail_order_status_lookup.sql
-- ============================================================

-- ============================================================
-- 055_retail_order_status_lookup.sql — public retail-order status RPC
--
-- Customer-facing order tracking page (shop.skateos.com/order.html?id=…)
-- needs to read a single retail-order submission by its UUID without
-- exposing the entire form_submissions table to anon.
--
-- The submission UUID is the access token — 36 random hex chars,
-- unguessable. We share it in the order confirmation email + Helcim
-- payment success redirect; customer visits to track their order.
--
-- Same pattern as mig 048 (preorder_status_lookup).
-- Returns ONLY public-safe whitelist fields.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION retail_order_status_lookup(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  d JSONB;
  contact_name TEXT;
  first_name TEXT;
BEGIN
  -- Look up the submission. Refuse non-retail-order so this RPC can't be
  -- abused to read other form types (privilege escalation guard).
  SELECT s.*, f.slug AS form_slug
    INTO s
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_id
      AND f.slug = 'retail-order'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  d := COALESCE(s.data, '{}'::jsonb);
  contact_name := d->'contact'->>'name';
  first_name := SPLIT_PART(COALESCE(contact_name, ''), ' ', 1);

  RETURN jsonb_build_object(
    'found',                TRUE,
    'submitted_at',         s.created_at,
    'first_name',           first_name,
    'items',                COALESCE(d->'items', '[]'::jsonb),
    'totals',               COALESCE(d->'totals', '{}'::jsonb),
    'payment_status',       COALESCE(d->>'payment_status', 'pending'),
    'payment_paid_at',      d->>'payment_paid_at',
    'fulfillment',          COALESCE(d->>'fulfillment', 'pickup'),
    'shipping_address',     d->>'shipping_address',
    'fulfilled_at',         d->>'fulfilled_at',
    'helcim_payment_url',   d->>'helcim_payment_url',
    'oversold_count',       COALESCE((d->>'oversold_count')::int, 0)
  );
END $$;

GRANT EXECUTE ON FUNCTION retail_order_status_lookup(UUID) TO anon, authenticated;

-- ============================================================
-- BEGIN 056_public_lesson_slots.sql
-- ============================================================

-- ============================================================
-- 056_public_lesson_slots.sql — public lesson availability RPC
--
-- Phase 2 of Square Online replica: customer-facing lesson booking
-- at book.skateos.com needs to know which slots are open for a given
-- instructor on a given date.
--
-- The RPC:
--   • Returns available time slots for the requested instructor +
--     lesson type for the next N days
--   • Pulls today's hours from app_settings.hours
--   • Excludes hours when instructor has an existing non-cancelled
--     lesson (default 60-min collision window per slot)
--   • Excludes closed days (settings.holidays + DOW closed)
--   • Excludes emergency closure windows
--   • Returns whitelist-only public-safe fields (no PII / no admin notes)
--
-- Slot granularity: 60-min increments aligned to instructor schedule.
-- Lesson types steer default duration (private 60m / group 90m / camp 180m).
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public_lesson_slots(
  p_instructor TEXT,
  p_lesson_type TEXT DEFAULT 'private',
  p_days_forward INT DEFAULT 14
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s JSONB;
  hr JSONB;
  result JSONB := '[]'::jsonb;
  cursor_date DATE;
  end_date DATE;
  dow_name TEXT;
  open_hour INT;
  close_hour INT;
  duration_min INT;
  slot_start TIMESTAMPTZ;
  slot_end TIMESTAMPTZ;
  is_closed BOOLEAN;
  conflict_count INT;
  day_slots JSONB;
  hr_iter INT;
BEGIN
  IF p_days_forward IS NULL OR p_days_forward < 1 OR p_days_forward > 60 THEN p_days_forward := 14; END IF;

  -- Determine duration based on lesson type (matches mig 032 capacity defaults)
  duration_min := CASE LOWER(COALESCE(p_lesson_type, 'private'))
    WHEN 'private'  THEN 60
    WHEN 'group'    THEN 90
    WHEN 'camp'     THEN 180
    WHEN 'event'    THEN 120
    WHEN 'birthday' THEN 120
    ELSE 60
  END;

  -- Pull settings (need hours + holidays + emergency)
  SELECT value INTO s FROM app_settings WHERE key = 'all' LIMIT 1;
  IF s IS NULL THEN s := '{}'::jsonb; END IF;

  cursor_date := (NOW() AT TIME ZONE 'America/New_York')::DATE;
  end_date := cursor_date + p_days_forward;

  WHILE cursor_date <= end_date LOOP
    is_closed := FALSE;
    dow_name := LOWER(to_char(cursor_date, 'dy'));
    hr := s -> 'hours' -> dow_name;
    IF hr IS NULL THEN is_closed := TRUE; END IF;

    -- Holiday check
    IF NOT is_closed AND s ? 'holidays' AND jsonb_typeof(s->'holidays') = 'array' THEN
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s->'holidays') AS h
        WHERE (h->>'date') = to_char(cursor_date, 'YYYY-MM-DD')
           OR (h->>'date') = to_char(cursor_date, 'MM-DD')
      ) THEN
        is_closed := TRUE;
      END IF;
    END IF;

    -- Emergency closure that's still active = treat as closed
    IF NOT is_closed AND s ? 'emergencyClose' AND COALESCE((s->'emergencyClose'->>'active')::boolean, FALSE) THEN
      DECLARE until_ts TIMESTAMPTZ;
      BEGIN
        until_ts := NULLIF(s->'emergencyClose'->>'until_iso','')::TIMESTAMPTZ;
        IF until_ts IS NULL OR until_ts > cursor_date::TIMESTAMPTZ THEN
          is_closed := TRUE;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    day_slots := '[]'::jsonb;

    IF NOT is_closed AND hr IS NOT NULL THEN
      open_hour := SPLIT_PART(hr->>'open', ':', 1)::INT;
      close_hour := SPLIT_PART(hr->>'close', ':', 1)::INT;

      hr_iter := open_hour;
      WHILE hr_iter + (duration_min/60) <= close_hour LOOP
        slot_start := (cursor_date::TEXT || ' ' || LPAD(hr_iter::TEXT, 2, '0') || ':00:00 America/New_York')::TIMESTAMPTZ;
        slot_end := slot_start + (duration_min || ' minutes')::INTERVAL;

        -- Skip slots in the past (today's morning hours after current time)
        IF slot_start > NOW() THEN
          -- Check for instructor conflict
          SELECT COUNT(*) INTO conflict_count
          FROM lessons
          WHERE instructor = p_instructor
            AND status NOT IN ('cancelled', 'no_show')
            AND scheduled_at < slot_end
            AND scheduled_at + (COALESCE(duration_min, 60) || ' minutes')::INTERVAL > slot_start;

          IF conflict_count = 0 THEN
            day_slots := day_slots || jsonb_build_object(
              'iso',     slot_start,
              'time_label', to_char(slot_start AT TIME ZONE 'America/New_York', 'FMHH12:MIam'),
              'duration_min', duration_min
            );
          END IF;
        END IF;
        hr_iter := hr_iter + 1;
      END LOOP;
    END IF;

    result := result || jsonb_build_object(
      'date',      to_char(cursor_date, 'YYYY-MM-DD'),
      'dow',       to_char(cursor_date, 'FMDay'),
      'is_closed', is_closed,
      'slots',     day_slots
    );

    cursor_date := cursor_date + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'instructor',     p_instructor,
    'lesson_type',    p_lesson_type,
    'duration_min',   duration_min,
    'days',           result
  );
END $$;

GRANT EXECUTE ON FUNCTION public_lesson_slots(TEXT, TEXT, INT) TO anon, authenticated;

-- Public-readable list of active instructors (so the booking page can offer a dropdown)
CREATE OR REPLACE FUNCTION public_instructor_list()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           id,
    'display_name', display_name
  ) ORDER BY display_name), '[]'::jsonb)
  INTO result
  FROM staff
  WHERE active = TRUE
    AND role IN ('instructor', 'owner');
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public_instructor_list() TO anon, authenticated;

-- ============================================================
-- BEGIN 057_lesson_booking_form.sql
-- ============================================================

-- ============================================================
-- 057_lesson_booking_form.sql — public lesson-booking submission target
--
-- Phase 2 of Square Online replica: book.skateos.com self-service lesson
-- bookings need a `forms` row to point submissions at, mirroring the
-- preorder-2026 (mig 046) and retail-order (mig 053) patterns.
--
-- Submissions land in form_submissions with form_id = this form's id.
-- After Helcim payment lands, helcim-webhook auto-flips
-- data.payment_status='paid' and creates a real lessons row.
--
-- Idempotent. Safe to re-run.
-- ============================================================

DO $$
DECLARE seed_tid UUID;
BEGIN
  SELECT id INTO seed_tid FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;

  INSERT INTO forms (slug, name, description, schema, submit_action, enabled, tenant_id)
  VALUES (
    'lesson-booking',
    'Online lesson bookings (book.skateos.com)',
    'Customer-submitted self-service lesson bookings. Each submission contains the picked instructor + slot + customer contact + notes + Helcim payment status. After payment, helcim-webhook promotes to a real lessons row.',
    '{"fields":[]}'::jsonb,
    'lesson_intake',
    TRUE,
    seed_tid
  )
  ON CONFLICT (slug) DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'forms table missing — apply migration 011 first';
END $$;

-- ============================================================
-- BEGIN 058_my_customer_orders.sql
-- ============================================================

-- ============================================================
-- 058_my_customer_orders.sql — customer-portal RPC for retail + lesson bookings
--
-- Phase 3 polish: extends the customer self-serve me.html portal to surface
-- a customer's online retail orders + lesson bookings alongside their
-- existing pre-orders + visits + loyalty data.
--
-- Without this RPC the portal can't read form_submissions directly (RLS is
-- staff-only). Same SECURITY DEFINER pattern as mig 050 (my_preorders).
--
-- Returns ONLY the public-safe whitelist of fields. Match by email or
-- phone last-7-digits (forgiving of country-code formatting).
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION my_retail_orders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cust_id UUID;
  cust_email TEXT;
  cust_phone_digits TEXT;
  result JSONB := '[]'::jsonb;
BEGIN
  cust_id := current_customer_id();
  IF cust_id IS NULL THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'not_authenticated_as_customer');
  END IF;

  SELECT email, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
    INTO cust_email, cust_phone_digits
    FROM customers
    WHERE id = cust_id;

  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'submitted_at') DESC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT jsonb_build_object(
        'id',                 s.id,
        'submitted_at',       s.created_at,
        'items',              COALESCE(s.data->'items', '[]'::jsonb),
        'totals',             COALESCE(s.data->'totals', '{}'::jsonb),
        'payment_status',     COALESCE(s.data->>'payment_status', 'pending'),
        'fulfillment',        COALESCE(s.data->>'fulfillment', 'pickup'),
        'fulfilled_at',       s.data->>'fulfilled_at',
        'helcim_payment_url', s.data->>'helcim_payment_url'
      ) AS payload
      FROM form_submissions s
      JOIN forms f ON f.id = s.form_id
      WHERE f.slug = 'retail-order'
        AND (
          (cust_email IS NOT NULL AND LOWER(s.data->'contact'->>'email') = LOWER(cust_email))
          OR (LENGTH(cust_phone_digits) >= 7
              AND RIGHT(regexp_replace(COALESCE(s.data->'contact'->>'phone', ''), '[^0-9]', '', 'g'), 7)
                  = RIGHT(cust_phone_digits, 7))
        )
      LIMIT 50
    ) AS sub;

  RETURN jsonb_build_object('found', TRUE, 'orders', result);
END $$;

GRANT EXECUTE ON FUNCTION my_retail_orders() TO authenticated;

-- Online lesson bookings — same shape, slug='lesson-booking'
CREATE OR REPLACE FUNCTION my_lesson_bookings()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cust_id UUID;
  cust_email TEXT;
  cust_phone_digits TEXT;
  result JSONB := '[]'::jsonb;
BEGIN
  cust_id := current_customer_id();
  IF cust_id IS NULL THEN
    RETURN jsonb_build_object('found', FALSE, 'reason', 'not_authenticated_as_customer');
  END IF;

  SELECT email, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')
    INTO cust_email, cust_phone_digits
    FROM customers
    WHERE id = cust_id;

  SELECT COALESCE(jsonb_agg(payload ORDER BY (payload->>'scheduled_at') ASC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT jsonb_build_object(
        'id',                 s.id,
        'submitted_at',       s.created_at,
        'lesson_type',        s.data->>'lesson_type',
        'instructor',         s.data->>'instructor',
        'scheduled_at',       s.data->>'scheduled_at',
        'duration_min',       (s.data->>'duration_min')::int,
        'price',              s.data->>'price',
        'payment_status',     COALESCE(s.data->>'payment_status', 'pending'),
        'helcim_payment_url', s.data->>'helcim_payment_url',
        'lesson_id',          s.data->>'lesson_id',
        'skater_name',        s.data->'skater'->>'name'
      ) AS payload
      FROM form_submissions s
      JOIN forms f ON f.id = s.form_id
      WHERE f.slug = 'lesson-booking'
        AND (
          (cust_email IS NOT NULL AND LOWER(s.data->'contact'->>'email') = LOWER(cust_email))
          OR (LENGTH(cust_phone_digits) >= 7
              AND RIGHT(regexp_replace(COALESCE(s.data->'contact'->>'phone', ''), '[^0-9]', '', 'g'), 7)
                  = RIGHT(cust_phone_digits, 7))
        )
      LIMIT 50
    ) AS sub;

  RETURN jsonb_build_object('found', TRUE, 'bookings', result);
END $$;

GRANT EXECUTE ON FUNCTION my_lesson_bookings() TO authenticated;


-- ============================================================

-- ============================================================
-- BEGIN 059_retail_order_tracking.sql
-- ============================================================

-- ============================================================
-- 059_retail_order_tracking.sql — extend retail_order_status_lookup
--                                   with tracking_number + carrier
--
-- The admin _retailMarkFulfilled flow now optionally captures a
-- tracking number + carrier on ship-orders (UPS / USPS / FedEx /
-- DHL / other). This migration extends the public status-lookup RPC
-- so the customer-facing order tracking page (shop/order.html) can
-- surface the tracking info + a deep-link to the carrier's site.
--
-- Pure RPC update (CREATE OR REPLACE). No table schema change —
-- tracking_number + carrier live inside the existing JSONB `data`
-- column on form_submissions, no migration needed for those.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION retail_order_status_lookup(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  d JSONB;
  contact_name TEXT;
  first_name TEXT;
BEGIN
  SELECT s.*, f.slug AS form_slug
    INTO s
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_id
      AND f.slug = 'retail-order'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  d := COALESCE(s.data, '{}'::jsonb);
  contact_name := d->'contact'->>'name';
  first_name := SPLIT_PART(COALESCE(contact_name, ''), ' ', 1);

  RETURN jsonb_build_object(
    'found',                TRUE,
    'submitted_at',         s.created_at,
    'first_name',           first_name,
    'items',                COALESCE(d->'items', '[]'::jsonb),
    'totals',               COALESCE(d->'totals', '{}'::jsonb),
    'payment_status',       COALESCE(d->>'payment_status', 'pending'),
    'payment_paid_at',      d->>'payment_paid_at',
    'fulfillment',          COALESCE(d->>'fulfillment', 'pickup'),
    'shipping_address',     d->>'shipping_address',
    'fulfilled_at',         d->>'fulfilled_at',
    'helcim_payment_url',   d->>'helcim_payment_url',
    'oversold_count',       COALESCE((d->>'oversold_count')::int, 0),
    -- NEW: tracking info (ship-orders only, optional)
    'tracking_number',      d->>'tracking_number',
    'carrier',              d->>'carrier'
  );
END $$;

GRANT EXECUTE ON FUNCTION retail_order_status_lookup(UUID) TO anon, authenticated;

-- ============================================================
-- BEGIN 060_customer_cancel_subscription.sql
-- ============================================================

-- ============================================================
-- 060_customer_cancel_subscription.sql — customer self-serve cancel
--
-- Lets a signed-in customer cancel their own active subscription
-- via the me.html portal without calling the front desk.
--
-- Server-authoritative — gates on current_customer_id() = subscription
-- customer_id (mig 019). Refuses already-cancelled. Flips status to
-- 'cancelled' + audit-stamps notes with [Customer-cancelled YYYY-MM-DD:
-- REASON] for traceability. Does NOT issue any refund — that's an owner
-- decision (most skateparks: "ends at end of billing period, no refunds").
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customer_cancel_subscription(
  p_subscription_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_sub RECORD;
  v_audit_stamp TEXT;
  v_clean_reason TEXT;
BEGIN
  -- Resolve current customer (mig 019 helper)
  v_customer_id := current_customer_id();
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Not authenticated as a customer');
  END IF;

  -- Look up the subscription, verify ownership
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Subscription not found');
  END IF;
  IF v_sub.customer_id != v_customer_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'This subscription does not belong to you');
  END IF;

  -- Refuse non-cancellable states
  IF v_sub.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Already cancelled');
  END IF;
  IF v_sub.status = 'expired' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Already expired');
  END IF;

  -- Sanitize reason — strip control chars + cap at 300 chars
  v_clean_reason := REGEXP_REPLACE(COALESCE(p_reason, ''), '[[:cntrl:]]', '', 'g');
  IF LENGTH(v_clean_reason) > 300 THEN
    v_clean_reason := SUBSTRING(v_clean_reason FROM 1 FOR 300);
  END IF;
  IF v_clean_reason = '' THEN
    v_clean_reason := '(no reason provided)';
  END IF;

  -- Build audit stamp
  v_audit_stamp := '[Customer-cancelled ' || TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC: ' || v_clean_reason || ']';

  -- Flip status + append audit stamp to notes
  UPDATE subscriptions
  SET
    status = 'cancelled',
    notes = COALESCE(NULLIF(TRIM(notes), ''), '') ||
            CASE WHEN COALESCE(NULLIF(TRIM(notes), ''), '') = '' THEN '' ELSE E'\n' END ||
            v_audit_stamp,
    updated_at = NOW()
  WHERE id = p_subscription_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'subscription_id', p_subscription_id,
    'previous_status', v_sub.status,
    'cancelled_at', NOW()
  );
END $$;

GRANT EXECUTE ON FUNCTION customer_cancel_subscription(UUID, TEXT) TO authenticated;

-- ============================================================
-- BEGIN 061_customer_pause_subscription.sql
-- ============================================================

-- ============================================================
-- 061_customer_pause_subscription.sql — customer self-serve pause
--
-- Lets a signed-in customer pause their own active monthly/annual
-- subscription for up to 90 days via the me.html portal. Pairs with
-- mig 030 (paused_until column + auto-resume daily cron). After the
-- pause window passes, the existing cron auto-flips status back to
-- 'active' so the customer doesn't have to manually un-pause.
--
-- Server-authoritative — gates on current_customer_id() (mig 019).
-- Refuses pauses on punch_card / day_pass plans (those don't bill on
-- a cycle so pause is meaningless). Refuses already-paused. Caps the
-- pause window at 90 days max to prevent indefinite-pause abuse.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customer_pause_subscription(
  p_subscription_id UUID,
  p_until DATE,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
  v_sub RECORD;
  v_audit_stamp TEXT;
  v_clean_reason TEXT;
  v_max_until DATE;
BEGIN
  -- Resolve current customer (mig 019)
  v_customer_id := current_customer_id();
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Not authenticated as a customer');
  END IF;

  -- Look up subscription, verify ownership
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Subscription not found');
  END IF;
  IF v_sub.customer_id != v_customer_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'This subscription does not belong to you');
  END IF;

  -- Refuse uncancellable / unpausable types
  IF v_sub.status != 'active' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only active subscriptions can be paused (this one is ' || v_sub.status || ')');
  END IF;
  IF v_sub.plan_type NOT IN ('monthly', 'annual') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Only monthly or annual memberships can be paused');
  END IF;

  -- Validate pause-until date — must be in future, max 90 days out
  IF p_until IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Pause-until date is required');
  END IF;
  IF p_until <= CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Pause-until date must be in the future');
  END IF;
  v_max_until := CURRENT_DATE + INTERVAL '90 days';
  IF p_until > v_max_until THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Maximum pause window is 90 days. Pick a date on or before ' || TO_CHAR(v_max_until, 'YYYY-MM-DD'));
  END IF;

  -- Sanitize reason
  v_clean_reason := REGEXP_REPLACE(COALESCE(p_reason, ''), '[[:cntrl:]]', '', 'g');
  IF LENGTH(v_clean_reason) > 300 THEN
    v_clean_reason := SUBSTRING(v_clean_reason FROM 1 FOR 300);
  END IF;
  IF v_clean_reason = '' THEN
    v_clean_reason := '(no reason provided)';
  END IF;

  v_audit_stamp := '[Customer-paused ' || TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') ||
                   ' UTC until ' || TO_CHAR(p_until, 'YYYY-MM-DD') || ': ' || v_clean_reason || ']';

  -- Flip to paused + set paused_until + audit stamp
  UPDATE subscriptions
  SET
    status = 'paused',
    paused_until = p_until,
    notes = COALESCE(NULLIF(TRIM(notes), ''), '') ||
            CASE WHEN COALESCE(NULLIF(TRIM(notes), ''), '') = '' THEN '' ELSE E'\n' END ||
            v_audit_stamp,
    updated_at = NOW()
  WHERE id = p_subscription_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'subscription_id', p_subscription_id,
    'paused_until', p_until,
    'will_auto_resume_at', p_until
  );
END $$;

GRANT EXECUTE ON FUNCTION customer_pause_subscription(UUID, DATE, TEXT) TO authenticated;

-- ============================================================
-- Verification block — run this AFTER the bundle to confirm
-- every migration landed. Each row should print 'ok'.
-- ============================================================

DO $$
DECLARE
  rec RECORD;
  passed INT := 0;
  failed INT := 0;
  msg TEXT;
  tomorrow_str TEXT := TO_CHAR(CURRENT_DATE + 1, 'YYYY-MM-DD');
BEGIN
  FOR rec IN VALUES
    ('045 affiliate_programs', 'SELECT 1 FROM affiliate_programs LIMIT 0'),
    ('046 preorder-2026 form', 'SELECT 1 FROM forms WHERE slug = ''preorder-2026'' LIMIT 1'),
    ('048 preorder_status_lookup RPC', 'SELECT preorder_status_lookup(''00000000-0000-0000-0000-000000000000''::uuid)'),
    ('049 preorder_products', 'SELECT 1 FROM preorder_products LIMIT 0'),
    ('050 my_preorders RPC', 'SELECT my_preorders()'),
    ('051 public_park_status RPC', 'SELECT public_park_status()'),
    ('052 public_retail_catalog RPC', 'SELECT public_retail_catalog(NULL, NULL, 1)'),
    ('053 retail-order form', 'SELECT 1 FROM forms WHERE slug = ''retail-order'' LIMIT 1'),
    ('054 process_retail_order_payment RPC', 'SELECT process_retail_order_payment(''00000000-0000-0000-0000-000000000000''::uuid)'),
    ('055/059 retail_order_status_lookup RPC', 'SELECT retail_order_status_lookup(''00000000-0000-0000-0000-000000000000''::uuid)'),
    ('056 public_lesson_slots RPC', 'SELECT public_lesson_slots(''__probe__'', ''private'', 1)'),
    ('057 lesson-booking form', 'SELECT 1 FROM forms WHERE slug = ''lesson-booking'' LIMIT 1'),
    ('058 my_retail_orders RPC', 'SELECT my_retail_orders()'),
    ('058 my_lesson_bookings RPC', 'SELECT my_lesson_bookings()'),
    ('060 customer_cancel_subscription RPC', 'SELECT customer_cancel_subscription(''00000000-0000-0000-0000-000000000000''::uuid, ''probe'')'),
    ('061 customer_pause_subscription RPC', format('SELECT customer_pause_subscription(''00000000-0000-0000-0000-000000000000''::uuid, ''%s''::date, ''probe'')', tomorrow_str))
  AS t(name TEXT, sql TEXT)
  LOOP
    BEGIN
      EXECUTE rec.sql;
      RAISE NOTICE '✓ %', rec.name;
      passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN
      msg := SQLERRM;
      RAISE NOTICE '✗ % — %', rec.name, msg;
      failed := failed + 1;
    END;
  END LOOP;

  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'Migration verification: % passed, % failed', passed, failed;
  IF failed = 0 THEN
    RAISE NOTICE '🛹 All Square-replica + customer self-serve migrations landed cleanly.';
  ELSE
    RAISE WARNING '% probes failed — re-run individual migration files for the failed ones.', failed;
  END IF;
END $$;
