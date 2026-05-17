# TUTORIAL.md — how to actually use everything

> Walkthroughs for the stuff we built. Pair with `BRIVO.md` (runbook + troubleshooting) and `VISION.md` (Vision Box hardware specifics).

---

## Table of contents

1. [First-time setup (owner)](#1-first-time-setup-owner)
2. [Daily operations: front desk](#2-daily-operations-front-desk)
3. [Daily operations: members](#3-daily-operations-members)
4. [Birthday parties + event passes](#4-birthday-parties--event-passes)
5. [Emergency procedures](#5-emergency-procedures)
6. [Marketing + customer signup](#6-marketing--customer-signup)
7. [White-label: onboarding a second park](#7-white-label-onboarding-a-second-park)
8. [Reports + BI](#8-reports--bi)
9. [Vision Box (when hardware lands)](#9-vision-box-when-hardware-lands)
10. [Troubleshooting cheat-sheet](#10-troubleshooting-cheat-sheet)

---

## 1. First-time setup (owner)

This is what you do tomorrow morning to make everything live.

### Step 1: Apply database migrations
1. Open Supabase dashboard → SQL Editor → New query
2. Paste the contents of `admin/migrations/_apply_pending_062_to_065.sql` → click Run
3. Verify the footer message says "✓ 10 passed, 0 failed"
4. Repeat with each of: `066_member_signup_form.sql`, `067_brivo_event_passes.sql`, `068_frigate_events.sql`, `069_tenant_brivo_config.sql`

### Step 2: Deploy Edge Functions
```bash
cd ~/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark
bash admin/deploy-functions.sh
```
Should print "✅ Edge Functions deployed."

### Step 3: Walk the Setup Status card
1. Open admin → Dashboard
2. Scroll to "Setup status" card (owner-only, has a progress bar)
3. Anything red/amber → click the "Configure →" button to jump to the right Settings tab
4. Done when the progress bar hits 100%

### Step 4: Smoke test the door
1. Open Brivo Mobile on your phone
2. Walk to the park door
3. Tap → should unlock in <1 second
4. Open admin → Activity Log → Brivo door events → you should see the `access_granted` row with your name
5. Open admin → Check-In → you should appear in the "in the park" list with audit note "Auto-checked-in via Brivo park door…"
6. Open your own customer detail → Brivo panel should show "🟢 ACCESS ACTIVE"

If all 4 happen, the whole stack is live.

---

## 2. Daily operations: front desk

### Selling a membership to a new walk-in
1. POS → click the "+" next to customer dropdown → quick-add modal
2. Name + DOB + email + phone + optional address. Guardian fields auto-appear if DOB is under 18.
3. Save → customer is created
4. Search for "Monthly Unlimited" (or whichever plan) → click to add to cart
5. Helcim charge button → customer taps card → sale completes
6. **What happens automatically:**
   - Subscription row inserts with `status='active'`
   - Trigger flags the customer for Brivo sync (within 5 min)
   - Cron picks up → creates Brivo user → adds to active-members group → sends Brivo Mobile Pass invite
   - skateOS also sends the branded "🔓 You're in" welcome email
   - Customer gets 2 emails in their inbox → installs Brivo app → has 24/7 access

### Selling a day pass
- Same flow but pick "Day Pass — Adult" or "Day Pass — Under 12"
- No Brivo provisioning happens (day passes don't grant 24/7 access)
- Customer checks in via Check-In page on each visit

### Selling a punch card
- "10-Pack Punch Card" → ring up like any product
- Punches decrement on each check-in
- When count hits ≤2, Check-In auto-prompts the cashier with a renewal modal
- No Brivo access (punch cards are session-based, not time-based)

### Resending a Brivo invite (member says "I never got the app email")
1. Customer detail → Brivo panel → "Resend mobile pass" button
2. Brivo re-fires the invite email

### Resending the welcome email (the skateOS branded one)
1. Customer detail → Brivo panel → "Resend welcome email" button
2. skateOS fires the rose-themed how-it-works email

### Banning a customer
1. Customer detail → red "Ban" button at the bottom
2. Type reason → confirm
3. **What happens automatically:**
   - Customer's tags gets `banned`
   - Trigger flags for Brivo sync
   - Within 5 min, Brivo credential auto-revokes (removed from active-members group)
   - Their phone tap at the door will return `access_denied`
   - Owner sees their card flip to `🔴 REVOKED` with reason "banned"

---

## 3. Daily operations: members

### A new member's first 24 hours
1. They sign up at `skateos.com/2ntr` → click "Become a member" → fill the form at `/admin/join.html`
2. (Optional today, automatic later): cashier rings up their membership → payment → auto-provision
3. Within 5 minutes they receive:
   - Brivo Mobile Pass invite email (from Brivo, generic)
   - skateOS welcome email "🔓 You're in" (rose-themed, sets after-hours etiquette)
4. They install the Brivo Mobile app on their phone → accept the pass
5. They walk to the park door → tap their phone → door clicks open
6. skateOS auto-creates a `checkins` row for them (Front desk sees them in the "in the park" list)

### Member self-serve (`me.html`)
1. Customer goes to `app.skateos.com/admin/me.html`
2. Enters email → gets a magic-link email
3. Clicks link → sees their portal:
   - Active passes + punches remaining
   - Loyalty points + tier
   - Recent purchases
   - Upcoming lessons (with Add-to-Calendar buttons)
   - Achievements/badges
   - "📥 Download receipts CSV" for tax/reimbursement
   - "✏️ Edit my profile" — update email/phone/guardian
   - "Pause membership" / "Cancel" (self-serve)

### Phone dead at the door
1. Press the intercom button on the BDS reader
2. Front desk gets a buzz during staffed hours → buzzes them in
3. Outside staffed hours, their phone is the only way in (note this is intentional)

---

## 4. Birthday parties + event passes

### Quoting + booking a party
1. Admin → Tools → "Party Quote" (opens `admin/tools/party-quote.html`)
2. Fill: parent name + phone + email + skater name + DOB + party date+time + package (1.5hr / 2hr / 2.5hr) + add-ons
3. Quote shows total + 50% deposit
4. Submit → creates:
   - Customer record (with `birthday-party` tag)
   - Lesson row (type: `birthday`)
   - Invoice for the 50% deposit
5. Click "Send deposit payment link" → Helcim hosted payment URL → text/email to parent

### When the parent pays the deposit
- Helcim webhook fires → flips invoice to `paid`
- **NEW: helcim-webhook auto-fires `brivo-issue-event-pass`** for the party window (scheduled_at − 30 min to scheduled_at + duration + 30 min buffer)
- Customer gets Brivo Mobile Pass for the party time window only
- Door auto-revokes after the party ends (cron sweeps every 5 min)
- Parent can walk in early to set up + leave late to clean up — buffer covers it

### Manual event pass (industry comp / press visit / etc.)
1. Customer detail → Brivo panel → "🎟️ Issue event pass" button (owner-only)
2. Set window (default: next Saturday 2pm–6pm) + reason
3. Save → pass appears in the Brivo panel as 🟢 LIVE NOW or ⏰ SCHEDULED
4. Customer gets Brivo Mobile Pass for that window

### Revoking an event pass early
1. Customer detail → Brivo panel → find the pass row → click "Revoke"
2. Confirms → pass flips to `revoked` → customer's Brivo access removed within 5 min (or instant via "Sync now")

---

## 5. Emergency procedures

### Active incident (serious injury / fight / fire / intruder)
1. Settings → Integrations → "🚨 Emergency lockdown" card
2. Click "🔒 ENGAGE LOCKDOWN"
3. Type a reason ("active medical emergency" / "altercation at front desk")
4. Type "LOCKDOWN" to confirm
5. **What happens:**
   - Every member's Brivo credential is removed from the active-members group in <30 seconds
   - Their next phone tap at the door returns `access_denied`
   - A sticky red banner appears across every admin page showing reason + actor + revoke count
   - Customer detail → every customer's Brivo state shows `🟠 SUSPENDED`

### Ending lockdown
1. Click "End lockdown · restore member access" (in the sticky banner OR Settings card)
2. Every customer with a Brivo credential is re-flagged for sync
3. Within 5 minutes, the cron re-evaluates each (eligible members get restored automatically; lapsed/banned stay revoked)

### Suspected tailgater
1. You'll get a Team Chat reminder when 3+ person events at the park door happen without matching Brivo grants
2. Investigate: Activity Log → Brivo events → filter by "Access denied" → see who's been trying
3. Check Dashboard → Park vision widget → "Latest detections" — should show the person events with snapshot links
4. If it's a known customer trying with an old/lapsed credential, they need to renew their membership
5. If it's unknown, consider raising the door capacity threshold OR adding a guest-pass workflow

### Park-at-capacity warning
- When a Brivo grant fires while you're at `settings.maxCapacity`, a Team Chat reminder posts
- Front desk should ask new arrivals to wait, or comp them a day pass for a slower time
- Idempotent per hour — won't spam during sustained busy periods

---

## 6. Marketing + customer signup

### The public sites you have live
- **`skateos.com`** — main marketing landing for skateOS the product
- **`skateos.com/2ntr`** — 2nd Nature's public landing (hours / plans / sign up / map)
- **`skateos.com/sales`** — skateOS sales kit aimed at OTHER skatepark operators (pricing / comparison / demo CTA)
- **`app.skateos.com/admin/join.html`** — customer signup form
- **`app.skateos.com/admin/booking.html?form=<slug>`** — generic booking form renderer (lessons / events / parties)
- **`app.skateos.com/admin/park-status.html`** — public "Are we open?" page
- **`app.skateos.com/admin/me.html`** — customer self-serve portal

### Customer signup flow
1. Customer visits `skateos.com/2ntr`
2. Clicks "Become a member" → arrives at `/admin/join.html`
3. Fills the form (DOB auto-triggers guardian section if minor, plan picker chips)
4. Submits → row lands in `form_submissions` with form slug `member-signup`
5. Owner sees it in admin → Forms page → can convert to a real customer + ring up membership at POS

### Deploying updates to the public sites
```bash
cd ~/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark/marketing
netlify deploy --prod --dir . --site 2c6535a3-70a5-47fd-91e2-f875306aee01
```
This deploys both `/2ntr` and `/sales` subpaths along with the root.

---

## 7. White-label: onboarding a second park

When the second skatepark signs up for skateOS:

### Step 1: provision them in Supabase
1. Create their `tenant` row + `user_tenants` row for their owner email
2. Their admin login lands on `app.skateos.com` with a clean Dashboard

### Step 2: their owner configures their Brivo
1. Settings → Integrations → "Brivo per-tenant credentials" card
2. Click "Save credentials" → modal opens
3. They paste their own Brivo OAuth client_id, client_secret, api_key, account_id
4. Paste their Brivo dashboard config IDs (active members group, park door AP, shop door AP, hours schedule)
5. Generate + paste a webhook secret (`openssl rand -hex 32`)
6. Save → modal closes
7. Click "Test credentials" → verifies OAuth + a real API call → stamps `last_verified_at`

### Step 3: per-tenant webhook URL
1. Settings card shows a "🔗 PER-TENANT WEBHOOK URL" block with their tenant UUID baked in
2. They copy that URL → paste into THEIR Brivo dashboard → API Management → Webhooks
3. From now on, Brivo posts route directly to their tenant's webhook secret for signature verification

### Step 4: rest of integrations
1. Helcim (their account, their API token) — Settings → Integrations → Helcim card
2. Smartwaiver (their API key) — Settings → Integrations → Smartwaiver
3. Resend (their sending domain) — Settings → Integrations → Email
4. Twilio (their phone number) — Settings → Integrations → SMS
5. Optional: skateOS Vision Box (Phase 9 — needs hardware shipping)

### Step 5: park hours + branding
1. Settings → Park Hours → set their open/close per day
2. Settings → Business → their park name, phone, address, logo URL, theme color

### Step 6: verify
1. Dashboard → Setup Status card → progress bar should be 100%
2. They invite a test member → see Brivo invite fire → walk to door → unlock

**2nd Nature's env-var setup keeps working unchanged.** Each park is fully isolated: their lockdown affects only their group, their members provision against only their Brivo account, their door events route to only their webhook secret.

---

## 8. Reports + BI

### Most-used cards
- **Dashboard "Park access · last 8h"** — who's in the park right now via Brivo (cross-refs open checkins with door grants)
- **Dashboard "Performance"** — today vs prior day hourly revenue chart
- **Reports → "Brivo door activity"** — 30-day daily grants/denials + face match adoption % + DOW × hour heatmap
- **Reports → "Sales by hour heatmap"** — staffing pattern
- **Reports → "Lesson cancellation rate trend"** — instructor reliability signal
- **Reports → "Customer health score"** — A-F grade per customer (visit cadence / reliability / loyalty / spend / tenure)
- **Reports → "At-risk customer queue"** — C/D/F-grade customers ranked by lifetime spend, one-click re-engage button
- **Reports → "Top customers leaderboard"** — top 20 by lifetime spend (Pareto callout when applicable)
- **Reports → "Cohort retention heatmap"** — monthly signup cohorts × month-elapsed
- **Reports → "12-month GMV trend with YoY"** — long-term growth view

### Daily owner email
Every morning at 8am ET, the `daily-digest` Edge Function emails Doug:
- Yesterday's revenue + sales count
- Yesterday's tips + tip pool by staff
- Today's lessons + active mobile runs
- Open severe incidents + low-punch members + expiring memberships
- Gift card liability snapshot
- Auto-pilot count (lesson followups + renewal reminders + overdue rentals fired yesterday)
- Overdue rentals callout

Pause/un-pause via `OWNER_EMAIL` Supabase secret.

---

## 9. Vision Box (when hardware lands)

### What you'll buy
- Raspberry Pi 5 (8GB) — ~$75
- Google Coral USB Accelerator — ~$60
- Active-cooling Pi case — ~$30
- microSD card 64GB U3 — ~$20
- 2-4 IP cameras (RTSP-capable) — ~$40-60 each
- PoE switch or PoE injectors if your cameras are PoE

Total: ~$300-500 per park.

### Hardware setup
1. Flash Raspberry Pi OS Lite (64-bit) to SD card
2. Install Docker + Docker Compose
3. Run Frigate Docker container with the Coral USB Accelerator passed through
4. Configure cameras in Frigate's `config.yml` (RTSP URLs + zones + detection labels)
5. Configure the event webhook in Frigate config:
   ```yaml
   events:
     webhook:
       url: https://zecurmlenxyxanqucrga.supabase.co/functions/v1/frigate-webhook
       headers:
         x-frigate-secret: <secret-from-supabase-secrets>
   ```

### skateOS side
1. Settings → Integrations → "skateOS Vision Box (Frigate)" card
2. Click "Add camera" for each one
3. `camera_key` must match the camera id in Frigate's `config.yml` exactly
4. `location_label` drives behavior — set the BDS-overlook camera to `park_door` (drives Brivo cross-ref + tailgater detection)

### What you'll see
- **Dashboard "Park vision · last 60 min"** card with live people/car counts + latest detections + tailgater warnings
- Activity Log → Brivo door events column gets the cross-ref info attached
- Customer detail → "📹 Vision Box detections" section under the Brivo panel
- Events CSV export from the Vision Box admin card

See `VISION.md` for full Frigate config templates + the planned SD-card-image script.

---

## 10. Troubleshooting cheat-sheet

| Symptom | Likely cause | Fix |
|---|---|---|
| Door won't open for a member | Lapsed membership / waiver expired / banned | Customer detail → Brivo panel shows the reason. Fix root cause, click "Sync now" |
| Brivo invite never arrived | No email on file / email opt-out / Brivo not deployed | Customer detail → Brivo panel → "Resend mobile pass" |
| Welcome email never arrived | Resend disabled / customer opted out / template disabled | Settings → Integrations → Brivo welcome email card → check toggle. Customer detail → "Send welcome email" |
| Activity Log → Brivo events is empty | Webhook not reaching skateOS / signature mismatch | Activity Log → Webhook log card → look for `brivo` + `signature_mismatch` rows. Verify `BRIVO_WEBHOOK_SECRET` matches Brivo's config |
| Dashboard "Park access" widget never appears | No grants in last 8h OR Brivo disabled in Settings | Brivo enabled toggle + verify at least one member tap |
| Vision Box widget never appears | No vision events yet OR mig 068 not applied | Both expected pre-hardware. After hardware: check `frigate_cameras` rows exist + Frigate webhook fires |
| Sync stuck — customer in pending forever | Brivo invite send failed | Customer detail → "Sync now". If still pending, check Webhook log → brivo-sync source for errors |
| Capacity alert spamming Team Chat | `settings.maxCapacity` set too low | Settings → Business → update threshold. Alert is idempotent per hour |
| Lockdown won't release | Cron not running OR Brivo API rate-limit | After clicking "End lockdown", verify Webhook log shows `brivo-lockdown source=release`. Force per-customer sync via customer detail → "Sync now" |
| Door grant happens but no auto-checkin | `BRIVO_AUTO_CHECKIN_ENABLED=false` set OR customer already in park | Default is ON. Check Supabase secrets. Open checkins row prevents duplicate auto-checkin |
| New tenant's webhook fails signature | Tenant URL not configured / webhook_secret missing | Verify Settings → Brivo per-tenant credentials → Webhook secret is set + the per-tenant URL is in Brivo dashboard |

### When stuck, the audit trails
- **`webhook_log`** (Activity Log card) — every inbound webhook (Brivo, Helcim, Smartwaiver, Frigate) with status + raw payload
- **`audit_log`** (Activity Log card) — every staff INSERT/UPDATE/DELETE on watched tables, with diff
- **`brivo_access_log`** (Activity Log → Brivo events card) — every door event Brivo posted
- **`team_messages`** kind='reminder' with markers like `[brivo-failed-access:...]` or `[brivo-capacity-overflow]` — automated alerts
- **`customers.brivo_sync_error`** — last error on a per-customer sync attempt

---

## Quick-reference URLs

| URL | Purpose |
|---|---|
| `https://app.skateos.com` | Admin SPA (you + staff) |
| `https://skateos.com` | Marketing root |
| `https://skateos.com/2ntr` | 2nd Nature public landing |
| `https://skateos.com/sales` | skateOS sales kit (for other operators) |
| `https://app.skateos.com/admin/join.html` | Member signup |
| `https://app.skateos.com/admin/me.html` | Customer self-serve portal |
| `https://app.skateos.com/admin/park-status.html` | Public "Are we open?" |
| `https://app.skateos.com/admin/booking.html?form=lesson-request` | Lesson booking form |
| `https://account.brivo.com` | Brivo dashboard |
| `https://supabase.com/dashboard/project/zecurmlenxyxanqucrga` | Supabase dashboard |

---

## When you need help

1. Read this doc first
2. Read `BRIVO.md` for door-specific runbook + troubleshooting flowchart
3. Read `VISION.md` for camera/vision specifics
4. Read `CLAUDE.md` session logs for the full story of what we built + why
5. Run admin → Setup Status — progress bar tells you what's not configured
6. Activity Log → Webhook log → filter by error status to see recent failures

— Built between 2026-05-15 and 2026-05-16 with Doug + Nick at 2nd Nature Park.
