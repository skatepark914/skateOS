# 2nd Nature Skatepark — Operations Runbook

This is the "it's 2am and something is broken, what do I do" document. Read this once, keep it updated, know where it is.

**Project**: 2nd Nature Skatepark POS (replaces Square)
**Supabase project**: `rkvznnrvowshnijwmufj` — https://supabase.com/dashboard/project/rkvznnrvowshnijwmufj
**Owner**: Doug Brown — info@2ntr.com
**Source**: `/Users/dougbrown/Desktop/Claude/2ntr-skatepark/`
**Preview**: http://localhost:8097 (during development)

---

## Auth & access

### Roles
- **owner**: full access, including reports, refunds, settings, staff management, audit log
- **staff**: check people in, ring up sales, look up customers, adjust inventory. Cannot refund, void, delete, or see audit log.

Database (not UI) enforces this. Even if someone gets a staff login, they literally cannot delete a sale.

### Create a new staff user
1. Supabase dashboard → Authentication → Users → **Add user** → **Create new user**
2. Email = their work email. Strong password. "Auto Confirm User" ON.
3. Copy the new user's UUID
4. SQL Editor — run:
   ```sql
   INSERT INTO staff (id, email, display_name, role, active)
   VALUES ('<uuid>', 'email@example.com', 'Display Name', 'staff', true);
   ```
   (Change `staff` to `owner` only for people with full trust.)

### Deactivate a user (someone leaves)
```sql
UPDATE staff SET active = false WHERE email = 'leaver@example.com';
```
They're instantly locked out (RLS policies check `active = true`). No need to change anyone else's password. Their auth record stays around so the audit log keeps working.

### Reset someone's password
Dashboard → Authentication → Users → find user → "..." → **Send password reset email**.

