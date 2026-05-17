-- ============================================================
-- 066_member_signup_form.sql — public member-signup form row
-- ============================================================
-- Inserts (or updates) the `forms` row that admin/join.html and the
-- 2ntr public landing reference. Anon can read forms + insert into
-- form_submissions per the RLS policies from migration 011.
--
-- The actual signup UI is hand-built in admin/join.html (richer than
-- the generic admin/booking.html renderer can express) — this row
-- exists purely to satisfy the form_submissions.form_id FK so anon
-- INSERTs go through.
--
-- IDEMPOTENT — uses ON CONFLICT (slug) DO UPDATE.
-- ============================================================

INSERT INTO forms (slug, name, description, enabled, schema)
VALUES (
  'member-signup',
  'Become a member',
  'Sign up for membership at 2nd Nature Park.',
  TRUE,
  jsonb_build_object(
    'rendered_via', 'admin/join.html',
    'fields', '[]'::jsonb
  )
)
ON CONFLICT (slug) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      enabled     = TRUE,
      schema      = EXCLUDED.schema;
