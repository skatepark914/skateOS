# BRIVO.md — Brivo cloud access integration

> Runbook for the skateOS × Brivo integration. Read this before debugging anything door-related.

## What this is

skateOS integrates with [Brivo](https://www.brivo.com) for cloud-based access control on the park door. Members get 24/7 entry via Brivo Mobile Pass; lapsed / banned / waiver-expired customers auto-revoke without manual intervention.

**Two doors, two scopes:**

| Door | Hardware | Group | Managed by |
|---|---|---|---|
| Park door | BDS (Brivo Door Station — intercom + camera + reader) + 9600 rim strike | `skateOS Active Members` | **skateOS via API** |
| Shop door | Brivo Mullion smart reader | `Staff` | **Brivo dashboard manually** |

skateOS never touches the Staff group. Nick / Doug manage staff credentials directly in Brivo.

## How it works

```
┌─────────────────┐   subscription      ┌──────────────────┐
│ skateOS admin   │   INSERT/UPDATE/   ─►│ customers row    │
│                 │   DELETE            │ tagged for sync  │
└─────────────────┘                     └────────┬─────────┘
                                                 │
                              every 5 min        │
                                                 ▼
                                       ┌──────────────────────┐
                                       │ brivo-sync-customer  │  ──► Brivo API
                                       │ (Edge Function)      │       ├─ create user
                                       └──────────────────────┘       ├─ add to group
                                                                       └─ send invite
                                                                              │
                                                                              ▼
                                       ┌──────────────────────┐    Brivo Mobile Pass
┌─────────────────┐                    │   member's phone     │ ◄────────────
│ brivo-webhook   │ ◄── Brivo cloud ── │  taps BDS reader     │
│ (Edge Function) │    (signed)         │  door clicks open   │
└────────┬────────┘                    └──────────────────────┘
         │
         ▼
┌──────────────────┐                  ┌────────────────────────┐
│ brivo_access_log │                  │ auto-checkin row drops │
│ table            │ ────────────────►│ on park-door grant     │
└──────────────────┘                  └────────────────────────┘
```

## Required dashboard setup (Brivo side)

Already done by Nick on 2026-05-15 for 2nd Nature Park. For new tenants:

1. **Access Points** — name them `Park Door` + `Shop Door` (skateOS reads by ID but consistent names help debugging)
2. **Groups**:
   - `Staff` → both doors, 24/7 schedule, manual roster
   - `skateOS Active Members` → park door only, 24/7 schedule, **API-managed (don't touch manually)**
3. **API client** with scopes: `read:users`, `write:users`, `read:groups`, `write:groups`, `read:access_points`, `read:events`, `write:credentials`
4. **Webhook** → URL + events: `access_granted`, `access_denied`, `door_held_open`, `door_forced`. Two URL options:
   - **Single-tenant install (2nd Nature):** `https://zecurmlenxyxanqucrga.supabase.co/functions/v1/brivo-webhook` — uses `BRIVO_WEBHOOK_SECRET` env var for signature verification.
   - **Multi-tenant install (per-park):** `https://zecurmlenxyxanqucrga.supabase.co/functions/v1/brivo-webhook?tenant=<tenant-uuid>` — uses that tenant's `webhook_secret` from `tenant_brivo_config`. Cleaner routing, no customer-lookup fallback dance. Copy this URL from Settings → Brivo per-tenant credentials → "🔗 PER-TENANT WEBHOOK URL" block.

## Required Supabase secrets

```bash
supabase secrets set \
  BRIVO_CLIENT_ID=<oauth-client-id> \
  BRIVO_CLIENT_SECRET=<oauth-client-secret> \
  BRIVO_API_KEY=<subscription-api-key> \
  BRIVO_ACCOUNT_ID=<brivo-account-id> \
  BRIVO_ACTIVE_MEMBERS_GROUP_ID=<group-id> \
  BRIVO_PARK_DOOR_AP_ID=<park-access-point-id> \
  BRIVO_SHOP_DOOR_AP_ID=<shop-access-point-id> \
  BRIVO_WEBHOOK_SECRET=$(openssl rand -hex 32) \
  BRIVO_AUTO_CHECKIN_ENABLED=true \
  --project-ref zecurmlenxyxanqucrga

bash admin/deploy-functions.sh
```

`APP_BASE_URL` is also read for the unsubscribe footer link in the welcome email (defaults to `https://app.skateos.com`).

## State machine — who gets access

The `brivo_member_desired` view computes `should_have_access` per customer. Order of evaluation (first match wins):

| Reason | Triggers `should_have_access = FALSE` |
|---|---|
| `banned` | Customer has tag `banned` / `do_not_serve` / `donotserve` / `86d` (case + separator insensitive) |
| `no_waiver` | `customers.waiver_signed_at` is NULL |
| `waiver_expired` | `customers.waiver_expires_at < now()` |
| `no_active_membership` | No `subscriptions` row with `status='active'` + `plan_type IN ('monthly','annual')` + `end_date >= today` + `paused_until <= today` |
| `eligible` | Everything else → access granted |

**To change the eligible plan types** (e.g. to add `punch_card`): edit `admin/migrations/064_brivo_integration.sql` lines 121-127 and re-apply.

## Migration backlog

| Migration | What it adds |
|---|---|
| `064_brivo_integration.sql` | `customers.brivo_*` columns, `brivo_access_log` table, `brivo_member_desired` view, triggers, pg_cron every 5 min + daily 4am |
| `065_brivo_welcome_email.sql` | `customers.brivo_welcome_sent_at` idempotency stamp |
| `067_brivo_event_passes.sql` | `brivo_event_passes` table (time-bounded access for parties / industry comps / events). Extends `brivo_member_desired` view: access granted EITHER by active monthly/annual sub OR by an active pass. `brivo_sweep_expired_event_passes()` RPC + pg_cron `brivo-event-pass-sweep` revokes expired passes every 5 min. |

Bundle file `_apply_pending_062_to_065.sql` applies migrations 062-065 in one paste. Migration 067 ships separately + can be applied after.

## Edge Functions

| Function | Purpose | Triggered by |
|---|---|---|
| `_brivo/api.ts` | OAuth + REST helpers (shared, not invoked directly) | `import` from the others |
| `brivo-sync-customer` | Reconcile one customer (provision / invite / revoke). Respects lockdown gate + welcome-email config. | pg_cron sweep, admin "Sync now" button, brivo-sync-all |
| `brivo-sync-all` | Bulk reconcile + drift detection | pg_cron every 5 min (flagged mode) + daily 4am (full mode) |
| `brivo-webhook` | Receives door events (access / face / intercom / video); signature-verified; cross-refs customer; auto-checkin on park-door grant + face match; fires failed-access alert on 3+ denials in 5 min; fires capacity-overflow alert when at maxCapacity | Brivo dashboard |
| `brivo-send-invite` | Manual "Resend mobile pass" from admin | Customer detail button |
| `brivo-lockdown` | Engage / release emergency mass-revoke | Owner-only Settings button |
| `brivo-issue-event-pass` | Issue time-bounded pass (birthday parties, comp events) | Customer detail "Issue event pass" button, party-quote flow |
| `brivo-sync-schedule` | Push skateOS park hours into Brivo's operating-hours schedule | Settings → Brivo "Push hours to Brivo" button (dry-run + apply) |

## Common operations

### Onboard a new member
1. Cashier rings up a monthly or annual membership at POS → `subscriptions` row inserts with `status='active'`
2. `trg_brivo_subscription_sync` fires → `customers.brivo_sync_needed_at` stamped
3. Within 5 min, `brivo-sync-flagged` cron picks it up → calls `brivo-sync-customer`
4. brivo-sync-customer: creates Brivo user → adds to active-members group → sends Mobile Pass invite → fires branded welcome email
5. Member receives **two emails**: Brivo's generic Mobile Pass invite + skateOS's branded "🔓 You're in" welcome
6. Member installs Brivo Mobile app, accepts pass, walks to park door, taps phone → door unlocks

**Force immediate sync** (skip the 5-min wait): customer detail → "Sync now" button.

### Revoke a member
Any of: cancel subscription / set `paused_until` / add `banned` tag / let waiver expire.

The triggers stamp `brivo_sync_needed_at`; cron picks up; Brivo user is removed from the group (user record kept for audit history).

**Force immediate revoke**: tag customer `banned` then click "Sync now" on their detail.

### Resend the welcome email
Customer detail → "Resend welcome email" button. Clears the `brivo_welcome_sent_at` stamp then re-syncs.

### Check what's happening at the door right now
Dashboard → "Park access · last 8h" widget (owner-only).
- Activity Log → Brivo door events card → filter + CSV export.

### Failed-access alert
When the same customer gets denied 3+ times in 5 minutes, a Team Chat reminder fires automatically with the customer name + their current credential state. Suggests checking their phone / membership / waiver. One alert per customer per 30-min window (no spam).

## Troubleshooting flowchart

```
Door won't open / member says "denied"
│
├─ Q: Are they an active member?
│   └─ admin → customer detail → check Memberships panel + Brivo panel state
│       ├─ "🟢 ACCESS ACTIVE" + active membership → see network checks below
│       ├─ "🔴 REVOKED" → check `desired_reason` in Brivo panel + fix root cause (waiver / membership / tag)
│       ├─ "🟡 INVITE PENDING" → they haven't installed Brivo Mobile yet → resend invite
│       └─ "— NOT PROVISIONED" → click "Sync now"
│
├─ Q: Does the door event show up in Activity Log → Brivo events?
│   ├─ Yes, "access_denied" → Brivo received the tap; check member's credential state above
│   ├─ Yes, "access_granted" but door physically didn't open → wiring / 9600 strike issue (call Nick)
│   └─ No event at all → BLE issue OR webhook issue:
│       ├─ Check Brivo's own event log (Brivo dashboard) — did Brivo see the tap?
│       │   ├─ Yes → webhook isn't reaching us → check Activity Log → Webhook log card
│       │   │       ├─ "signature_mismatch" → BRIVO_WEBHOOK_SECRET doesn't match Brivo's config
│       │   │       └─ Nothing logged at all → Brivo's webhook config wrong URL
│       │   └─ No → BLE / phone issue → member opens Brivo app, checks Bluetooth, retries
│
└─ Q: Member has no phone / dead phone / forgot phone?
    └─ Use the BDS intercom button to buzz front desk during staffed hours
```

## Inspect SQL helpers

```sql
-- Who should have access right now + why
SELECT name, should_have_access, desired_reason
FROM brivo_member_desired
ORDER BY should_have_access DESC, name;

-- See all flagged customers waiting on sync
SELECT id, name, brivo_credential_state, brivo_sync_needed_at, brivo_sync_error
FROM customers
WHERE brivo_sync_needed_at IS NOT NULL
ORDER BY brivo_sync_needed_at;

-- Recent access events for one customer
SELECT occurred_at, access_point, event_type
FROM brivo_access_log
WHERE customer_id = '<uuid>'
ORDER BY occurred_at DESC
LIMIT 20;

-- Force-flag one customer for immediate sync
SELECT brivo_flag_customer_sync('<uuid>');

-- View pg_cron schedule
SELECT jobid, jobname, schedule, command
FROM cron.job
WHERE jobname LIKE 'brivo-%';

-- Recent cron runs (last 20)
SELECT *
FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'brivo-%')
ORDER BY end_time DESC
LIMIT 20;
```

## Roadmap

Tracked in `CLAUDE.md` In-flight TODOs:

- **Item 8**: Per-tenant Brivo (white-label) — each park provisions their own Brivo cloud account. Three paths: Partner Program / BYO credentials / OAuth Connect.
- **Item 9**: skateOS Vision Box — on-site Frigate + Coral dongle per park for camera-AI-aware incident detection, capacity counting, intrusion alerts. Pairs with Brivo for "person at door + no Brivo grant" detection.

## Initial setup history

- **2026-05-15**: Nick installed BDS on park door + Mullion on shop door + 9600 rim strike. Configured Brivo dashboard groups / API client / webhook. Migration 064 + Edge Functions deployed. First mobile pass landed on Doug's phone same day; door opened on first tap.
- **2026-05-15**: Migration 065 + welcome email shipped. Dashboard "in park via Brivo" widget + failed-access alert + customer-detail Resend welcome button shipped.
