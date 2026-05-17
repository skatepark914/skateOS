// ============================================================
// backup-cleanup — Supabase Edge Function (Deno)
//
// Deletes objects in the private `backups` bucket older than
// MAX_AGE_DAYS (default 90). Runs via pg_cron weekly, after
// the Sunday-night backup. Keeps Supabase Storage usage flat.
//
// Override retention by setting BACKUP_MAX_AGE_DAYS secret.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEFAULT_MAX_AGE_DAYS = 90;

Deno.serve(async () => {
  const supabaseUrl  = Deno.env.get('SUPABASE_URL');
  const serviceRole  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) {
    return new Response(
      JSON.stringify({ ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const maxAgeDays = Number(Deno.env.get('BACKUP_MAX_AGE_DAYS') || DEFAULT_MAX_AGE_DAYS);
  const cutoff     = new Date(Date.now() - maxAgeDays * 86_400_000);
  const supabase   = createClient(supabaseUrl, serviceRole);

  // List everything in the bucket. Storage API caps each list at 100, but
  // we only expect ~52 objects/year so a few pages is plenty.
  let toDelete: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from('backups')
      .list('', { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      return new Response(
        JSON.stringify({ ok: false, error: error.message, stage: 'list' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }
    if (!data || data.length === 0) break;

    for (const obj of data) {
      // The bucket layout from weekly-backup is `backups/YYYY-MM-DD/...` —
      // the .list() call returns one entry PER folder OR file at the prefix.
      // Need to recurse into date-named folders.
      if (obj.name && obj.name.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const folderDate = new Date(obj.name + 'T00:00:00Z');
        if (folderDate < cutoff) {
          // List inside the folder + queue all files for delete
          const inner = await supabase.storage
            .from('backups')
            .list(obj.name, { limit: 100 });
          for (const f of inner.data ?? []) {
            toDelete.push(`${obj.name}/${f.name}`);
          }
        }
      } else if (obj.created_at) {
        // Top-level file — uncommon shape, but supported.
        const created = new Date(obj.created_at);
        if (created < cutoff) toDelete.push(obj.name);
      }
    }
    if (data.length < 100) break;
    offset += 100;
  }

  if (toDelete.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, deleted: 0, cutoff: cutoff.toISOString(), maxAgeDays }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  const { error: delErr } = await supabase.storage.from('backups').remove(toDelete);
  if (delErr) {
    return new Response(
      JSON.stringify({ ok: false, error: delErr.message, attempted: toDelete.length }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, deleted: toDelete.length, cutoff: cutoff.toISOString(), maxAgeDays, paths: toDelete }),
    { headers: { 'content-type': 'application/json' } },
  );
});
