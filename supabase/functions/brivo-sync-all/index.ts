// ============================================================
// brivo-sync-all — bulk Brivo reconciliation (pg_cron target)
// ============================================================
// Two modes via POST body:
//   { mode: "flagged" }  — process only customers with
//                          brivo_sync_needed_at IS NOT NULL
//                          (fires every 5 min via pg_cron)
//   { mode: "full" }     — reconcile EVERY customer + detect drift
//                          (Brivo users in group who shouldn't be,
//                          or eligible customers not provisioned).
//                          Fires daily at 04:00 UTC via pg_cron.
//
// Calls brivo-sync-customer per row via internal HTTP fan-out
// so each customer's reconcile lives in one place (DRY).
// Cap per-invocation: 200 customers (avoids timeout).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBrivoEnv, loadBrivoEnvForTenant, listGroupMembers } from "../_brivo/api.ts";

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

async function syncOne(customer_id: string): Promise<{ ok: boolean; action?: string; error?: string }> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/brivo-sync-customer`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ customer_id }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j?.ok, action: j?.action, error: j?.error };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ ok: false, error: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const mode = (body?.mode === "full") ? "full" : "flagged";

  // Per-tenant world (mig 069): we no longer require BRIVO_* env vars at
  // this entry point. Each customer's sync resolves credentials by their
  // tenant_id via brivo-sync-customer. If no tenant has Brivo configured,
  // every per-customer call errors with "Brivo not configured" — fine.
  // The legacy env-var path still works as a fallback for tenants without
  // a tenant_brivo_config row.
  const sb = admin();
  const envFallback = loadBrivoEnv();
  const cap = 200;
  const ranAt = new Date().toISOString();
  const results: Array<{ customer_id: string; ok: boolean; action?: string; error?: string }> = [];

  if (mode === "flagged") {
    // Pull flagged customers, oldest-flagged first (FIFO)
    const { data: rows, error } = await sb
      .from("customers")
      .select("id")
      .not("brivo_sync_needed_at", "is", null)
      .order("brivo_sync_needed_at", { ascending: true })
      .limit(cap);
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);

    for (const r of rows ?? []) {
      const res = await syncOne(r.id);
      results.push({ customer_id: r.id, ...res });
    }

    return jsonResponse({
      ok:         true,
      mode:       "flagged",
      ran_at:     ranAt,
      processed:  results.length,
      successes:  results.filter(r => r.ok).length,
      failures:   results.filter(r => !r.ok).length,
      results,
    });
  }

  // FULL mode — reconcile from both sides:
  //   1. Every customer in brivo_member_desired (catches "should have access
  //      but doesn't" + "shouldn't have access but does" by re-running each)
  //   2. Cross-check Brivo group members against the view (catches Brivo
  //      users in the group whose skateOS record was deleted entirely)

  const { data: rows, error } = await sb
    .from("brivo_member_desired")
    .select("customer_id")
    .limit(cap);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  for (const r of rows ?? []) {
    const res = await syncOne(r.customer_id);
    results.push({ customer_id: r.customer_id, ...res });
  }

  // Drift check: who's in a Brivo group but not in our customers table?
  // Multi-tenant: iterate (a) the env-var fallback account if configured,
  // PLUS (b) every tenant_brivo_config row that has credentials. Each
  // tenant's drift is computed separately so orphans are attributed correctly.
  const driftOrphans: Array<{ brivo_user_id: string; externalId?: string; email?: string; tenant_id?: string; tenant_source?: string }> = [];
  const knownCustomerIds = new Set((rows ?? []).map(r => r.customer_id));

  async function checkDriftForEnv(envForCheck: any, tenantId: string | null, sourceLabel: string) {
    if (!envForCheck) return;
    const groupId = envForCheck.activeMembersGroupId;
    if (!groupId) return;
    try {
      const members = await listGroupMembers(envForCheck, groupId);
      for (const m of members) {
        if (!m.externalId) {
          driftOrphans.push({ brivo_user_id: m.id, email: m.email, tenant_id: tenantId ?? undefined, tenant_source: sourceLabel });
          continue;
        }
        if (!knownCustomerIds.has(m.externalId)) {
          driftOrphans.push({ brivo_user_id: m.id, externalId: m.externalId, email: m.email, tenant_id: tenantId ?? undefined, tenant_source: sourceLabel });
        }
      }
    } catch (e) {
      console.warn(`Drift check failed for ${sourceLabel}:`, e);
    }
  }

  // (a) env-var fallback (single-tenant install, 2nd Nature)
  await checkDriftForEnv(envFallback, null, "env_vars");

  // (b) every tenant with per-tenant credentials (mig 069)
  try {
    const { data: tenantConfigs } = await sb.from("tenant_brivo_config")
      .select("tenant_id")
      .not("client_id", "is", null)
      .not("active_members_group_id", "is", null);
    for (const tc of (tenantConfigs ?? [])) {
      const tenantEnv = await loadBrivoEnvForTenant(sb, (tc as any).tenant_id);
      // Skip if this tenant's row resolved to the same env fallback (no per-tenant
      // creds yet) to avoid double-checking the env account
      if (tenantEnv && tenantEnv.source === "tenant_table") {
        await checkDriftForEnv(tenantEnv, (tc as any).tenant_id, "tenant_table");
      }
    }
  } catch (e) {
    console.warn("Per-tenant drift iteration failed (mig 069 may not be applied):", e);
  }

  return jsonResponse({
    ok:         true,
    mode:       "full",
    ran_at:     ranAt,
    processed:  results.length,
    successes:  results.filter(r => r.ok).length,
    failures:   results.filter(r => !r.ok).length,
    drift_orphans: driftOrphans,
    drift_orphan_count: driftOrphans.length,
    results,
  });
});
