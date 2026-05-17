// ============================================================
// brivo-issue-event-pass — issue a time-bounded Brivo credential
// ============================================================
// POST {
//   customer_id: UUID,
//   valid_from:  ISO timestamp,
//   valid_until: ISO timestamp,
//   reason?:     string (audit display),
//   party_form_submission_id?: UUID,
//   actor_email?: string,
//   send_invite?: boolean (default true — sends Brivo Mobile Pass invite)
// }
//
// Flow:
//   1. Validate inputs (customer exists, window is in the future, sane duration)
//   2. Insert brivo_event_passes row (mig 067)
//   3. If customer has no brivo_user_id yet → provision via brivo-sync-customer
//      (which respects waiver + ban gates). Otherwise re-flag for sync so the
//      brivo_member_desired view's now-active 'event_pass' state propagates.
//   4. Audit-log to webhook_log
//
// Auto-revoke happens via pg_cron `brivo-event-pass-sweep` (mig 067) at the
// next 5-min mark after valid_until passes.
//
// Doug doesn't have to do anything special in Brivo dashboard — event passes
// piggyback on the standard `skateOS Active Members` group. The brivo_member
// _desired view grants access during the pass window; brivo-sync-customer
// adds-to-group; the sweep cron + sync remove-from-group when expired.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBrivoEnv, loadBrivoEnvForTenant } from "../_brivo/api.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ ok: false, error: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* tolerate */ }

  const customer_id = String(body?.customer_id || "").trim();
  const validFromStr = String(body?.valid_from || "").trim();
  const validUntilStr = String(body?.valid_until || "").trim();
  const reason       = String(body?.reason || "").slice(0, 500);
  const partyFormId  = body?.party_form_submission_id || null;
  const actorEmail   = String(body?.actor_email || "").slice(0, 200);
  const sendInvite   = body?.send_invite !== false;

  if (!customer_id) return jsonResponse({ ok: false, error: "customer_id required" }, 400);
  if (!validFromStr || !validUntilStr) {
    return jsonResponse({ ok: false, error: "valid_from + valid_until required (ISO timestamps)" }, 400);
  }

  // Parse + validate window
  const validFrom  = new Date(validFromStr);
  const validUntil = new Date(validUntilStr);
  if (isNaN(validFrom.getTime()) || isNaN(validUntil.getTime())) {
    return jsonResponse({ ok: false, error: "valid_from / valid_until must be parseable timestamps" }, 400);
  }
  if (validUntil <= validFrom) {
    return jsonResponse({ ok: false, error: "valid_until must be after valid_from" }, 400);
  }
  // Allow passes up to 30 days long (longer is suspicious — should be a membership)
  const durationDays = (validUntil.getTime() - validFrom.getTime()) / (24 * 3600 * 1000);
  if (durationDays > 30) {
    return jsonResponse({ ok: false, error: "pass window cannot exceed 30 days — issue a membership instead" }, 400);
  }
  // Refuse passes that ended more than 1 hour ago — likely a stale form
  if (validUntil.getTime() < Date.now() - 3600 * 1000) {
    return jsonResponse({ ok: false, error: "valid_until is in the past — refusing to issue retroactively" }, 400);
  }

  const sb = admin();

  // Load customer to get tenant_id + verify exists
  const { data: c, error: cErr } = await sb
    .from("customers")
    .select("id, tenant_id, name, email, waiver_signed_at, waiver_expires_at, tags, brivo_user_id")
    .eq("id", customer_id)
    .maybeSingle();
  if (cErr || !c) {
    return jsonResponse({ ok: false, error: "customer not found" }, 404);
  }

  // Defensive: refuse to issue for banned customers
  const bannedAliases = ["banned", "do_not_serve", "donotserve", "86d"];
  const tags = (c.tags as string[] | null) || [];
  const isBanned = tags.some(t => {
    const norm = String(t || "").toLowerCase().replace(/[-\s]/g, "_");
    return bannedAliases.includes(norm);
  });
  if (isBanned) {
    return jsonResponse({ ok: false, error: "customer is banned — cannot issue event pass" }, 403);
  }

  // Defensive: warn (but don't block) if waiver is missing/expired
  let waiverWarning: string | null = null;
  if (!c.waiver_signed_at) {
    waiverWarning = "no waiver on file — pass issued but access will be blocked until waiver is signed";
  } else if (c.waiver_expires_at && new Date(c.waiver_expires_at) < validUntil) {
    waiverWarning = "waiver expires before the pass window ends — renew waiver to keep access through the full event";
  }

  // Insert the pass
  const { data: pass, error: pErr } = await sb.from("brivo_event_passes").insert({
    customer_id:              customer_id,
    tenant_id:                c.tenant_id,
    valid_from:               validFrom.toISOString(),
    valid_until:              validUntil.toISOString(),
    status:                   "active",
    reason:                   reason || null,
    party_form_submission_id: partyFormId,
    notes:                    actorEmail ? `Issued by ${actorEmail}` : null,
  }).select("id, valid_from, valid_until").single();

  if (pErr) {
    return jsonResponse({ ok: false, error: "could not insert pass: " + pErr.message }, 500);
  }

  // Flag for immediate sync — the 5-min cron will pick it up. If we have
  // Brivo credentials wired (either per-tenant or env vars) AND the pass
  // window includes now, fire sync synchronously so the credential is
  // provisioned right away (customer can use door immediately).
  let syncResult: any = null;
  const nowInWindow = validFrom <= new Date() && validUntil > new Date();
  await sb.from("customers").update({ brivo_sync_needed_at: new Date().toISOString() }).eq("id", customer_id);

  // Tenant-aware credential check (mig 069). Falls back to env vars.
  const tenantEnv = await loadBrivoEnvForTenant(sb, c.tenant_id);
  if (tenantEnv && nowInWindow) {
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/brivo-sync-customer`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({ customer_id, force_invite: sendInvite }),
      });
      syncResult = await r.json().catch(() => null);
    } catch (e) {
      console.warn("event pass sync fan-out failed:", e);
    }
  }

  // Audit log
  await sb.from("webhook_log").insert({
    source:     "brivo-issue-event-pass",
    event_type: "issued",
    status:     "processed",
    ref_table:  "brivo_event_passes",
    ref_id:     pass.id,
    payload:    {
      customer_id,
      customer_name: c.name,
      valid_from:    pass.valid_from,
      valid_until:   pass.valid_until,
      reason,
      actor_email:   actorEmail,
      now_in_window: nowInWindow,
      sync_action:   syncResult?.action,
      waiver_warning: waiverWarning,
    },
    error_message: waiverWarning,
  }).catch(() => {});

  return jsonResponse({
    ok: true,
    pass_id:        pass.id,
    customer_id,
    customer_name:  c.name,
    valid_from:     pass.valid_from,
    valid_until:    pass.valid_until,
    now_in_window:  nowInWindow,
    sync_action:    syncResult?.action,
    waiver_warning: waiverWarning,
    auto_revoke_via: "pg_cron brivo-event-pass-sweep runs every 5 min — flips status to 'expired' + flags customer for re-sync after valid_until passes",
  });
});
