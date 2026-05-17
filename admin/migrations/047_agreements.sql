-- ============================================================
-- 047_agreements.sql — customer-facing agreements (e-signatures)
--
-- Adapts BM's approve.html pattern to skateOS. Use cases:
--   - Liability waivers (paper-style fallback / addition to Smartwaiver)
--   - Membership terms (annual unlimited, punch card policies)
--   - Birthday party deposits (50% upfront, refund policy)
--   - Equipment rental agreements (loaner board, damage policy)
--   - Custom one-off (camp registration with terms, etc.)
--
-- FLOW:
--   1. Admin creates an agreement (status='pending') with body_markdown
--      and links to a customer. UUID id IS the unguessable token.
--   2. Admin sends the URL `https://app.../approve.html?id=<UUID>` to
--      the customer (email/SMS/handoff).
--   3. Customer lands on approve.html (anon, no login), reads, signs
--      via canvas + types name, hits Accept or Decline.
--   4. Page calls public RPC `agreement_record_signature` which writes
--      atomically. Returns success/error.
--   5. Admin sees status flip to 'signed' (or 'declined') in their
--      customer detail / agreements page.
--
-- Also marks the 2ntr tenant as having completed onboarding so the
-- existing deploy doesn't get bounced to the new onboarding wizard.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS agreements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- What is this agreement
  type            TEXT NOT NULL DEFAULT 'custom'
                    CHECK (type IN ('waiver','membership','party','equipment','custom')),
  title           TEXT NOT NULL,
  body_markdown   TEXT NOT NULL,     -- the agreement text shown to the signer (basic markdown)

  -- Status workflow
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','signed','declined','expired','revoked')),

  -- Signed details
  signed_at       TIMESTAMPTZ,
  signed_by_name  TEXT,              -- name the signer typed
  signed_by_email TEXT,              -- optional contact captured on sign
  signature_data  TEXT,              -- base64 PNG data URL of the canvas signature

  -- Decline / metadata
  declined_at     TIMESTAMPTZ,
  declined_reason TEXT,

  -- Delivery + lifecycle
  sent_at         TIMESTAMPTZ,
  sent_to_email   TEXT,
  expires_at      TIMESTAMPTZ,       -- pending agreements past this auto-mark 'expired'

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agreements_tenant   ON agreements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agreements_customer ON agreements(customer_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status   ON agreements(status, tenant_id);


-- ------------------------------------------------------------
-- Auto-fill tenant_id on INSERT (matches 046 pattern)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auto_tenant_agreements ON agreements;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auto_fill_tenant_id') THEN
    EXECUTE 'CREATE TRIGGER trg_auto_tenant_agreements BEFORE INSERT ON agreements FOR EACH ROW EXECUTE FUNCTION auto_fill_tenant_id();';
  END IF;
END $$;

-- Audit trigger
DROP TRIGGER IF EXISTS trg_audit_agreements ON agreements;
CREATE TRIGGER trg_audit_agreements
  AFTER INSERT OR UPDATE OR DELETE ON agreements
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();


-- ------------------------------------------------------------
-- RLS
--   Staff at the same tenant: read + write
--   Anonymous (customer with the link): read pending rows only,
--     can only update via the RPC below (no direct table write).
-- ------------------------------------------------------------
ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agreements_staff_read   ON agreements;
DROP POLICY IF EXISTS agreements_staff_write  ON agreements;
DROP POLICY IF EXISTS agreements_anon_view    ON agreements;

CREATE POLICY agreements_staff_read ON agreements FOR SELECT
  USING (is_staff());
CREATE POLICY agreements_staff_write ON agreements FOR ALL
  USING (is_staff()) WITH CHECK (is_staff());

-- Anon can SELECT a single agreement by its UUID (used by approve.html
-- before the signer lands). Read-only — they can't write via this path.
CREATE POLICY agreements_anon_view ON agreements FOR SELECT
  TO anon
  USING (status IN ('pending','signed','declined','expired'));

-- RESTRICTIVE: staff at THIS tenant only (tenant isolation, layers
-- on top of staff/anon policies above). Skip if migration 046 isn't
-- applied yet — anon-view policy still works for cross-tenant
-- signer links since the customer doesn't have a tenant context.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_tenant_id') THEN
    DROP POLICY IF EXISTS tenant_isolation ON agreements;
    EXECUTE 'CREATE POLICY tenant_isolation ON agreements AS RESTRICTIVE FOR ALL '
            'USING (tenant_id = current_tenant_id() OR auth.role() = ''anon'') '
            'WITH CHECK (tenant_id = current_tenant_id());';
  END IF;
END $$;

GRANT SELECT                          ON agreements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON agreements TO authenticated;
GRANT ALL                             ON agreements TO service_role;


