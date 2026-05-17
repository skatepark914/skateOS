# skateOS Customer Onboarding Runbook

> **Doug + Jon only — operations doc.** This is how we actually onboard a new skateOS / Branch Manager customer end-to-end. Target: <2 hours from "yes" to "live admin login."

Two onboarding flavors. Use the matrix to pick the right path:

| Customer wants | Use flavor | Time |
|---|---|---|
| Free trial (30 days, then decide) | **A · Hosted** | ~1 hr |
| Hosted-paid (small operator, low tech, $8k + $299/mo) | **A · Hosted** | ~1 hr |
| Deploy-your-own ($15-25k one-time + retainer) | **B · Deploy** | ~3-5 wks (per public runbook) |

---

## A · Hosted onboarding (free trial or hosted-paid)

**Total time:** ~1 hour active work spread across 24 hours.

### Step 1 · Customer signs (5 min, async)

Customer replies to your `mailto:doug@2ntr.com` with subject `"skateOS — 30-day free trial"` or signs an engagement letter for hosted-paid.

Confirm in your reply: their business name, owner email, target launch date.

### Step 2 · Provision the tenant (10 min)

Open `admin/scripts/provision-tenant.sql`. Edit the variables at the bottom DO block:

```sql
v_business_name  TEXT := 'Acme Skatepark';
v_slug           TEXT := 'acme-skatepark';
v_owner_email    TEXT := 'owner@acmeskatepark.com';
v_business_phone TEXT := '(555) 123-4567';
v_business_addr  TEXT := '123 Main St, Anytown, NY 10000';
v_tax_rate       NUMERIC := 0.08375;
v_status         TEXT := 'beta';                    -- or 'active' for paid
v_industry       TEXT := 'skatepark';               -- or 'tree_care'
v_seed_data      BOOLEAN := true;
```

Paste the entire file into Supabase SQL editor → Run.

You'll see a `NOTICE` block confirming tenant ID + next steps.

### Step 3 · Invite the owner via Supabase Auth (2 min)

Supabase Dashboard → **Authentication** → **Users** → **Invite User**.

Email = the same `v_owner_email` you set in step 2. The trigger sees the matching email + already-existing tenant, so the new user gets linked as `owner` role automatically (no duplicate tenant created).

### Step 4 · Send the welcome email (5 min)

Manual email to the customer with:

- Link to `https://app.skateos.com/login` (or `app.theirdomain.com` if branded)
- Note: "Click the magic-link email Supabase just sent. Enter the code. You'll land on the admin dashboard."
- Calendar link for the 30-min setup call

### Step 5 · 30-min setup call (live screen-share)

Agenda:
- Walk through Settings → Business: confirm name, address, hours, tax rate
- Walk through Settings → Operations: tipPresets, calendar hours, etc.
- Show Settings → Tax & Receipts: receipt header/footer customization, logo upload
- If they have a Smartwaiver account: paste their API key in Settings → Integrations
- If they have Helcim: paste their token + run a $1 test charge
- Show them Check-In, POS, Members, Reports — the four screens they'll live in

After the call: they're live. You step back. Optional weekly check-in for the trial period.

### Step 6 · Day 25 of trial — convert or off-board (5 min)

Email them:
> *"Trial wraps in 5 days. Want to convert to hosted ($8k setup + $299/mo) or deploy-your-own ($15-25k one-time)? Or off-board? Either way no hard feelings."*

Convert: send the invoice, flip `tenants.status` to `active`.

Off-board: flip `tenants.status` to `archived`, export their data to CSV via the existing Settings → Data Export flow, send them the CSV, schedule tenant deletion in 14 days (per privacy policy).

---

## B · Deploy-your-own onboarding (paid engagement)

**Total time:** 3-5 weeks per the public runbook at `/deploy/`.

The customer-facing version of the steps is published at:
**https://consult.skateos.com/deploy/**

This is the internal version with the specific commands/SQL/checklist.

### Pre-engagement (sales)

- Discovery call, scope, fixed price ($15-25k skateOS / $20-35k Branch Manager)
- Engagement letter signed, 50% deposit invoiced + paid
- Schedule kickoff call (Day 1 of engagement)

### Day 1 — Account provisioning (90 min call)

Live screen-share. Customer creates accounts in their name on these vendors. You walk them through each setup:

| Vendor | Customer creates | URL |
|---|---|---|
| Supabase | Project (US-East region) | https://supabase.com |
| Cloudflare | Account + add domain | https://dash.cloudflare.com |
| GitHub | Org or personal repo for skateOS code | https://github.com |
| Resend | Account + verify sending domain (their domain) | https://resend.com |
| Twilio | Account + buy phone number | https://twilio.com |
| Helcim (skateOS) or Stripe Connect (Branch Manager) | Merchant account application | https://helcim.com / https://stripe.com |

Customer pays each vendor directly. You have temporary scoped access for setup only.

### Day 3-7 — Code + DB install (~6 hr async on your side)

1. **Clone codebase to their GitHub:**
   ```bash
   git clone https://github.com/2ndnature/skateOS.git
   cd skateOS
   git remote set-url origin https://github.com/[CUSTOMER-ORG]/skateOS-[customer-slug].git
   git push -u origin main
   ```

