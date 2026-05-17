#!/usr/bin/env bash
# ============================================================
# DESTRUCTIVE — drops the public schema and re-runs ALL migrations.
# Use only when the DB is in a half-applied state and we want a
# clean rebuild. Real customer data will be lost — only safe pre-launch.
# ============================================================
set -euo pipefail

PROJECT_REF="zecurmlenxyxanqucrga"
DB_HOST="db.${PROJECT_REF}.supabase.co"
DB_USER="postgres"
DB_NAME="postgres"
DB_PORT="5432"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [ -z "${DB_PASS:-}" ]; then
  read -r -s -p "DB password: " DB_PASS
  echo ""
fi

DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

echo "=== STEP 1: Reset public schema ==="
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO anon;
GRANT ALL ON SCHEMA public TO authenticated;
GRANT ALL ON SCHEMA public TO service_role;
SQL
echo ""

echo "=== STEP 2: Run migrations ==="
DB_PASS="$DB_PASS" bash "${SCRIPT_DIR}/run.sh"
