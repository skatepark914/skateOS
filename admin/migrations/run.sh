#!/usr/bin/env bash
# ============================================================
# Run all SkateOS migrations against the live Supabase project.
# Idempotent — safe to re-run; each migration uses IF NOT EXISTS.
# Reads DB password from 1Password if installed, otherwise prompts.
# ============================================================
set -euo pipefail

PROJECT_REF="zecurmlenxyxanqucrga"
DB_HOST="db.${PROJECT_REF}.supabase.co"
DB_USER="postgres"
DB_NAME="postgres"
DB_PORT="5432"
MIG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# --- DB password ---
if [ -z "${DB_PASS:-}" ]; then
  if command -v op >/dev/null 2>&1; then
    DB_PASS=$(op read 'op://Private/skateos-2ntr DB password/password' 2>/dev/null || true)
  fi
fi
if [ -z "${DB_PASS:-}" ]; then
  read -r -s -p "Enter Supabase DB password: " DB_PASS
  echo ""
fi

# --- psql check ---
if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install with: brew install libpq && echo 'export PATH=\"/usr/local/opt/libpq/bin:\$PATH\"' >> ~/.zprofile"
  exit 1
fi

DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

echo "Running migrations against $DB_HOST..."
echo ""

for f in "$MIG_DIR"/[0-9][0-9][0-9]_*.sql; do
  echo ">>> $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
  echo ""
done

echo "Verifying tables..."
psql "$DB_URL" -c "\dt public.*"
echo ""
echo "Migration complete."
