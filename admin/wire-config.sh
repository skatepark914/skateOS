#!/usr/bin/env bash
# ============================================================
# Pull anon key from the live Supabase project and write it
# (plus the project URL) into admin/config.js.
# Idempotent — re-run any time keys rotate.
# ============================================================
set -euo pipefail

PROJECT_REF="zecurmlenxyxanqucrga"
PROJECT_URL="https://${PROJECT_REF}.supabase.co"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CONFIG="${SCRIPT_DIR}/config.js"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "SUPABASE_ACCESS_TOKEN not set. Run: source ~/.zprofile  (or restart your terminal)"
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found. Install: brew install supabase/tap/supabase"
  exit 1
fi

echo "Fetching API keys for project $PROJECT_REF..."
if ! supabase projects api-keys --project-ref "$PROJECT_REF" --output json > /tmp/sb-keys.json 2>/tmp/sb-keys.err; then
  echo "supabase CLI errored. stderr:"
  cat /tmp/sb-keys.err
  echo "stdout:"
  cat /tmp/sb-keys.json 2>/dev/null || true
  exit 1
fi

echo "Raw API response:"
cat /tmp/sb-keys.json
echo ""

# New Supabase API uses "type":"publishable" / "type":"secret" — pick the publishable one.
ANON_KEY=$(python3 -c "
import json
try:
    d = json.load(open('/tmp/sb-keys.json'))
    for k in d:
        if k.get('type')=='publishable':
            print(k.get('api_key','')); break
        # fall back to legacy 'anon' name
        if k.get('name')=='anon':
            print(k.get('api_key','')); break
except Exception as e:
    print('PARSE_ERR:'+str(e))
")

if [ -z "$ANON_KEY" ] || [[ "$ANON_KEY" == PARSE_ERR* ]]; then
  echo "Could not extract publishable key from response above."
  exit 1
fi

echo "URL: $PROJECT_URL"
echo "Key: ${ANON_KEY:0:24}...(truncated)"
echo ""

if [ ! -f "$CONFIG" ]; then
  echo "config.js not found at $CONFIG"
  exit 1
fi

cp "$CONFIG" "${CONFIG}.bak"
sed -i '' \
  -e "s|supabaseUrl:.*|supabaseUrl:  '${PROJECT_URL}',|" \
  -e "s|supabaseKey:.*|supabaseKey:  '${ANON_KEY}',|" \
  "$CONFIG"

echo "Wrote ${CONFIG}. Diff:"
diff "${CONFIG}.bak" "$CONFIG" || true
echo ""
echo "Now run the migrations:"
echo "  DB_PASS='YOUR_DB_PASSWORD' bash ${SCRIPT_DIR}/migrations/run.sh"
