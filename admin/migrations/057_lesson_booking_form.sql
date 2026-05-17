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
