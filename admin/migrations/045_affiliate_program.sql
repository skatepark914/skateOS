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
