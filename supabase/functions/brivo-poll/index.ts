// ============================================================
// brivo-poll — pull recent Brivo events instead of receiving webhooks
//
// Doug's Brivo tier only supports email notifications, not URL webhooks.
// This function polls Brivo's /v1/api/events endpoint on a schedule
// (typically every 30-60s via pg_cron), inserts new events into
// brivo_access_log, and fires the auto-checkin + staff clock-in
// prompt downstream — the same downstream effects as a webhook delivery.
//
// State is stored in app_settings.value.brivo_poll_state:
//   { last_polled_at: ISO timestamp, last_event_id: string }
//
// First run pulls the last hour to avoid replaying everything.
// Subsequent runs pull events since the prior cursor.
// Dedup by brivo_event_id (UNIQUE INDEX in brivo_access_log).
//
// AUTH: same Brivo OAuth creds as the other brivo-* functions.
// ============================================================

import { loadBrivoEnv, brivoFetch } from "../_brivo/api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// Map Brivo event payload → skateOS event_type the rest of the system uses
function classifyEventType(e: any): string {
  const name = String(e?.occurred_event_type_name || e?.event_type || "").toLowerCase();
  if (name.includes("granted")  || name.includes("permitted")) return "access_granted";
  if (name.includes("denied")   || name.includes("rejected"))  return "access_denied";
  if (name.includes("forced"))                                 return "door_forced";
  if (name.includes("held"))                                   return "door_held_open";
  return name || "other";
}

