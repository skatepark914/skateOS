#!/usr/bin/env bash
# ============================================================
# Set up optional off-site backup destinations for the
# weekly-backup Edge Function.
#
# AS OF 2026-04-29 the function ALREADY backs up to Supabase
# Storage (private `backups` bucket) on every run — so Doug
# already has a working backup without doing anything.
# This script is for adding redundancy via AWS S3 and/or
# Backblaze B2 so a Supabase outage doesn't lose the only copy.
#
# Usage:
#   bash admin/setup-backup.sh aws    # configure AWS only
#   bash admin/setup-backup.sh b2     # configure Backblaze B2 only
#   bash admin/setup-backup.sh both   # configure both
#   bash admin/setup-backup.sh test   # trigger a backup + show result
#   bash admin/setup-backup.sh status # list current backups in Supabase Storage
# ============================================================
set -euo pipefail

PROJECT_REF="zecurmlenxyxanqucrga"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplY3VybWxlbnh5eGFucXVjcmdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NTUzMjIsImV4cCI6MjA5MzAzMTMyMn0.PtW3hxsok3ZUw0CFdB7aysnJ2UFkwltHq2Bt1Pw-hK8"

require_token() {
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    echo "❌ SUPABASE_ACCESS_TOKEN not set. Run: source ~/.zprofile"
    exit 1
  fi
  if [[ ! "$SUPABASE_ACCESS_TOKEN" =~ ^sbp_ ]]; then
    echo "❌ SUPABASE_ACCESS_TOKEN format invalid (must start with sbp_)."
    exit 1
  fi
}

prompt() {
  local var=$1; local label=$2; local default=${3:-}
  local val
  if [ -n "$default" ]; then
    read -r -p "  $label [$default]: " val
    val=${val:-$default}
  else
    read -r -p "  $label: " val
  fi
  eval "$var=\"$val\""
}

setup_aws() {
  require_token
  echo ""
  echo "=== AWS S3 Setup ==="
  echo ""
  echo "Before this script can do anything you need:"
  echo "  1. An AWS account with billing set up"
  echo "  2. An S3 bucket created (private — public ACLs OFF)"
  echo "  3. An IAM user with PutObject permission on that bucket"
  echo "  4. The IAM user's Access Key ID + Secret Access Key"
  echo ""
  echo "If you don't have those: https://docs.aws.amazon.com/AmazonS3/latest/userguide/creating-bucket.html"
  echo ""
  prompt AWS_ACCESS_KEY_ID     "AWS Access Key ID"
  prompt AWS_SECRET_ACCESS_KEY "AWS Secret Access Key"
  prompt AWS_REGION            "AWS region" "us-west-2"
  prompt AWS_S3_BUCKET         "S3 bucket name" "skateos-2ntr-backups"

  echo ""
  echo ">>> Setting Supabase secrets..."
  supabase secrets set "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" --project-ref "$PROJECT_REF"
  supabase secrets set "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" --project-ref "$PROJECT_REF"
  supabase secrets set "AWS_REGION=$AWS_REGION" --project-ref "$PROJECT_REF"
  supabase secrets set "AWS_S3_BUCKET=$AWS_S3_BUCKET" --project-ref "$PROJECT_REF"
  echo "✅ AWS secrets set."
}

setup_b2() {
  require_token
  echo ""
  echo "=== Backblaze B2 Setup ==="
  echo ""
  echo "Before this script can do anything you need:"
  echo "  1. A Backblaze account (https://www.backblaze.com/cloud-storage)"
  echo "  2. A private B2 bucket (recommend: skateos-2ntr-backups-b2)"
  echo "  3. An Application Key with read+write access to that bucket"
  echo ""
  echo "B2's first 10 GB are free. Pricing: \$6/TB/mo after that."
  echo ""
  prompt B2_ACCESS_KEY_ID     "B2 Application Key ID"
  prompt B2_SECRET_ACCESS_KEY "B2 Application Key (the secret half)"
  prompt B2_REGION            "B2 region (from S3-compatible endpoint)" "us-west-004"
  prompt B2_ENDPOINT          "B2 S3 endpoint URL" "https://s3.us-west-004.backblazeb2.com"
  prompt B2_BUCKET            "B2 bucket name" "skateos-2ntr-backups-b2"

  echo ""
  echo ">>> Setting Supabase secrets..."
  supabase secrets set "B2_ACCESS_KEY_ID=$B2_ACCESS_KEY_ID" --project-ref "$PROJECT_REF"
  supabase secrets set "B2_SECRET_ACCESS_KEY=$B2_SECRET_ACCESS_KEY" --project-ref "$PROJECT_REF"
  supabase secrets set "B2_REGION=$B2_REGION" --project-ref "$PROJECT_REF"
  supabase secrets set "B2_ENDPOINT=$B2_ENDPOINT" --project-ref "$PROJECT_REF"
  supabase secrets set "B2_BUCKET=$B2_BUCKET" --project-ref "$PROJECT_REF"
  echo "✅ B2 secrets set."
}

trigger_test() {
  echo ""
  echo "=== Triggering a test backup ==="
  echo ""
  curl -s -X POST "$SUPABASE_URL/functions/v1/weekly-backup" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    -w "\nHTTP=%{http_code}\n"
}

list_backups() {
  echo ""
  echo "=== Backups in Supabase Storage ==="
  echo ""
  if [ -z "${DB_PASS:-}" ]; then
    if command -v op >/dev/null 2>&1; then
      DB_PASS=$(op read 'op://Private/skateos-2ntr DB password/password' 2>/dev/null || true)
    fi
  fi
  if [ -z "${DB_PASS:-}" ]; then
    read -r -s -p "Supabase DB password: " DB_PASS; echo ""
  fi
  psql "postgresql://postgres:${DB_PASS}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require" -c "
    SELECT name, pg_size_pretty((metadata->>'size')::bigint) AS size, created_at::date AS created
    FROM storage.objects
    WHERE bucket_id = 'backups'
    ORDER BY created_at DESC
    LIMIT 20;
  "
}

case "${1:-}" in
  aws)    setup_aws; trigger_test ;;
  b2)     setup_b2;  trigger_test ;;
  both)   setup_aws; setup_b2; trigger_test ;;
  test)   trigger_test ;;
  status) list_backups ;;
  *)
    echo "Usage: bash admin/setup-backup.sh {aws|b2|both|test|status}"
    echo ""
    echo "  aws    — configure AWS S3 destination + run test backup"
    echo "  b2     — configure Backblaze B2 destination + run test backup"
    echo "  both   — configure both providers + run test backup"
    echo "  test   — trigger a backup right now (uses whatever's already configured)"
    echo "  status — list backups currently in Supabase Storage"
    exit 1
    ;;
esac