### Rotate the Supabase anon/publishable key
(Do this if it's ever suspected leaked.)

1. Dashboard → Settings → API → **Rotate** the publishable key
2. Update `admin/config.js` with the new key
3. Redeploy to production
4. Old key stops working in about 60 seconds

Since the publishable key is public by design, rotation is mostly hygiene — RLS is the actual gate.

### 2FA on owner accounts
**Required** for owner role.

Supabase → Dashboard → Account → Security → Enable **TOTP** (use 1Password, Authy, or Google Authenticator). Save recovery codes.

---

## Backups

### Schedule
- **Daily**: Supabase-managed snapshots (Pro tier). 7-day retention on Pro, 7-day point-in-time recovery.
- **Weekly**: `weekly-backup` Edge Function dumps to AWS S3 + Backblaze B2 (see `supabase/functions/weekly-backup/README.md`).
- **Quarterly**: restore drill to a throwaway project.

### Restore from last 24 hours (Pro tier, point-in-time)
1. Dashboard → Database → Backups → **Restore**
2. Choose a timestamp within last 7 days, to the second
3. Restores into a new project — you then re-point `config.js` at it

### Restore from weekly backup (catastrophic failure — Supabase project gone)
1. Create a new Supabase project
2. Run `admin/migrations/001_init.sql` in SQL Editor (recreates schema + policies)
3. Download the most recent `2ntr-full-YYYY-MM-DD.json.gz` from S3 (or B2 if S3 is also broken)
4. `gunzip` it
5. Use the import script at `admin/tools/restore-from-backup.html` (TODO: build this) or write a quick Node script that reads `data[table]` and POSTs to PostgREST
6. Re-create auth users via Dashboard (they don't live in the table dump)
7. Update `admin/config.js` with the new project URL + anon key

### Can I just delete a backup?
Yes, but don't. S3 has versioning enabled so even delete is recoverable for 30 days.

---

## Payments (Helcim)

**Merchant account**: TBD (application in progress)
**Smart Terminal**: TBD (ordered after account approved)
**Primary contact at Helcim**: TBD

### Daily reconciliation (during soft launch)
End of each day:
1. Dashboard → Reports → Daily Totals
2. Helcim dashboard → Transactions → Today
3. Compare Helcim gross receipts to our `sales` total for today
4. Variance should be $0. If there's a gap, search `payment_id` in both systems.

### If Helcim is down
1. Post handwritten sign: "Card reader down — cash or check only"
2. Ring up sales in the admin with `payment_provider='cash'`
3. When Helcim comes back, DON'T retroactively change those sales to card — they're cash, leave them cash
4. Helcim's support: 1-888-HELCIM (check their docs for current number)

### Chargeback response
1. Email from Helcim landing in info@2ntr.com
2. You have 7 days to respond with evidence
3. Pull: receipt PDF, camera footage if in-park, customer's email confirmation, waiver signed at check-in
4. Upload via Helcim portal
5. If lost: it's covered by cyber insurance policy (assuming it's bound)

---

## Day-of outage scenarios

### The whole app is down
1. Check https://status.supabase.com — is it Supabase's fault?
2. Check https://status.cloudflare.com — is it the CDN?
3. If it's us: revert the last deploy. The app is static files — Cloudflare Pages keeps previous versions, you can roll back in 2 clicks.
4. Worst case: post handwritten "Cash/check only today" and run the park on paper. You can reconcile to the system after it's back up.

### Someone deleted a row by accident
1. Owner-only capability. If it happened, check `audit_log` for `action='DELETE'` and the row contents:
   ```sql
   SELECT * FROM audit_log
   WHERE action = 'DELETE' AND tbl = '<table>'
   ORDER BY at DESC LIMIT 10;
   ```
2. The `old_values` column has the full deleted row as JSON. Re-insert it if needed.

### Refunds
1. Owner-only (DB enforces this).
2. Dashboard → Sales → find the sale → **Refund** → reason → confirm
3. Updates `sales.status = 'refunded'` + `refunded_at` + `refund_reason`
4. Also triggers the matching Helcim refund via the API
5. Audit log records everything

---

## Waivers (Smartwaiver)

- Waivers live in Smartwaiver, NOT in our database. We only store the waiver ID.
- At check-in, the app calls Smartwaiver's API to confirm the skater has a signed waiver.
- API key is in the `smartwaiver-lookup` Edge Function (server-side only, never in browser).
- If Smartwaiver is down at the front desk, staff can fall back to asking to see the printed/emailed waiver confirmation.

---

## Cost ops

### Monthly costs to watch
- Supabase Pro: **$25** (fixed)
- AWS S3 storage: ~**$1–3** depending on data growth
- Backblaze B2: ~**$0.50–2**
- Resend email: usage-based, typically **$5–20**
- Twilio SMS: usage-based, typically **$10–30**
- Cyber insurance: **$40–100/mo**
- Helcim processing: variable (2% ish of card volume)

**Budget**: $110–180/mo baseline + processing fees. Compare monthly against Square savings (~$775/mo saved on processing alone).

### Cost-creep triggers
- Supabase approaching DB storage limit (8 GB on Pro): add `pg_cron` job to archive `audit_log` rows older than 2 years
- Twilio costs spike: probably a runaway automation — check the SMS queue
- S3 costs spike: orphaned uploads from failed Edge Function runs — clean up with a lifecycle rule

---

## Secrets inventory (where do they live?)

| Secret | Where it lives | Rotate schedule |
|---|---|---|
| Supabase publishable key | `admin/config.js` (browser-visible, OK by design) | Annually or if suspected leaked |
| Supabase service_role key | Edge Function secrets only | Annually; never put in any browser code |
| Supabase DB password | 1Password under `info@2ntr.com` vault | Only if needed for raw-SQL restore |
| Helcim API key | Edge Function secrets | Annually |
| Smartwaiver API key | Edge Function secrets | Annually |
| Resend API key | Edge Function secrets | Annually |
| Twilio API key | Edge Function secrets | Annually |
| AWS access key (backup writer) | Edge Function secrets | Annually; limited to S3 PutObject only |
| B2 app key | Edge Function secrets | Annually; limited to one bucket |
| Cloudflare API token | 1Password, for emergency DNS changes | Annually |
| Apple Developer account | 1Password under `info@2ntr.com` vault | Never (Apple tied to email) |

**Rotation checklist** (annually, first week of April):
1. Generate new keys
2. Update Edge Function secrets
3. Redeploy Edge Functions
4. Verify with a test call
5. Delete old keys

---

## Emergency contacts

- **Supabase support**: support@supabase.com (Pro tier gets priority)
- **Helcim support**: 1-888-HELCIM (US)
- **Cloudflare support**: via Cloudflare dashboard → Support
- **Cyber insurance breach hotline**: TBD — goes on the kitchen fridge once policy is bound
- **Lawyer** (for breach notification obligations under NY SHIELD Act): TBD

---

## Applying migrations (new install or catch-up)

Every `.sql` file in `admin/migrations/` is **idempotent + safe to re-run**, but they have to land in numeric order. Mig 046 has a prereq check that aborts if mig 009 isn't already applied, so out-of-order will fail loud (good).

### Quick batch — 006 through 044 (39 migrations)

These are the migrations shipped between 2026-04-29 and 2026-05-09. Apply them all before 046.

1. Supabase dashboard → SQL Editor → New query
2. For each file in `admin/migrations/00*.sql` and `0[1-4]*.sql` in **numeric order**:
   - Open the .sql file locally
   - Copy entire contents
   - Paste into SQL Editor
   - Click **Run** (or ⌘+Enter)
   - Wait for "Success. No rows returned" or similar green confirmation
   - If you see a red error, **STOP** — read the error, fix it, do not continue
3. Verify after the batch: `SELECT count(*) FROM pg_proc WHERE proname IN ('current_tenant_id','search_customers','merge_customers');` — should return 3.

**Pace**: ~30 minutes to copy/paste all 39 in one sitting. If you split it, do whole migrations — never half a file.

### Final migration — 046 (multi-tenant isolation gate)

⚠ This is the gate to onboarding a 2nd skatepark. Apply it AFTER 006–044.

```
admin/migrations/046_multi_tenant_part_b.sql
```

It does five things in one transaction:
1. Auto-fill `tenant_id` trigger on every business table (so app code doesn't have to change)
2. RESTRICTIVE RLS policies that require `tenant_id = current_tenant_id()` everywhere
3. Patches `audit_trigger` to copy tenant_id so audit isolation works
4. Refactors `app_settings` PK to composite `(tenant_id, key)` — this is the schema change that lets a 2nd tenant exist
5. Enhances `handle_new_user_skateos` to also create the `staff` row + seed `app_settings` on signup

**Verify after 046**:
```sql
-- Confirm 2ntr's data is still visible to info@2ntr.com
SELECT count(*) FROM customers;        -- should match pre-046 count
SELECT count(*) FROM products;         -- same
-- Confirm RLS is on
SELECT relname, relrowsecurity FROM pg_class
 WHERE relname IN ('customers','sales','lessons','app_settings');  -- relrowsecurity should be 't' for all
```

If 2ntr customer count drops to 0 after 046, RLS isn't matching. Most likely cause: `user_tenants` row missing for `info@2ntr.com`. Fix:
```sql
INSERT INTO user_tenants (user_id, tenant_id, role)
SELECT (SELECT id FROM auth.users WHERE email='info@2ntr.com'),
       (SELECT id FROM tenants WHERE owner_email='info@2ntr.com'),
       'owner'
ON CONFLICT DO NOTHING;
```

### Common failures

| Error | Cause | Fix |
|---|---|---|
| `relation "X" does not exist` | Skipped an earlier migration | Find the migration that creates X, run it, retry |
| `column "tenant_id" of relation "X" does not exist` | Mig 009 didn't run | Apply 009 first |
| `function current_tenant_id() does not exist` | Mig 009 didn't run | Apply 009 first |
| `duplicate key value violates unique constraint "app_settings_pkey"` (after 046) | An app_settings row from before 046 has tenant_id NULL | `UPDATE app_settings SET tenant_id = (SELECT id FROM tenants WHERE owner_email='info@2ntr.com') WHERE tenant_id IS NULL;` then re-run 046 |
| Edge Function calls returning 500 after 046 | Service role bypasses RLS, but cron functions may need `WHERE tenant_id = ?` clauses for multi-tenant. Single-tenant (just 2ntr) — works fine. | Cross this bridge when 2nd tenant signs up. |

---

## New tenant onboarding (after migrations are applied)

### Self-serve flow

1. Park owner goes to `https://app.skateos.com/signup.html`
2. Enters park name, owner email, password, optional phone/city
3. Submits → Supabase creates `auth.users` row → `handle_new_user_skateos` trigger fires server-side
4. Trigger creates: `tenants` row (status='beta'), `user_tenants` link (role='owner'), `staff` row (role='owner'), `app_settings` row with branding seeded from form
5. Owner gets confirmation email from Supabase
6. Clicks link → lands on `app.skateos.com/admin/index.html` → logs in → admin loads with their own (empty) data

### SMTP requirement (do this BEFORE inviting any park)

Supabase's built-in email sender is rate-limited to ~4 confirmations/hour and **WILL** fail in production. Wire SMTP first:

1. Verify a sending domain at resend.com (e.g., `skateos.com`)
2. Generate a Resend API key
3. Supabase dashboard → Authentication → Settings → SMTP Settings → **Enable Custom SMTP**:
   - Host: `smtp.resend.com`
   - Port: `465` (SSL)
   - Username: `resend`
   - Password: `<your Resend API key>`
   - Sender email: `signups@skateos.com` (must be on the verified domain)
   - Sender name: `SkateOS`
4. Save. Send yourself a test signup to confirm the email arrives.

Without this step, most signup attempts after the first 4/hour will fail silently from the user's perspective ("I never got the email").

### Manual provision (white-glove for VIP parks)

If self-serve signup fails or you want to onboard a park without them clicking a confirmation link:

1. Supabase dashboard → Authentication → Users → **Add user** → **Create new user**
   - Email: owner's email
   - Strong password
   - "Auto Confirm User" ON
2. The `handle_new_user_skateos` trigger fires automatically on insert → tenant/staff/settings provisioned
3. Hand the owner their email + password via secure channel (1Password share)
4. They log in at `app.skateos.com` and immediately have a working park

### Verifying a new tenant has working isolation

After signup, log in as the new owner and:
1. Confirm Customers / Sales / Products are all empty (no 2ntr leakage)
2. Add one test customer → log out → log in as `info@2ntr.com` → confirm that customer is invisible from 2ntr's side

If you see leakage either direction, RLS isn't doing its job. Check `user_tenants` for both accounts, confirm each row has the right `tenant_id` and `role='owner'`.

---

## Change history

- **2026-04-15** — Initial schema, auth, white-label pass, email templates, Smartwaiver stub, backup function written, this runbook — Doug + Claude
- **2026-05-11** — Multi-tenant Phase 2 shipped: migration 046 (strict RLS isolation, auto-fill trigger, app_settings composite PK, audit_trigger tenant scoping, enhanced signup trigger), self-serve signup page (`admin/signup.html`), signup link added to login screen, app_settings UPSERTs patched for composite PK. Runbook updated with migration apply order + SMTP requirement + new-tenant onboarding flow.
