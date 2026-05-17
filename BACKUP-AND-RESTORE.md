# Backup & Restore Runbook

Last verified: 2026-04-29 (real backup landed in Supabase Storage)

## Current state

- ✅ **`weekly-backup` Edge Function deployed** to skateos-2ntr.
- ✅ **Cron job scheduled** — `pg_cron` job `weekly-backup` runs every **Sunday 03:00 UTC**.
- ✅ **Supabase Storage `backups` bucket exists** (private, 500 MB cap per file).
- ✅ **First backup written** — 13.5 KB gz, 16 tables, 212 rows. Path: `backups/YYYY-MM-DD/2ntr-full-YYYY-MM-DD.json.gz`.
- 🟡 **AWS S3 / Backblaze B2 — not yet configured.** Single-provider risk: if Supabase has an outage, the backup is unreachable.

## Trigger a backup right now

```bash
cd ~/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark
bash admin/setup-backup.sh test
```

Or directly:

```bash
curl -X POST "https://zecurmlenxyxanqucrga.supabase.co/functions/v1/weekly-backup" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json"
```

(Anon key is in `admin/config.js` if you need it.)

You'll get back JSON with:
- `manifest.totalRows` — sanity check that tables aren't empty
- `storage.ok` — `true` if Supabase Storage upload succeeded
- `aws.ok` / `b2.ok` — `true` if those providers were configured AND succeeded

## Add off-site redundancy (recommended)

```bash
bash admin/setup-backup.sh aws    # AWS S3 only
bash admin/setup-backup.sh b2     # Backblaze B2 only
bash admin/setup-backup.sh both   # both
```

The script prompts for keys/region/bucket and pushes them as Supabase secrets. After that the next backup writes to all configured destinations.

**Cost expectations:**
- Supabase Storage: free up to 1 GB. At our current 13.5 KB/week, that's 75,000 weeks of headroom.
- AWS S3: ~$0.023/GB/month. Negligible.
- Backblaze B2: ~$6/TB/month, first 10 GB free.

## See what backups exist

```bash
bash admin/setup-backup.sh status
```

Prints the most recent 20 backup objects from Supabase Storage with size + date.

Or via the Supabase dashboard: https://supabase.com/dashboard/project/zecurmlenxyxanqucrga/storage/buckets/backups

## Restore from a backup

⚠️ **Untested in production. Walk through this once on a fresh project before relying on it.**

### 1. Download the backup file

```bash
# Get the most recent backup name
psql "$DB_URL" -c "SELECT name FROM storage.objects WHERE bucket_id='backups' ORDER BY created_at DESC LIMIT 1;"

# Download via the Storage API
curl -o /tmp/backup.json.gz \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  "https://zecurmlenxyxanqucrga.supabase.co/storage/v1/object/backups/<NAME>"

# Decompress
gunzip /tmp/backup.json.gz
```

The decompressed file is a single JSON document with shape:

```json
{
  "manifest": { "generatedAt": "...", "tables": { "customers": 8, ... } },
  "data": {
    "customers": [...],
    "products": [...],
    ...
  }
}
```

### 2. (Optional) Restore to a NEW Supabase project for testing

Don't restore over your live data without practicing first.

```bash
# Create a fresh project, run migrations
bash admin/migrations/run.sh

# Then for each table, INSERT the rows from the backup. Quick path with jq + psql:
jq -r '.data.customers | .[] | @json' /tmp/backup.json | while read row; do
  psql "$NEW_DB_URL" -c "INSERT INTO customers SELECT * FROM jsonb_populate_record(NULL::customers, '$row'::jsonb);"
done
```

For a real disaster, restore tables in this order to satisfy FKs:
1. `staff`, `categories`, `products`
2. `customers`
3. `subscriptions`, `lessons`, `serial_numbers`, `inventory_log`
4. `sales`, then `sale_items`
5. `invoices`, then `invoice_items`
6. `orders`, then `order_items`
7. `checkins`, `audit_log`

Auto-numbered fields (receipt_number, invoice_number, etc.) come from sequences — those don't restore from the JSON automatically. After restore, bump the sequences:

```sql
SELECT setval('sales_receipt_number_seq', (SELECT MAX(...) FROM sales));
```

### 3. Cron management

The cron job is named `weekly-backup`. To inspect or change:

```sql
-- See it
SELECT * FROM cron.job WHERE jobname = 'weekly-backup';

-- See past runs
SELECT * FROM cron.job_run_details WHERE jobname = 'weekly-backup' ORDER BY start_time DESC LIMIT 10;

-- Pause it
UPDATE cron.job SET active = false WHERE jobname = 'weekly-backup';

-- Resume
UPDATE cron.job SET active = true WHERE jobname = 'weekly-backup';

-- Reschedule (e.g. daily instead of weekly)
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'weekly-backup'), schedule := '0 3 * * *');
```

## Known limitations / risks

- **Auth users (the `auth.users` table)** are NOT in the backup. Supabase manages them separately. If your project is deleted, auth users die with it. To preserve: keep your migration script `admin/setup-owner.sh` ready, plus a list of staff emails to re-invite.
- **Storage bucket contents** (waiver PDFs, uploaded files) are NOT in the backup. If we start using Supabase Storage for customer-uploaded files, this needs a second backup loop.
- **Supabase Edge Function secrets** (`SMARTWAIVER_API_KEY`, `AWS_*`, etc.) are NOT in the backup. They're set via the CLI; a project-loss event needs them re-set manually.
- **Sequences and triggers** are recreated by running the migrations, but their CURRENT state (last-used sequence values) is not in the backup. After restore, run `SELECT setval(...)` for each auto-incrementing column.
- **Restore has never actually been performed end-to-end.** Schedule a quarterly DR drill: restore the latest backup to a scratch project, smoke-test the admin against it.

## What still needs to happen (Doug)

1. ⏳ **Run a DR drill** end-to-end. Restore yesterday's backup to a fresh project. Make sure it works. Block your calendar for 2 hr.
2. ⏳ **Add AWS or B2** for redundancy. `bash admin/setup-backup.sh aws`. Cost: pennies.
3. ⏳ **Verify the cron actually fires** next Sunday morning — check `cron.job_run_details` Monday.
4. ⏳ **Decide on retention** — backups currently accumulate forever. After ~6 months, add a cleanup that deletes objects older than X days (or moves them to colder storage).
