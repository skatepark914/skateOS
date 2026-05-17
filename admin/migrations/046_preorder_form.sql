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