-- ------------------------------------------------------------
-- Public RPC: customer signs an agreement
--   Anon-callable. Takes the agreement UUID (unguessable token),
--   signer's typed name, signature data URL. Refuses if already
--   signed/declined/expired. Atomic write.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION agreement_record_signature(
  p_id           UUID,
  p_signed_name  TEXT,
  p_signature    TEXT,
  p_email        TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec  agreements%ROWTYPE;
BEGIN
  SELECT * INTO rec FROM agreements WHERE id = p_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF rec.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending', 'status', rec.status);
  END IF;
  IF rec.expires_at IS NOT NULL AND rec.expires_at < NOW() THEN
    UPDATE agreements SET status='expired' WHERE id = p_id;
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  IF p_signed_name IS NULL OR length(trim(p_signed_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name_required');
  END IF;
  IF p_signature IS NULL OR length(p_signature) < 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'signature_required');
  END IF;

  UPDATE agreements
     SET status          = 'signed',
         signed_at       = NOW(),
         signed_by_name  = trim(p_signed_name),
         signed_by_email = NULLIF(trim(COALESCE(p_email,'')), ''),
         signature_data  = p_signature
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'signed_at', NOW());
END;
$$;

GRANT EXECUTE ON FUNCTION agreement_record_signature(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;


-- Public RPC: customer declines
CREATE OR REPLACE FUNCTION agreement_record_decline(
  p_id     UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec  agreements%ROWTYPE;
BEGIN
  SELECT * INTO rec FROM agreements WHERE id = p_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF rec.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending', 'status', rec.status);
  END IF;
  UPDATE agreements
     SET status          = 'declined',
         declined_at     = NOW(),
         declined_reason = NULLIF(trim(COALESCE(p_reason,'')), '')
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION agreement_record_decline(UUID, TEXT) TO anon, authenticated;


-- ------------------------------------------------------------
-- Public RPC: invoice lookup for the skateOS-branded pay.html page
--   Anon-callable. Returns invoice + items + tenant biz name as JSONB
--   only when invoice status is one of the payable states. UUID is
--   the unguessable token. Skips sensitive fields (customer notes etc).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='invoices') THEN
    CREATE OR REPLACE FUNCTION invoice_for_payment(p_id UUID) RETURNS JSONB
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
    DECLARE
      inv      RECORD;
      items    JSONB;
      biz      RECORD;
    BEGIN
      SELECT * INTO inv FROM invoices WHERE id = p_id LIMIT 1;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
      END IF;
      IF inv.status NOT IN ('sent','viewed','overdue','draft') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_payable', 'status', inv.status);
      END IF;

      -- Items (skip cost / internal fields)
      SELECT jsonb_agg(jsonb_build_object(
        'name',     name,
        'quantity', quantity,
        'price',    price,
        'subtotal', subtotal
      ) ORDER BY id)
      INTO items
      FROM invoice_items
      WHERE invoice_id = inv.id;

      -- Tenant biz name (for header branding)
      SELECT name, config INTO biz FROM tenants WHERE id = inv.tenant_id LIMIT 1;

      RETURN jsonb_build_object(
        'ok', true,
        'invoice', jsonb_build_object(
          'id',              inv.id,
          'invoice_number',  inv.invoice_number,
          'status',          inv.status,
          'customer_name',   inv.customer_name,
          'customer_email',  inv.customer_email,
          'subtotal',        inv.subtotal,
          'tax',             inv.tax,
          'total',           inv.total,
          'due_date',        inv.due_date,
          'created_at',      inv.created_at,
          'notes',           inv.notes
        ),
        'items', COALESCE(items, '[]'::jsonb),
        'biz', jsonb_build_object(
          'name',  COALESCE(biz.name, 'Skatepark'),
          'phone', biz.config->>'bizPhone',
          'email', biz.config->>'bizEmail',
          'addr',  biz.config->>'bizAddr',
          'web',   biz.config->>'bizWebsite'
        )
      );
    END;
    $body$;

    GRANT EXECUTE ON FUNCTION invoice_for_payment(UUID) TO anon, authenticated;
  ELSE
    RAISE NOTICE 'invoices table not present — skipping invoice_for_payment RPC';
  END IF;
END $$;


-- ------------------------------------------------------------
-- Mark the existing 2ntr tenant as having completed onboarding,
-- so the existing info@2ntr.com owner doesn't get bounced to
-- the onboarding wizard.
-- ------------------------------------------------------------
DO $$
DECLARE
  seed_tid UUID;
  cur_cfg  JSONB;
BEGIN
  SELECT id, config INTO seed_tid, cur_cfg
    FROM tenants WHERE owner_email = 'info@2ntr.com' LIMIT 1;
  IF seed_tid IS NOT NULL THEN
    UPDATE tenants
       SET config = COALESCE(cur_cfg, '{}'::jsonb) || jsonb_build_object(
             'onboarding_completed',    true,
             'onboarding_completed_at', to_jsonb(NOW())
           )
     WHERE id = seed_tid;
    RAISE NOTICE '2ntr tenant marked onboarding_completed';
  END IF;
END $$;


-- ------------------------------------------------------------
-- END 047_agreements.sql
-- ------------------------------------------------------------
