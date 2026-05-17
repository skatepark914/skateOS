// ============================================================
// brivo-save-config — owner-only per-tenant credential save
// ============================================================
// POST {
//   action: "save" | "delete" | "test",
//   client_id?:                   string,
//   client_secret?:               string,
//   api_key?:                     string,
//   account_id?:                  string,
//   active_members_group_id?:     string,
//   park_door_ap_id?:             string,
//   shop_door_ap_id?:             string,
//   operating_hours_schedule_id?: string,
//   webhook_secret?:              string,
//   auto_checkin_enabled?:        boolean,
//   actor_email?:                 string
// }
//
// Auth: caller's JWT must resolve to an owner via is_owner(). We verify
// this by passing the user's auth header through to a Supabase client
// that uses their token (NOT service-role), then check is_owner() RPC.
//
// On save:
//   - UPSERT tenant_brivo_config row for the caller's current_tenant_id
//   - Empty-string field values are treated as "leave existing alone"
//     (so the UI can omit fields the owner doesn't want to change)
//   - Whole-cloth replace requires sending all 4 OAuth fields together
//
// On test:
//   - Reads the current tenant's config + tries OAuth + a single API call
//   - Updates last_verified_at on success
//
// On delete:
//   - Drops the tenant_brivo_config row entirely. Edge Functions fall
//     back to env vars after.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBrivoEnvForTenant, getBrivoToken, brivoFetch } from "../_brivo/api.ts";

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

// Verify the caller is an owner of their current tenant. Returns
// { ok: true, tenantId, actorEmail } or an error response.
async function verifyOwner(req: Request): Promise<
  { ok: true; tenantId: string; actorEmail: string | null } | { ok: false; resp: Response }
> {
  const auth = req.headers.get("authorization") || "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return { ok: false, resp: jsonResponse({ ok: false, error: "Authorization header required" }, 401) };

  // Use a user-scoped client so RLS + is_owner() runs as the caller
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    },
  );

  // is_owner() is defined in mig 001 and checks staff.role for the auth.uid()
  const { data: ownerCheck, error: ocErr } = await userClient.rpc("is_owner");
  if (ocErr || ownerCheck !== true) {
    return { ok: false, resp: jsonResponse({ ok: false, error: "owner only" }, 403) };
  }

  // Resolve current tenant + email
  const { data: ctData, error: ctErr } = await userClient.rpc("current_tenant_id");
  const tenantId = (ctData as string) || null;
  if (ctErr || !tenantId) {
    return { ok: false, resp: jsonResponse({ ok: false, error: "no current tenant — apply mig 009 + ensure user_tenants row exists" }, 400) };
  }

  const { data: userData } = await userClient.auth.getUser();
  const actorEmail = userData?.user?.email ?? null;

  return { ok: true, tenantId, actorEmail };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ ok: false, error: "POST only" }, 405);

  const verify = await verifyOwner(req);
  if (!verify.ok) return verify.resp;
  const { tenantId, actorEmail } = verify;

  let body: any = {};
  try { body = await req.json(); } catch { /* tolerate */ }
  const action = String(body?.action || "save").toLowerCase();
  const sb = admin();

  if (action === "delete") {
    const { error } = await sb.from("tenant_brivo_config").delete().eq("tenant_id", tenantId);
    if (error) return jsonResponse({ ok: false, error: "delete failed: " + error.message }, 500);
    await sb.from("webhook_log").insert({
      source: "brivo-save-config",
      event_type: "deleted",
      status: "processed",
      payload: { tenant_id: tenantId, actor_email: actorEmail },
    }).catch(() => {});
    return jsonResponse({ ok: true, action: "deleted", tenant_id: tenantId });
  }

  if (action === "test") {
    const env = await loadBrivoEnvForTenant(sb, tenantId);
    if (!env) return jsonResponse({ ok: false, error: "no credentials configured for this tenant (table + env vars both empty)" }, 400);
    try {
      // OAuth handshake
      await getBrivoToken(env);
      // Try a real API call — minimal cost (list one user from active-members group, or just OAuth)
      if (env.activeMembersGroupId) {
        const r = await brivoFetch(env, `/groups/${env.activeMembersGroupId}/users?offset=0&pageSize=1`);
        if (r.status < 200 || r.status >= 300) {
          return jsonResponse({ ok: false, error: `Brivo API responded ${r.status}: ${r.raw.slice(0, 200)}`, source: env.source }, 502);
        }
      }
      // Stamp last_verified_at on the tenant's config row (if it exists in the table — env-only doesn't get stamped)
      if (env.source === "tenant_table") {
        await sb.from("tenant_brivo_config").update({
          last_verified_at:       new Date().toISOString(),
          last_verified_by_email: actorEmail,
        }).eq("tenant_id", tenantId);
      }
      return jsonResponse({ ok: true, action: "test_passed", source: env.source, tested_group: !!env.activeMembersGroupId });
    } catch (e) {
      return jsonResponse({ ok: false, error: "Brivo verification failed: " + (e as Error).message, source: env.source }, 502);
    }
  }

  // SAVE path — build a partial-update payload. Empty/undefined fields are
  // left alone (so the owner can paste a new client_secret without re-typing
  // every other field).
  const payload: Record<string, unknown> = { tenant_id: tenantId };
  const sensitiveFields = [
    "client_id", "client_secret", "api_key", "account_id",
    "active_members_group_id", "park_door_ap_id", "shop_door_ap_id",
    "operating_hours_schedule_id", "webhook_secret",
  ];
  let anyFieldGiven = false;
  for (const f of sensitiveFields) {
    if (typeof body?.[f] === "string" && body[f].trim().length > 0) {
      payload[f] = body[f].trim();
      anyFieldGiven = true;
    }
  }
  if (typeof body?.auto_checkin_enabled === "boolean") {
    payload.auto_checkin_enabled = body.auto_checkin_enabled;
    anyFieldGiven = true;
  }
  if (!anyFieldGiven) {
    return jsonResponse({ ok: false, error: "no fields provided to save" }, 400);
  }

  // UPSERT — INSERT or UPDATE on tenant_id PK
  const { error: upErr } = await sb.from("tenant_brivo_config").upsert(payload, { onConflict: "tenant_id" });
  if (upErr) {
    return jsonResponse({ ok: false, error: "save failed: " + upErr.message }, 500);
  }

  // Audit-log without echoing secret values
  await sb.from("webhook_log").insert({
    source: "brivo-save-config",
    event_type: "saved",
    status: "processed",
    payload: {
      tenant_id: tenantId,
      actor_email: actorEmail,
      fields_updated: Object.keys(payload).filter(k => k !== "tenant_id"),
    },
  }).catch(() => {});

  return jsonResponse({
    ok: true,
    action: "saved",
    tenant_id: tenantId,
    fields_updated: Object.keys(payload).filter(k => k !== "tenant_id"),
    note: "Edge Functions read from tenant_brivo_config on next call. Run action=test to verify the credentials work.",
  });
});
