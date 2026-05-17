#!/usr/bin/env bash
# ============================================================
# Create the first owner login for skateOS.
# Inserts into auth.users + auth.identities + staff atomically.
# Idempotent — safe to re-run; resets password and ensures owner role.
# Usage:
#   DB_PASS='...' OWNER_EMAIL='you@2ntr.com' OWNER_NAME='Doug' OWNER_PASSWORD='strong' bash setup-owner.sh
# Or run interactively — prompts for missing values.
# ============================================================
set -euo pipefail

PROJECT_REF="zecurmlenxyxanqucrga"
DB_HOST="db.${PROJECT_REF}.supabase.co"
DB_USER="postgres"
DB_NAME="postgres"
DB_PORT="5432"

if [ -z "${DB_PASS:-}" ]; then
  read -r -s -p "DB password: " DB_PASS; echo ""
fi
if [ -z "${OWNER_EMAIL:-}" ]; then
  read -r -p "Owner email (login): " OWNER_EMAIL
fi
if [ -z "${OWNER_NAME:-}" ]; then
  read -r -p "Display name (e.g. Doug): " OWNER_NAME
fi
if [ -z "${OWNER_PASSWORD:-}" ]; then
  read -r -s -p "Owner password (min 8 chars): " OWNER_PASSWORD; echo ""
fi

# Escape single quotes for SQL string literals (' -> '')
ESC_EMAIL="${OWNER_EMAIL//\'/\'\'}"
ESC_PW="${OWNER_PASSWORD//\'/\'\'}"
ESC_NAME="${OWNER_NAME//\'/\'\'}"

DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$do\$
DECLARE
  v_uid UUID;
BEGIN
  -- Find or create the auth user
  SELECT id INTO v_uid FROM auth.users WHERE email = '${ESC_EMAIL}' LIMIT 1;

  IF v_uid IS NULL THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated', 'authenticated',
      '${ESC_EMAIL}',
      crypt('${ESC_PW}', gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      NOW(), NOW(), '', '', '', ''
    ) RETURNING id INTO v_uid;
    RAISE NOTICE 'Created new auth user %', v_uid;
  ELSE
    UPDATE auth.users
       SET encrypted_password = crypt('${ESC_PW}', gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
           updated_at = NOW()
     WHERE id = v_uid;
    RAISE NOTICE 'Reset password on existing auth user %', v_uid;
  END IF;

  -- Identity row — REQUIRED by Supabase Auth for sign-in to succeed
  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_uid, v_uid::text,
    jsonb_build_object('sub', v_uid::text, 'email', '${ESC_EMAIL}', 'email_verified', true),
    'email', NOW(), NOW(), NOW()
  )
  ON CONFLICT (provider, provider_id) DO UPDATE
    SET identity_data = EXCLUDED.identity_data, updated_at = NOW();

  -- Staff row — owner role
  INSERT INTO staff (id, email, display_name, role, active)
    VALUES (v_uid, '${ESC_EMAIL}', '${ESC_NAME}', 'owner', true)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        role = 'owner',
        active = true;

  RAISE NOTICE 'Owner ready: % (%)', '${ESC_EMAIL}', v_uid;
END
\$do\$;
SQL

echo ""
echo "✅ Owner account ready."
echo "   Login at admin/index.html with:"
echo "   email:    $OWNER_EMAIL"
echo "   password: (the one you just typed)"
