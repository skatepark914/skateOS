// ============================================================
// Weekly Backup Edge Function
// ----------
// Runs on a cron (Supabase → Database → Cron) every Sunday at 03:00 UTC.
// Dumps every table in `public` as JSON and uploads to two off-site
// buckets: AWS S3 (primary) and Backblaze B2 (secondary).
//
// Why two providers: an incident at AWS shouldn't lose us our only
// backup. Two providers = independent blast radius.
//
// Env vars required (set in Supabase dashboard → Edge Functions → Secrets,
// OR via `bash admin/setup-backup.sh`):
//   SUPABASE_URL              (auto)
//   SUPABASE_SERVICE_ROLE_KEY (auto — service role key for reading ALL data
//                              past RLS; never leaves this function)
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
//   AWS_REGION                (e.g. us-west-2)
//   AWS_S3_BUCKET             (e.g. 2ntr-backups-primary)
//   B2_ACCESS_KEY_ID          (B2 app key id)
//   B2_SECRET_ACCESS_KEY      (B2 app key)
//   B2_REGION                 (e.g. us-west-004)
//   B2_ENDPOINT               (e.g. https://s3.us-west-004.backblazeb2.com)
//   B2_BUCKET                 (e.g. 2ntr-backups-secondary)
//
// All AWS_*/B2_* vars are optional — function uploads only to whichever
// provider has its credentials set. With neither set, the function returns
// the dumped JSON in the response (still a backup, just not off-site).
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, PutObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3';

// Tables to back up (in dependency order for potential restore).
// Schema can be recreated from migrations/001_init.sql; we only back up data.
const TABLES = [
  'staff', 'categories', 'products', 'inventory_log', 'serial_numbers',
  'customers', 'subscriptions', 'checkins', 'lessons',
  'sales', 'sale_items',
  'invoices', 'invoice_items',
  'orders', 'order_items',
  'audit_log'
];

Deno.serve(async (_req) => {
  const started = Date.now();
  const date = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  const key = `backups/${date}/2ntr-full-${date}.json.gz`;

  // 1. Supabase service-role client (bypasses RLS to read everything).
  // Note: Supabase auto-injects SUPABASE_SERVICE_ROLE_KEY (not the legacy
  // shorter `SUPABASE_SERVICE_ROLE` name).
  const supabaseUrl  = Deno.env.get('SUPABASE_URL');
  const serviceRole  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) {
    return new Response(
      JSON.stringify({ ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
  const supabase = createClient(supabaseUrl, serviceRole);

  // 2. Dump every table to a single JSON blob
  const dump: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    let offset = 0;
    const pageSize = 1000;
    dump[table] = [];
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .range(offset, offset + pageSize - 1);
      if (error) {
        console.error(`Error dumping ${table}:`, error);
        return new Response(JSON.stringify({ ok: false, table, error: error.message }), { status: 500 });
      }
      if (!data || data.length === 0) break;
      (dump[table] as unknown[]).push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceProject: Deno.env.get('SUPABASE_URL'),
    tableCount: TABLES.length,
    totalRows: Object.values(dump).reduce((n, rows) => n + (rows as unknown[]).length, 0),
    tables: Object.fromEntries(TABLES.map((t) => [t, (dump[t] as unknown[]).length])),
  };

  const payload = JSON.stringify({ manifest, data: dump });
  const compressed = await gzip(new TextEncoder().encode(payload));

  // 3. Upload to AWS S3 — only if all required env vars set.
  const awsConfigured = !!(Deno.env.get('AWS_ACCESS_KEY_ID') && Deno.env.get('AWS_SECRET_ACCESS_KEY')
                            && Deno.env.get('AWS_REGION') && Deno.env.get('AWS_S3_BUCKET'));
  const awsResult = awsConfigured
    ? await uploadS3({
        accessKeyId:     Deno.env.get('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY')!,
        region:          Deno.env.get('AWS_REGION')!,
        bucket:          Deno.env.get('AWS_S3_BUCKET')!,
        endpoint:        undefined,  // default AWS
        key,
        body: compressed,
      })
    : { ok: false, skipped: true, reason: 'AWS_* env vars not set' };

  // 4. Upload to Backblaze B2 (S3-compatible endpoint) — only if all required env vars set.
  const b2Configured = !!(Deno.env.get('B2_ACCESS_KEY_ID') && Deno.env.get('B2_SECRET_ACCESS_KEY')
                           && Deno.env.get('B2_REGION') && Deno.env.get('B2_BUCKET') && Deno.env.get('B2_ENDPOINT'));
  const b2Result = b2Configured
    ? await uploadS3({
        accessKeyId:     Deno.env.get('B2_ACCESS_KEY_ID')!,
        secretAccessKey: Deno.env.get('B2_SECRET_ACCESS_KEY')!,
        region:          Deno.env.get('B2_REGION')!,
        bucket:          Deno.env.get('B2_BUCKET')!,
        endpoint:        Deno.env.get('B2_ENDPOINT'),
        key,
        body: compressed,
      })
    : { ok: false, skipped: true, reason: 'B2_* env vars not set' };

  // 5. Always-on: upload to Supabase Storage `backups` bucket. Free,
  // in-house, doesn't require any external creds. Bucket is private —
  // only owner-role users + this service-role function can read.
  let storageResult: { ok: boolean; bucket?: string; key?: string; error?: string };
  try {
    const { error } = await supabase.storage
      .from('backups')
      .upload(key, compressed, {
        contentType: 'application/json',
        upsert: true,
      });
    if (error) throw error;
    storageResult = { ok: true, bucket: 'backups', key };
  } catch (e) {
    storageResult = { ok: false, bucket: 'backups', error: (e as Error).message };
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  // Backup is "ok" if at least ONE destination succeeded.
  const anyOk = storageResult.ok || awsResult.ok || b2Result.ok;

  return new Response(
    JSON.stringify({
      ok: anyOk,
      elapsedSec: elapsed,
      key,
      sizeBytes: compressed.byteLength,
      manifest,
      storage: storageResult,
      aws: awsResult,
      b2: b2Result,
    }, null, 2),
    { headers: { 'content-type': 'application/json' } }
  );
});

async function uploadS3(opts: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  endpoint?: string;
  key: string;
  body: Uint8Array;
}) {
  try {
    const client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      forcePathStyle: !!opts.endpoint,  // B2 needs path-style
    });
    await client.send(new PutObjectCommand({
      Bucket: opts.bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: 'application/json',
      ContentEncoding: 'gzip',
    }));
    return { ok: true, bucket: opts.bucket, key: opts.key };
  } catch (e) {
    console.error(`S3 upload error (${opts.bucket}):`, e);
    return { ok: false, bucket: opts.bucket, error: (e as Error).message };
  }
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
