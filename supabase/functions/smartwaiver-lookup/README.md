# Smartwaiver Edge Functions

Two functions, both server-side so the API key never ships to browsers.

## `smartwaiver-lookup`
Called by `admin/smartwaiver.js` from the front desk.

**Actions**
- `lookup_by_email` — finds a waiver by participant email; if found, syncs the matching customer row.
- `lookup_by_id` — fetches a specific waiver record.
- `recent` — pulls the latest N waivers (default 25).

## `smartwaiver-webhook`
Receives push callbacks from Smartwaiver when a new waiver is signed.

Configure in **Smartwaiver dashboard → Settings → Webhooks**:
- **URL:** `https://zecurmlenxyxanqucrga.supabase.co/functions/v1/smartwaiver-webhook`
- **Event:** "Waiver Signed" (and optionally "Waiver Updated")
- **Secret:** anything strong; copy it into the `SMARTWAIVER_WEBHOOK_SECRET` Edge Function secret. The webhook then sends it as the `x-webhook-secret` header.

Deploy after first secret set:
```bash
supabase functions deploy smartwaiver-webhook --project-ref zecurmlenxyxanqucrga --no-verify-jwt
```
(`--no-verify-jwt` because Smartwaiver doesn't send a Supabase JWT.)

## Required secrets (set once)

```bash
PROJECT_REF=zecurmlenxyxanqucrga
supabase secrets set SMARTWAIVER_API_KEY=sw_xxx --project-ref $PROJECT_REF
supabase secrets set SMARTWAIVER_WEBHOOK_SECRET=$(openssl rand -hex 32) --project-ref $PROJECT_REF
```

Get `SMARTWAIVER_API_KEY` from https://api.smartwaiver.com/dashboard → API Keys.

## Deploy both

```bash
PROJECT_REF=zecurmlenxyxanqucrga
supabase functions deploy smartwaiver-lookup  --project-ref $PROJECT_REF
supabase functions deploy smartwaiver-webhook --project-ref $PROJECT_REF --no-verify-jwt
```

## Test

```bash
# Lookup
curl -X POST https://${PROJECT_REF}.supabase.co/functions/v1/smartwaiver-lookup \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"lookup_by_email","payload":{"email":"liam@example.com"}}'
```
