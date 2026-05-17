# weekly-backup Edge Function

Dumps all production tables as JSON and uploads a gzipped copy to **AWS S3** (primary) and **Backblaze B2** (secondary) every Sunday at 03:00 UTC.

## One-time setup

### 1. Create off-site buckets

**AWS S3** (primary):
- Create an AWS account under `info@2ntr.com` if one doesn't exist
- Create a bucket named `2ntr-backups-primary` in `us-west-2`
- Block all public access (default)
- Enable versioning (so deletes are recoverable)
- Create an IAM user `2ntr-backup-writer` with a policy limited to `s3:PutObject` on that bucket only
- Generate an access key pair for that user

**Backblaze B2** (secondary):
- Sign up at backblaze.com (separate account from AWS — that's the point)
- Create a bucket named `2ntr-backups-secondary` (private)
- Create an Application Key scoped to that bucket only
- Note the endpoint URL (e.g. `https://s3.us-west-004.backblazeb2.com`)

### 2. Add secrets to Supabase

Dashboard → Project Settings → Edge Functions → **Secrets**:

```
AWS_ACCESS_KEY_ID       = AKIA...
AWS_SECRET_ACCESS_KEY   = ...
AWS_REGION              = us-west-2
AWS_S3_BUCKET           = 2ntr-backups-primary

B2_ACCESS_KEY_ID        = ...
B2_SECRET_ACCESS_KEY    = ...
B2_REGION               = us-west-004
B2_ENDPOINT             = https://s3.us-west-004.backblazeb2.com
B2_BUCKET               = 2ntr-backups-secondary
```

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE` automatically to Edge Functions.

### 3. Deploy the function

From the project root:

```bash
npx supabase functions deploy weekly-backup
```

(Requires the Supabase CLI. Install with `brew install supabase/tap/supabase`.)

### 4. Schedule it

Dashboard → Database → **Cron Jobs** → New Job:

- **Name**: `weekly-backup`
- **Schedule**: `0 3 * * 0` (Sundays 03:00 UTC)
- **Command** (SQL):
  ```sql
  SELECT net.http_post(
    url := 'https://rkvznnrvowshnijwmufj.supabase.co/functions/v1/weekly-backup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    )
  );
  ```

Alternative: run it manually any time by hitting the function URL with a curl + service role bearer token.

## Restore from a backup

1. Download the most recent `.json.gz` from either S3 or B2
2. `gunzip` it
3. Parse the JSON — it's `{manifest, data: {table: [rows...]}}`
4. For each table, POST the rows back via PostgREST (or use `psql` with a generated `INSERT` script)

Full restore instructions are in `/RUNBOOK.md` at the project root.

## Retention

- **S3**: keep 90 days via lifecycle rule (delete after 90 days). Cost: ~$1/month.
- **B2**: keep 1 year (same cost class as S3 but cheaper long-term). Cost: ~$0.50/month.

## Drill schedule

Do a full restore drill **once a quarter**. Restore to a throwaway Supabase project, compare row counts, spot-check a few rows. Backups you've never restored aren't backups — they're rumors.