2. **Apply all migrations to their Supabase:**
   - Open `admin/migrations/_apply_all_006_to_061.sql`
   - Paste entire file into their Supabase SQL editor → Run (8,000+ lines, takes ~30s)
   - Verify with `\dt public.*` — should show ~60 tables

3. **Set Supabase secrets** (Customer Supabase Dashboard → Edge Functions → Secrets):
   ```
   RESEND_API_KEY=re_xxx
   HELCIM_API_TOKEN=helcim_pat_xxx
   HELCIM_WEBHOOK_VERIFIER_TOKEN=<openssl rand -hex 32>
   SMARTWAIVER_API_KEY=sw_xxx
   SMARTWAIVER_WEBHOOK_SECRET=<openssl rand -hex 32>
   TWILIO_ACCOUNT_SID=ACxxx
   TWILIO_AUTH_TOKEN=xxx
   TWILIO_FROM_NUMBER=+1xxx
   OWNER_EMAIL=owner@theirdomain.com
   ```

4. **Deploy Edge Functions** (use their Supabase service-role token):
   ```bash
   cd skateOS
   SUPABASE_ACCESS_TOKEN=<their-token> bash admin/deploy-functions.sh
   ```

5. **Apply pg_cron schedules** (in Supabase SQL editor on their project):
   - Edit migration 016 + 033 etc. to use THEIR Supabase URL + service-role key
   - Run `SELECT cron.schedule(...)` for each scheduled function

6. **Deploy admin SPA to their Cloudflare:**
   ```bash
   cd admin
   CLOUDFLARE_API_TOKEN=<their-token> npx wrangler deploy \
     --name skateos-[customer-slug] \
     --assets . \
     --compatibility-date 2025-01-01
   ```

7. **Wire DNS:**
   - In their Cloudflare dashboard: add CNAME `app.theirdomain.com` → the worker
   - SSL provisions automatically

### Day 8-14 — Provision tenant + brand (varies)

1. Run `admin/scripts/provision-tenant.sql` in their Supabase (this file)
2. Apply branding: colors, logo, business config via Settings page
3. Configure operational params: hours, tax rate, tip presets, etc.

### Day 15-21 — Data migration (1-3 days work, vertical-dependent)

Per the source system, see the public runbook for known patterns. Each is ~1-3 days of work depending on volume + cleanliness.

### Day 22-28 — Training + parallel run

Live 2-hour training session (record it). Daily check-ins during parallel-run week.

### Day 29-35 — Go-live + handoff

1. Cutover DNS, flip webhooks at payment processor
2. Customer cancels legacy SaaS subscription (you confirm)
3. **Revoke your access:**
   - Supabase: remove yourself from project
   - GitHub: remove yourself from repo
   - Cloudflare: remove yourself from account
4. Provide written attestation of access removal (email or doc)
5. 50% balance invoiced + paid
6. 30-day free post-delivery support begins

---

## Things you'll forget and need

### Reset a customer's password
Supabase Dashboard → Authentication → Users → search owner email → "Send magic link"

### Customer says POS won't load
Check `app_settings` for `key='all'` — if empty, provisioning didn't apply config. Re-run `provision_new_tenant()` with their existing email; it updates in place.

### Customer's data export
Admin SPA → Settings → Data Export. Generates CSVs for every business table. Download + email to them.

### Tenant slug taken / typo
```sql
UPDATE tenants SET slug = 'new-slug' WHERE id = '<tenant-uuid>';
```

### Off-board a customer (delete tenant + data)
```sql
-- 1. Export first (use admin Settings → Data Export)
-- 2. Confirm with customer in writing
-- 3. Then:
UPDATE tenants SET status = 'archived' WHERE id = '<tenant-uuid>';
-- 4. After 14-day grace period:
DELETE FROM tenants WHERE id = '<tenant-uuid>';
-- (CASCADE deletes all business data via FKs)
```

---

## Post-install verification

After applying migrations + deploying Edge Functions, run these two smoke tests to verify the install:

**1. Database smoke test** (paste in Supabase SQL editor):
```
admin/scripts/smoke-test.sql
```
Checks: ~30 expected tables, ~25 expected RPC functions, ~10 expected triggers, pg_cron schedules count, RLS enforcement. Prints a NOTICE summary at the bottom. Anything with `✗ MISSING` needs investigation before signing a customer.

**2. Edge Function probe** (run from project root):
```bash
bash admin/scripts/test-edge-functions.sh
```
Hits every Edge Function with a probe payload + reports HTTP status. Identifies which functions aren't deployed (404) vs. missing secrets (401/403) vs. wired correctly. Run with `--live` to fire a real test email + SMS.

## Files referenced

| Path | What |
|---|---|
| `admin/migrations/_apply_all_006_to_061.sql` | Full schema bundle for fresh Supabase |
| `admin/migrations/run.sh` | Apply migrations via psql (for our Supabase) |
| `admin/migrations/fresh.sh` | DESTRUCTIVE reset + migrate (pre-launch only) |
| `admin/scripts/provision-tenant.sql` | Tenant provisioning + starter data |
| `admin/scripts/smoke-test.sql` | Post-install database verification (read-only) |
| `admin/scripts/test-edge-functions.sh` | Edge Function deployment probe |
| `admin/scripts/ONBOARDING.md` | This file |
| `admin/deploy-functions.sh` | Deploy Edge Functions to Supabase |

---

_Last reviewed: 2026-05-11. Update when the migration sequence advances or the trigger logic changes._
