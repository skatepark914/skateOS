#!/usr/bin/env bash
# ============================================================
# Deploy all Edge Functions for skateOS-2ntr.
# Run once you've set the required secrets (see secrets-template.sh).
# ============================================================
set -euo pipefail

PROJECT_REF="zecurmlenxyxanqucrga"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "${SCRIPT_DIR}/.."

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "SUPABASE_ACCESS_TOKEN not set. Run: source ~/.zprofile"
  exit 1
fi

echo "=== Linking project ==="
supabase link --project-ref "$PROJECT_REF" || true

echo ""
echo "=== Deploying smartwaiver-lookup ==="
supabase functions deploy smartwaiver-lookup --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying smartwaiver-webhook (no-verify-jwt) ==="
supabase functions deploy smartwaiver-webhook --project-ref "$PROJECT_REF" --no-verify-jwt

echo ""
echo "=== Deploying weekly-backup ==="
supabase functions deploy weekly-backup --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying helcim-charge ==="
supabase functions deploy helcim-charge --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying helcim-invoice ==="
supabase functions deploy helcim-invoice --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying helcim-webhook (no-verify-jwt) ==="
supabase functions deploy helcim-webhook --project-ref "$PROJECT_REF" --no-verify-jwt

echo ""
echo "=== Deploying helcim-pay-init ==="
supabase functions deploy helcim-pay-init --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying send-email ==="
supabase functions deploy send-email --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying send-sms ==="
supabase functions deploy send-sms --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying send-lesson-reminders ==="
supabase functions deploy send-lesson-reminders --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying daily-digest ==="
supabase functions deploy daily-digest --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying birthday-greetings ==="
supabase functions deploy birthday-greetings --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying send-lesson-followups ==="
supabase functions deploy send-lesson-followups --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying send-renewal-reminders ==="
supabase functions deploy send-renewal-reminders --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying send-overdue-rentals ==="
supabase functions deploy send-overdue-rentals --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying weekly-preorder-digest ==="
supabase functions deploy weekly-preorder-digest --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying brivo-sync-customer ==="
supabase functions deploy brivo-sync-customer --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying brivo-sync-all ==="
supabase functions deploy brivo-sync-all --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying brivo-webhook (no-verify-jwt) ==="
supabase functions deploy brivo-webhook --project-ref "$PROJECT_REF" --no-verify-jwt

echo ""
echo "=== Deploying brivo-send-invite ==="
supabase functions deploy brivo-send-invite --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying brivo-lockdown ==="
supabase functions deploy brivo-lockdown --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying brivo-issue-event-pass ==="
supabase functions deploy brivo-issue-event-pass --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying brivo-sync-schedule ==="
supabase functions deploy brivo-sync-schedule --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploying frigate-webhook (no-verify-jwt) ==="
supabase functions deploy frigate-webhook --project-ref "$PROJECT_REF" --no-verify-jwt

echo ""
echo "=== Deploying brivo-save-config ==="
supabase functions deploy brivo-save-config --project-ref "$PROJECT_REF"

echo ""
echo "✅ Edge Functions deployed."
echo ""
echo "Don't forget to set the secrets if you haven't:"
echo "  supabase secrets set SMARTWAIVER_API_KEY=sw_xxx --project-ref $PROJECT_REF"
echo "  supabase secrets set SMARTWAIVER_WEBHOOK_SECRET=\$(openssl rand -hex 32) --project-ref $PROJECT_REF"
echo "  supabase secrets set HELCIM_API_TOKEN=<paste-real-token-from-helcim-dashboard> --project-ref $PROJECT_REF"
echo "  supabase secrets set HELCIM_WEBHOOK_VERIFIER_TOKEN=\$(openssl rand -hex 32) --project-ref $PROJECT_REF"
echo "  supabase secrets set RESEND_API_KEY=re_xxx --project-ref $PROJECT_REF"
echo ""
echo "Brivo (after Nick generates API credentials in Brivo dashboard):"
echo "  supabase secrets set BRIVO_CLIENT_ID=<oauth-client-id> --project-ref $PROJECT_REF"
echo "  supabase secrets set BRIVO_CLIENT_SECRET=<oauth-client-secret> --project-ref $PROJECT_REF"
echo "  supabase secrets set BRIVO_API_KEY=<subscription-api-key> --project-ref $PROJECT_REF"
echo "  supabase secrets set BRIVO_ACCOUNT_ID=<brivo-account-id> --project-ref $PROJECT_REF"
echo "  supabase secrets set BRIVO_ACTIVE_MEMBERS_GROUP_ID=<group-id> --project-ref $PROJECT_REF"
echo "  supabase secrets set BRIVO_PARK_DOOR_AP_ID=<access-point-id> --project-ref $PROJECT_REF"
echo "  supabase secrets set BRIVO_SHOP_DOOR_AP_ID=<access-point-id> --project-ref $PROJECT_REF"
echo "  supabase secrets set BRIVO_WEBHOOK_SECRET=\$(openssl rand -hex 32) --project-ref $PROJECT_REF"
echo "  supabase secrets set BRIVO_AUTO_CHECKIN_ENABLED=true --project-ref $PROJECT_REF"
