#!/usr/bin/env bash
# ============================================================
# Deploy the Smartwaiver integration end-to-end.
# Sets API key + webhook secret, prints the secret for you,
# then deploys the three Edge Functions.
#
# Usage:
#   bash admin/deploy-smartwaiver.sh <SMARTWAIVER_API_KEY> [<WEBHOOK_SECRET>]
#
# If you don't pass a webhook secret, a random one is generated.
# Pass an existing one to preserve it across re-runs (so the
# Smartwaiver dashboard config doesn't drift).
#
# Requires: supabase CLI + SUPABASE_ACCESS_TOKEN (`sbp_…`) in env.
# ============================================================
set -euo pipefail

PROJECT_REF="zecurmlenxyxanqucrga"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "${SCRIPT_DIR}/.."

# --- 1. API key from arg or env -----------------------------
SW_API_KEY="${1:-${SMARTWAIVER_API_KEY:-}}"
if [ -z "$SW_API_KEY" ]; then
  echo "Usage: bash admin/deploy-smartwaiver.sh <YOUR_SMARTWAIVER_API_KEY> [<WEBHOOK_SECRET>]"
  echo "Or:    SMARTWAIVER_API_KEY=... bash admin/deploy-smartwaiver.sh"
  exit 1
fi

# --- 2. Auth check (BEFORE generating any secrets) ----------
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "❌ SUPABASE_ACCESS_TOKEN not set."
  echo "   Run: source ~/.zprofile"
  exit 1
fi
if [[ ! "$SUPABASE_ACCESS_TOKEN" =~ ^sbp_[a-zA-Z0-9]{40,}$ ]]; then
  echo "❌ SUPABASE_ACCESS_TOKEN format invalid — must look like sbp_xxxxxxxx (40+ chars)."
  echo "   Generate a fresh one: https://supabase.com/dashboard/account/tokens"
  echo "   Then: echo 'export SUPABASE_ACCESS_TOKEN=sbp_xxx' >> ~/.zprofile && source ~/.zprofile"
  exit 1
fi
if ! command -v supabase >/dev/null 2>&1; then
  echo "❌ supabase CLI not installed. Install with: brew install supabase/tap/supabase"
  exit 1
fi

# --- 3. Webhook secret: reuse if passed, else generate ------
WEBHOOK_SECRET="${2:-}"
if [ -z "$WEBHOOK_SECRET" ]; then
  WEBHOOK_SECRET=$(openssl rand -hex 32)
  WEBHOOK_NOTE="(generated fresh — save this!)"
else
  WEBHOOK_NOTE="(reusing the value you passed)"
fi

echo ""
echo "======================================================"
echo " Smartwaiver Deploy"
echo "======================================================"
echo ""
echo "Webhook signing secret (paste this into Smartwaiver's webhook config):"
echo ""
echo "  ${WEBHOOK_SECRET}"
echo ""
echo "Webhook URL to give Smartwaiver:"
echo ""
echo "  https://${PROJECT_REF}.supabase.co/functions/v1/smartwaiver-webhook"
echo ""
echo "======================================================"
echo ""

# --- 4. Push secrets to Supabase ---------------------------
echo ">>> Setting SMARTWAIVER_API_KEY"
supabase secrets set "SMARTWAIVER_API_KEY=${SW_API_KEY}" --project-ref "$PROJECT_REF"

echo ">>> Setting SMARTWAIVER_WEBHOOK_SECRET"
supabase secrets set "SMARTWAIVER_WEBHOOK_SECRET=${WEBHOOK_SECRET}" --project-ref "$PROJECT_REF"

# --- 5. Deploy the three Edge Functions --------------------
echo ""
echo ">>> Linking project"
supabase link --project-ref "$PROJECT_REF" || true

echo ""
echo ">>> Deploying smartwaiver-lookup"
supabase functions deploy smartwaiver-lookup --project-ref "$PROJECT_REF"

echo ""
echo ">>> Deploying smartwaiver-webhook (no JWT verification — Smartwaiver signs with the shared secret)"
supabase functions deploy smartwaiver-webhook --project-ref "$PROJECT_REF" --no-verify-jwt

echo ""
echo ">>> Deploying weekly-backup"
supabase functions deploy weekly-backup --project-ref "$PROJECT_REF"

echo ""
echo "======================================================"
echo " ✅ Deployed."
echo ""
echo " Next: paste the webhook secret + URL above into your"
echo " Smartwaiver dashboard (Webhooks). Then tell Claude in"
echo " Cowork and I'll smoke-test the lookup."
echo "======================================================"
