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
