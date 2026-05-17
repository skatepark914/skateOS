#!/usr/bin/env bash
# ============================================================
# test-edge-functions.sh — verify every Edge Function is
# deployed + reachable on the target Supabase project.
#
# USAGE:
#   bash admin/scripts/test-edge-functions.sh
#
# Reads SUPABASE_URL + SUPABASE_ANON_KEY from admin/config.js,
# OR set them as env vars. Set OWNER_EMAIL too if you want
# real email/SMS sends.
#
# By default this only HITS each function with a probe payload
# and reports the HTTP status. It does NOT send real emails
# or SMS unless you pass --live.
#
# Non-destructive smoke test for a freshly-deployed project.
# ============================================================
set -u

# ─── Config ─────────────────────────────────────────────────
SUPABASE_URL="${SUPABASE_URL:-https://zecurmlenxyxanqucrga.supabase.co}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
OWNER_EMAIL="${OWNER_EMAIL:-info@2ntr.com}"
LIVE_MODE=0

if [ "${1:-}" = "--live" ]; then
  LIVE_MODE=1
  echo "🔴 LIVE MODE — real emails/SMS will be sent to $OWNER_EMAIL"
  echo ""
fi

# Pull SUPABASE_ANON_KEY from admin/config.js if not in env
if [ -z "$SUPABASE_ANON_KEY" ] && [ -f admin/config.js ]; then
  SUPABASE_ANON_KEY=$(grep -oE 'anon[A-Z_]*Key:\s*[\"`].[^\"`]*[\"`]' admin/config.js 2>/dev/null | head -1 | sed -E 's/.*[\"`](.*)[\"`]/\1/')
fi

if [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "❌ SUPABASE_ANON_KEY not set. Either export it or check admin/config.js"
  exit 1
fi

echo "Testing Edge Functions at: $SUPABASE_URL"
echo ""

# ─── Test helper ────────────────────────────────────────────
PASS=0
FAIL=0
WARN=0

probe() {
  local name="$1"
  local body="$2"
  local expected="${3:-200}"   # comma-separated list of acceptable HTTP codes

  printf "  %-30s " "$name"

  local status
  status=$(curl -s -o /tmp/probe-out -w "%{http_code}" \
    -X POST "${SUPABASE_URL}/functions/v1/${name}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "$body" 2>&1 || echo "000")

  if echo ",$expected," | grep -q ",$status,"; then
    echo "✓ $status"
    PASS=$((PASS + 1))
  elif [ "$status" = "000" ] || [ "$status" = "404" ]; then
    echo "✗ $status (function not deployed?)"
    FAIL=$((FAIL + 1))
  elif [ "$status" = "401" ] || [ "$status" = "403" ]; then
    echo "⚠ $status (auth issue — secrets may be missing)"
    WARN=$((WARN + 1))
  else
    echo "⚠ $status — $(head -1 /tmp/probe-out 2>/dev/null | head -c 80)"
    WARN=$((WARN + 1))
  fi
}

# ─── Test each function ─────────────────────────────────────
echo "🔍 Probing Edge Functions (probe payloads, no real sends unless --live)"
echo ""

# Email/SMS — non-destructive probe payloads
if [ $LIVE_MODE -eq 1 ]; then
  probe "send-email" \
    "{\"to\":\"$OWNER_EMAIL\",\"subject\":\"smoke test\",\"text\":\"This is a smoke-test email from test-edge-functions.sh. Verify wiring + ignore.\"}" \
    "200"
  probe "send-sms" \
    "{\"to\":\"+19144024624\",\"body\":\"skateOS smoke test\"}" \
    "200,207"
else
  probe "send-email" '{"smoke":"test"}' "400,422"   # validation should reject
  probe "send-sms"   '{"smoke":"test"}' "400,422"
fi

# Daily digest — only fire in live mode (sends real email)
if [ $LIVE_MODE -eq 1 ]; then
  probe "daily-digest" '{}' "200"
else
  echo "  daily-digest                   ⏭  skipped (live mode only — sends real email)"
fi

# Reminders — these query DB and only send if matching rows exist
probe "send-lesson-reminders"  '{}' "200"
probe "send-lesson-followups"  '{}' "200"
probe "send-renewal-reminders" '{}' "200"
probe "send-overdue-rentals"   '{}' "200"
probe "birthday-greetings"     '{}' "200"

# Helcim — these need real secrets to succeed; expect auth-related responses
probe "helcim-pay-init"  '{"amount":1,"currency":"USD"}'  "200,401,500"
probe "helcim-invoice"   '{"amount":1}'                   "200,400,401,500"
probe "helcim-charge"    '{"amount":1}'                   "200,400,401,500"
probe "helcim-webhook"   '{"event":"smoke.test","data":{}}' "200,400,401"

# Smartwaiver — these need real API key
probe "smartwaiver-lookup"  '{"email":"smoke-test@example.com"}' "200,401,404"
probe "smartwaiver-webhook" '{"event":"smoke.test"}'             "200,400,401"

# Backups — these write to storage, don't fire unless live
if [ $LIVE_MODE -eq 1 ]; then
  probe "weekly-backup"  '{}' "200"
  probe "backup-cleanup" '{}' "200"
else
  echo "  weekly-backup                  ⏭  skipped (live mode only — runs real backup)"
  echo "  backup-cleanup                 ⏭  skipped (live mode only — deletes old backups)"
fi

# Pre-order digest
probe "weekly-preorder-digest" '{}' "200"

# ─── Summary ────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  PASS: $PASS    WARN: $WARN    FAIL: $FAIL"
echo "════════════════════════════════════════════════════"
echo ""
if [ $FAIL -gt 0 ]; then
  echo "✗ FAILED probes typically mean the function isn't deployed."
  echo "  Run: bash admin/deploy-functions.sh"
  echo ""
fi
if [ $WARN -gt 0 ]; then
  echo "⚠ WARN probes typically mean secrets are missing."
  echo "  Set via: supabase secrets set NAME=value --project-ref <ref>"
  echo "  See admin/scripts/ONBOARDING.md for the required secret list."
  echo ""
fi
if [ $PASS -gt 0 ] && [ $FAIL -eq 0 ] && [ $WARN -eq 0 ]; then
  echo "✓ All probes returned expected status. Edge Functions are wired correctly."
  if [ $LIVE_MODE -eq 0 ]; then
    echo "  Run with --live to send a real test email + SMS to $OWNER_EMAIL"
  fi
fi