// Map Brivo's access point → park_door / shop_door (env-configured AP IDs)
function classifyDoor(apId: string | null | undefined): string {
  if (!apId) return "other";
  if (apId === Deno.env.get("BRIVO_PARK_DOOR_AP_ID")) return "park_door";
  if (apId === Deno.env.get("BRIVO_SHOP_DOOR_AP_ID")) return "shop_door";
  return "other";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const env = loadBrivoEnv();
  if (!env) {
    return jsonResponse({
      ok: false,
      error: "Brivo creds not configured. Run: supabase secrets set BRIVO_CLIENT_ID=... BRIVO_CLIENT_SECRET=... BRIVO_API_KEY=... BRIVO_ACCOUNT_ID=...",
    }, 500);
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Body params let you force a window (e.g. backfill)
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const manualSince: string | undefined = body?.since;
  const dryRun: boolean = body?.dry_run === true;

  // Load poll cursor from app_settings
  const { data: stateRow } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", "brivo_poll_state")
    .maybeSingle();
  const prevState = (stateRow?.value as any) || {};
  const lastPolledAt: string | undefined = prevState.last_polled_at;

  // Determine the from-time:
  // - manual override via body.since
  // - else the prior cursor
  // - else 1 hour ago (first run guard)
  const fromIso = manualSince
    || lastPolledAt
    || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  // Fetch from Brivo
  // /v1/api/events?fromOccurredOn=<ISO>&pageSize=100&offset=N
  // (Brivo's exact field name is tier-dependent; we try the documented
  //  approach, fall back if needed.)
  const collected: any[] = [];
  let page = 0;
  const MAX_PAGES = 10; // 1000 events per run cap so we don't time out
  while (page < MAX_PAGES) {
    const qs = new URLSearchParams({
      pageSize: "100",
      offset: String(page * 100),
      fromOccurredOn: fromIso,
    });
    try {
      const r = await brivoFetch(env, `/events?${qs.toString()}`);
      if (!r.ok) {
        return jsonResponse({
          ok: false,
          error: `Brivo /events failed ${r.status}: ${r.body?.slice(0, 240) || ""}`,
          from: fromIso,
        }, 502);
      }
      const items: any[] = r.json?.data || r.json?.events || r.json || [];
      if (!Array.isArray(items) || items.length === 0) break;
      collected.push(...items);
      if (items.length < 100) break; // last page
      page++;
    } catch (e) {
      return jsonResponse({
        ok: false,
        error: `Brivo /events network error: ${(e as Error).message}`,
      }, 502);
    }
  }

  const summary: any = {
    polled_from: fromIso,
    polled_at: nowIso,
    events_fetched: collected.length,
  };

  if (dryRun) {
    summary.dry_run = true;
    summary.sample = collected.slice(0, 3).map((e: any) => ({
      id: e.id,
      occurred_on: e.occurred,
      type: classifyEventType(e),
      user_id: e.actor?.id,
      access_point_id: e.object?.id,
    }));
    return jsonResponse({ ok: true, summary });
  }

  // For each event, do the same writes the webhook does (slimmer version).
  let inserted = 0;
  let skippedDupe = 0;
  let autoCheckins = 0;
  let staffPrompts = 0;
  const errors: string[] = [];

  for (const e of collected) {
    try {
      const eventId = String(e.id ?? e.event_id ?? "");
      if (!eventId) continue;

      // Dedup against brivo_access_log by brivo_event_id
      const { data: existing } = await sb
        .from("brivo_access_log")
        .select("id")
        .eq("brivo_event_id", eventId)
        .maybeSingle();
      if (existing?.id) { skippedDupe++; continue; }

      const occurredOn: string = e.occurred ?? e.occurred_on ?? nowIso;
      const brivoUserId = e.actor?.id != null ? String(e.actor.id) : null;
      const accessPointId = e.object?.id != null ? String(e.object.id) : null;
      const accessPoint = classifyDoor(accessPointId);
      const eventType = classifyEventType(e);

      // Look up the customer
      let customerId: string | null = null;
      let tenantId: string | null = null;
      let customerName = "(unknown)";
      if (brivoUserId) {
        const { data: c } = await sb
          .from("customers")
          .select("id, name, tenant_id")
          .eq("brivo_user_id", brivoUserId)
          .maybeSingle();
        if (c?.id) {
          customerId = c.id;
          tenantId = c.tenant_id || null;
          customerName = c.name || "(unknown)";
        }
      }

      // Insert access log row (idempotent via UNIQUE on brivo_event_id)
      const { error: insErr } = await sb.from("brivo_access_log").insert({
        tenant_id: tenantId,
        brivo_event_id: eventId,
        brivo_user_id: brivoUserId,
        customer_id: customerId,
        access_point: accessPoint,
        access_point_id: accessPointId,
        event_type: eventType,
        occurred_at: occurredOn,
        raw_payload: e,
      });
      if (insErr) {
        if (String(insErr.message || "").toLowerCase().includes("duplicate")) {
          skippedDupe++;
          continue;
        }
        errors.push(`insert ${eventId}: ${insErr.message}`);
        continue;
      }
      inserted++;

      const isGrant = eventType === "access_granted" || eventType === "face_matched";

      // Auto-checkin (park door grants only)
      if (isGrant && customerId && accessPoint === "park_door") {
        const autoEnabled = (Deno.env.get("BRIVO_AUTO_CHECKIN_ENABLED") ?? "true") !== "false";
        if (autoEnabled) {
          const eightHrsAgo = new Date(Date.now() - 8 * 3600 * 1000).toISOString();
          const { data: openCi } = await sb
            .from("checkins")
            .select("id")
            .eq("customer_id", customerId)
            .is("checked_out_at", null)
            .gte("checked_in_at", eightHrsAgo)
            .limit(1);
          if (!openCi || openCi.length === 0) {
            const { error: ciErr } = await sb.from("checkins").insert({
              customer_id: customerId,
              tenant_id: tenantId,
              checked_in_at: occurredOn,
              notes: `[Auto-checked-in via Brivo park door ${occurredOn} · brivo-poll]`,
            });
            if (!ciErr) autoCheckins++;
          }
        }
      }

      // Staff clock-in prompt — email staff who tap any door
      // (mig 072 + 073: staff PWA self-clock-in path)
      if (isGrant && brivoUserId) {
        const { data: staffRow } = await sb
          .from("staff")
          .select("id, display_name, email")
          .eq("brivo_user_id", brivoUserId)
          .maybeSingle();
        if (staffRow?.email) {
          // Idempotent per door tap: skip if we emailed for the same brivo_event_id already
          const { data: priorPrompt } = await sb
            .from("webhook_log")
            .select("id")
            .eq("source", "brivo-poll")
            .eq("event_type", "staff_clock_prompt")
            .eq("event_id", eventId)
            .maybeSingle();
          if (!priorPrompt) {
            // Generate a clock token (mig 072) so the email link is one-tap
            try {
              // RPC name was wrong — only issue_staff_clock_token exists
              // (verified via pg_proc 2026-06-22). Brivo-webhook uses the
              // correct name; brivo-poll was a copy/paste rename gone wrong.
              const { data: tokRow } = await sb
                .rpc("issue_staff_clock_token", { p_staff_id: staffRow.id });
              const token = (tokRow as any)?.token || (tokRow as any) || null;
              const appBase = Deno.env.get("APP_BASE_URL") || "https://app.skateos.com";
              const clockUrl = token
                ? `${appBase}/clock?t=${encodeURIComponent(token)}`
                : `${appBase}/staff`;
              // Check whether they're clocked in (so subject/body reflects state)
              const { data: openEntry } = await sb
                .from("time_entries")
                .select("id, clocked_in_at")
                .eq("staff_id", staffRow.id)
                .is("clocked_out_at", null)
                .order("clocked_in_at", { ascending: false })
                .maybeSingle();
              const isClockedIn = !!openEntry?.id;
              const subject = isClockedIn ? "Clock out?" : "Clock in?";
              const action = isClockedIn ? "Clock out" : "Clock in";
              const verb = isClockedIn ? "you out" : "you in";

              await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  to: staffRow.email,
                  subject: `skateOS · ${subject}`,
                  html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
                    <h1 style="font-size:1.4rem;margin:0 0 8px;">${subject}</h1>
                    <p style="font-size:1rem;color:#4a525c;margin:0 0 20px;">${staffRow.display_name}, you just tapped the door. Tap below to clock ${verb}. If you're just stopping by, ignore this.</p>
                    <a href="${clockUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:14px 24px;border-radius:10px;font-weight:700;text-decoration:none;">${action} →</a>
                    <p style="font-size:.8rem;color:#9aa3ad;margin-top:24px;">${new Date(occurredOn).toLocaleString()}</p>
                  </div>`,
                  tags: { source: "brivo-poll", staff_id: staffRow.id, event_id: eventId },
                }),
              }).catch(() => { /* best-effort */ });

              // Audit row so dedup works for future polls
              await sb.from("webhook_log").insert({
                source: "brivo-poll",
                event_type: "staff_clock_prompt",
                event_id: eventId,
                status: "ok",
                payload: { staff_id: staffRow.id, action },
              });
              staffPrompts++;
            } catch (promptErr) {
              errors.push(`staff prompt ${eventId}: ${(promptErr as Error).message}`);
            }
          }
        }
      }
    } catch (perEventErr) {
      errors.push(`event ${e?.id}: ${(perEventErr as Error).message}`);
    }
  }

  // Update poll cursor
  await sb.from("app_settings").upsert({
    key: "brivo_poll_state",
    value: { last_polled_at: nowIso, last_event_count: inserted },
  }, { onConflict: "key" });

  summary.inserted = inserted;
  summary.skipped_duplicate = skippedDupe;
  summary.auto_checkins = autoCheckins;
  summary.staff_prompts = staffPrompts;
  if (errors.length > 0) summary.errors = errors.slice(0, 10);

  return jsonResponse({ ok: true, summary });
});
