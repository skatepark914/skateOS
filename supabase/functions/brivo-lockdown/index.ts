// ============================================================
// brivo-lockdown — emergency mass revoke / restore
// ============================================================
// POST { action: "engage" | "release", reason?: string, actor_email?: string }
//
// engage:
//   - List every Brivo user in the active-members group
//   - Remove all of them from the group in parallel
//   - Stamp customers.brivo_credential_state = 'suspended' for everyone
//     who currently has brivo_user_id set
//   - Write app_settings.value.integrations.brivo.lockdown = {
//       active: true, reason, set_at, set_by_email
//     }
//   - Return { ok, removed, failed, group_size_before }
//
// release:
//   - Set app_settings.value.integrations.brivo.lockdown.active = false
//   - Flag every customer with brivo_user_id for re-sync (sets
//     brivo_sync_needed_at). The 5-min flagged-mode cron picks them up
//     and re-provisions based on desired-state.
//   - Return { ok, flagged_for_resync }
//
// SAFETY:
//   - When lockdown is engaged, brivo-sync-customer refuses to provision
//     anyone (skips with action='skipped_lockdown_active'). Prevents
//     the cron from undoing the lockdown 5 minutes later.
//   - Existing Brivo credentials are NOT deleted — just removed from
//     the active-members group. Restoring is fast.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBrivoEnv, loadBrivoEnvForTenant, listGroupMembers, removeUserFromGroup, extractJwt } from "../_brivo/api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Read + merge app_settings.value to flip the lockdown state. When
// running in tenant-mode (multi-tenant install with mig 069 saved
// credentials), scope by tenant_id so each park has its own lockdown
// state. Single-tenant env-var installs operate on the global row.
async function setLockdownState(sb: any, lockdown: any, tenantId: string | null): Promise<void> {
  let q = sb.from("app_settings").select("value, tenant_id").eq("key", "all");
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.maybeSingle();
  const v = (data?.value as any) || {};
  v.integrations = v.integrations || {};
  v.integrations.brivo = v.integrations.brivo || {};
  v.integrations.brivo.lockdown = lockdown;
  const upsertRow: Record<string, unknown> = { key: "all", value: v };
  if (tenantId) upsertRow.tenant_id = tenantId;
  // onConflict needs to match the UNIQUE INDEX. For tenant-scoped: (tenant_id, key); for global: (key).
  // Use the more permissive onConflict 'key,tenant_id' which Postgres treats as composite when the constraint exists.
  await sb.from("app_settings").upsert(upsertRow, { onConflict: tenantId ? "tenant_id,key" : "key" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ ok: false, error: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* tolerate empty */ }
  const action     = String(body?.action || "").toLowerCase();
  const reason     = String(body?.reason || "").slice(0, 500);
  const actorEmail = String(body?.actor_email || "").slice(0, 200);

  if (action !== "engage" && action !== "release") {
    return jsonResponse({ ok: false, error: "action must be 'engage' or 'release'" }, 400);
  }

  const sb = admin();

  // Tenant-aware credential resolution (mig 069). Owner JWT drives the
  // tenant_id lookup; falls back to env vars when JWT absent or no row.
  // Lockdown is a destructive operation — only flip the tenant's own
  // active-members group, never cross-tenant.
  let env: Awaited<ReturnType<typeof loadBrivoEnvForTenant>> | null = null;
  let lockdownTenantId: string | null = null;
  const jwt = extractJwt(req);
  if (jwt) {
    try {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } },
      );
      const { data: ctData } = await userClient.rpc("current_tenant_id");
      lockdownTenantId = (ctData as string) || null;
      env = await loadBrivoEnvForTenant(sb, lockdownTenantId);
    } catch (e) {
      console.warn("tenant resolution failed, falling back to env:", e);
      env = loadBrivoEnv();
    }
  } else {
    env = loadBrivoEnv();
  }
  if (!env) return jsonResponse({ ok: false, error: "Brivo not configured" }, 503);

  const groupId = env.activeMembersGroupId;
  if (!groupId) return jsonResponse({
    ok: false,
    error: "active-members group ID not set",
    hint: env.source === "tenant_table"
      ? "Set active_members_group_id via Settings → Brivo per-tenant credentials"
      : "supabase secrets set BRIVO_ACTIVE_MEMBERS_GROUP_ID=<id>",
  }, 503);

  if (action === "engage") {
    if (!reason) return jsonResponse({ ok: false, error: "reason required for engage" }, 400);

    // Read every Brivo user currently in the active-members group
    let members: Array<{ id: string; externalId?: string }> = [];
    try {
      members = await listGroupMembers(env, groupId);
    } catch (e) {
      return jsonResponse({ ok: false, error: "list group failed: " + (e as Error).message }, 502);
    }

    // Remove each from the group in parallel (cap concurrency at 10 to be
    // gentle on Brivo's rate limits while still being fast).
    const failures: Array<{ user_id: string; error: string }> = [];
    let removed = 0;
    const CONCURRENCY = 10;
    for (let i = 0; i < members.length; i += CONCURRENCY) {
      const slice = members.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(slice.map(m => removeUserFromGroup(env, m.id, groupId)));
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") removed++;
        else failures.push({ user_id: slice[idx].id, error: (r as PromiseRejectedResult).reason?.message || "unknown" });
      });
    }

    // Stamp local state: every customer with a brivo_user_id is now suspended.
    // CRITICAL: scope by tenant_id when available so multi-tenant installs don't
    // cross-suspend customers from other parks. Falls back to all-customers when
    // running env-var-based (single-tenant install).
    try {
      let upd = sb.from("customers")
        .update({ brivo_credential_state: "suspended" })
        .not("brivo_user_id", "is", null);
      if (lockdownTenantId) {
        upd = upd.eq("tenant_id", lockdownTenantId);
      }
      await upd;
    } catch (e) {
      console.warn("local state stamp failed:", e);
    }

    // Persist lockdown state in app_settings (tenant-scoped when running per-tenant)
    await setLockdownState(sb, {
      active: true,
      reason,
      set_at: new Date().toISOString(),
      set_by_email: actorEmail || null,
      group_size: members.length,
      removed,
      failed: failures.length,
    }, lockdownTenantId);

    // Audit log into webhook_log so admin can see what fired
    await sb.from("webhook_log").insert({
      source:     "brivo-lockdown",
      event_type: "engage",
      status:     failures.length === 0 ? "processed" : "error",
      payload:    { reason, actor_email: actorEmail, removed, failed: failures.length },
      error_message: failures.length ? `${failures.length} removes failed` : null,
    }).catch(() => {});

    return jsonResponse({
      ok: failures.length === 0,
      action: "engaged",
      group_size_before: members.length,
      removed,
      failed: failures.length,
      failures: failures.slice(0, 20),  // cap for sanity
      reason,
    });
  }

  // RELEASE
  // Flag every customer with brivo_user_id for re-sync. The cron will
  // re-provision based on desired-state. Anyone whose subscription
  // lapsed during lockdown stays revoked; everyone else gets restored.
  let flagged = 0;
  try {
    let q = sb.from("customers").select("id").not("brivo_user_id", "is", null);
    if (lockdownTenantId) q = q.eq("tenant_id", lockdownTenantId);
    const { data: rows } = await q;
    if (Array.isArray(rows)) {
      const now = new Date().toISOString();
      for (const r of rows) {
        await sb.from("customers")
          .update({ brivo_sync_needed_at: now })
          .eq("id", r.id);
        flagged++;
      }
    }
  } catch (e) {
    return jsonResponse({ ok: false, error: "flag-for-resync failed: " + (e as Error).message }, 500);
  }

  // Persist released state (tenant-scoped when applicable)
  let priorQ = sb.from("app_settings").select("value").eq("key", "all");
  if (lockdownTenantId) priorQ = priorQ.eq("tenant_id", lockdownTenantId);
  const { data: priorData } = await priorQ.maybeSingle();
  const priorV = (priorData?.value as any) || {};
  const prior = (priorV.integrations && priorV.integrations.brivo && priorV.integrations.brivo.lockdown) || {};
  await setLockdownState(sb, {
    ...prior,
    active: false,
    released_at: new Date().toISOString(),
    released_by_email: actorEmail || null,
  }, lockdownTenantId);

  await sb.from("webhook_log").insert({
    source:     "brivo-lockdown",
    event_type: "release",
    status:     "processed",
    payload:    { actor_email: actorEmail, flagged_for_resync: flagged },
  }).catch(() => {});

  return jsonResponse({
    ok: true,
    action: "released",
    flagged_for_resync: flagged,
    note: "Cron will re-provision eligible members within 5 minutes. Force-flag any individual customer via Sync now on customer detail.",
  });
});
