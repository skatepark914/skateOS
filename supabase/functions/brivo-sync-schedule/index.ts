// ============================================================
// brivo-sync-schedule — push skateOS park hours → Brivo schedule
// ============================================================
// POST { dry_run?: boolean, actor_email?: string }
//
// Reads `app_settings.value.hours` (skateOS owner-edited operating hours
// per day-of-week + closed-day flags). Transforms to Brivo's documented
// schedule format. PUTs to the configured schedule via Brivo API.
//
// Manual trigger only (Settings button) — does NOT auto-fire on every
// settings save. Owner clicks when ready, sees pass/fail per-day.
//
// Required secret: BRIVO_OPERATING_HOURS_SCHEDULE_ID — the Brivo schedule
// ID that gates non-member access (or member access if Doug wants
// operating-hours-only). When unset, function refuses + tells the owner.
//
// Brivo's schedule API shape (per their public docs):
//   PUT /v1/api/schedules/{scheduleId}
//   body: {
//     scheduleId: number,
//     name: string,
//     timeBlocks: [
//       { dayOfWeek: 0..6 (Sun=0), startTime: "HH:MM", endTime: "HH:MM" }
//     ]
//   }
// We don't fully trust this shape across all Brivo account tiers, so the
// function returns the PUT body in the response when dry_run=true so the
// owner can verify before firing for real.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBrivoEnv, loadBrivoEnvForTenant, brivoFetch, extractJwt } from "../_brivo/api.ts";

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

// Map skateOS day labels → Brivo dayOfWeek integers (Sun=0).
const DOW_MAP: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

// Normalize HH:MM time string. Accepts "9am" / "9:00" / "21:00" / "9:00 PM".
function normalizeTime(t: string | undefined | null): string | null {
  if (!t) return null;
  const s = String(t).trim().toLowerCase();
  const ampm = /(am|pm)/.exec(s);
  let body = s.replace(/(am|pm)/, "").trim();
  let h = 0, m = 0;
  if (body.includes(":")) {
    const [hs, ms] = body.split(":");
    h = parseInt(hs, 10); m = parseInt(ms || "0", 10);
  } else {
    h = parseInt(body, 10); m = 0;
  }
  if (isNaN(h) || isNaN(m)) return null;
  if (ampm) {
    if (ampm[1] === "pm" && h < 12) h += 12;
    if (ampm[1] === "am" && h === 12) h = 0;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ ok: false, error: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* tolerate */ }
  const dryRun = body?.dry_run === true;
  const actorEmail = String(body?.actor_email || "").slice(0, 200);

  const sb = admin();

  // Tenant-aware credential resolution (mig 069). When the caller has
  // an owner JWT, resolve their current_tenant_id + look up that tenant's
  // Brivo config. Falls back to env vars when no JWT, no row, or partial
  // config. 2nd Nature's env-var setup keeps working.
  let env: Awaited<ReturnType<typeof loadBrivoEnvForTenant>> | null = null;
  const jwt = extractJwt(req);
  if (jwt) {
    try {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } },
      );
      const { data: ctData } = await userClient.rpc("current_tenant_id");
      const tenantId = (ctData as string) || null;
      env = await loadBrivoEnvForTenant(sb, tenantId);
    } catch (e) {
      console.warn("tenant resolution failed, falling back to env:", e);
      env = loadBrivoEnv();
    }
  } else {
    env = loadBrivoEnv();
  }
  if (!env) return jsonResponse({ ok: false, error: "Brivo not configured" }, 503);

  const scheduleId = env.operatingHoursScheduleId;
  if (!scheduleId) {
    return jsonResponse({
      ok: false,
      error: "Operating-hours schedule ID not set for this tenant",
      hint: env.source === "tenant_table"
        ? "Set operating_hours_schedule_id via Settings → Brivo per-tenant credentials → Update credentials"
        : "Find the schedule's numeric ID in Brivo dashboard → Schedules → click your operating-hours schedule → URL contains it. Then: supabase secrets set BRIVO_OPERATING_HOURS_SCHEDULE_ID=<id> --project-ref zecurmlenxyxanqucrga && bash admin/deploy-functions.sh",
    }, 503);
  }

  // Load settings.hours
  const { data: setRow, error: sErr } = await sb.from("app_settings").select("value").eq("key", "all").maybeSingle();
  if (sErr) return jsonResponse({ ok: false, error: "settings fetch failed: " + sErr.message }, 500);
  const hours = (setRow?.value as any)?.hours || {};

  // Transform to Brivo timeBlocks
  const timeBlocks: Array<{ dayOfWeek: number; startTime: string; endTime: string }> = [];
  const skipped: Array<{ day: string; reason: string }> = [];
  for (const [day, cfg] of Object.entries(hours)) {
    const dow = DOW_MAP[String(day).toLowerCase()];
    if (dow === undefined) { skipped.push({ day, reason: "unknown day key" }); continue; }
    const c = cfg as { open?: string; close?: string; closed?: boolean };
    if (c.closed === true) { skipped.push({ day, reason: "marked closed" }); continue; }
    const start = normalizeTime(c.open);
    const end   = normalizeTime(c.close);
    if (!start || !end) { skipped.push({ day, reason: "unparseable time" }); continue; }
    if (start >= end) { skipped.push({ day, reason: "start ≥ end" }); continue; }
    timeBlocks.push({ dayOfWeek: dow, startTime: start, endTime: end });
  }

  if (timeBlocks.length === 0) {
    return jsonResponse({
      ok: false,
      error: "No valid timeBlocks to push — every day was marked closed or had unparseable times. Set hours in Settings → Park Hours first.",
      skipped,
    }, 400);
  }

  // Sort by dayOfWeek for consistency
  timeBlocks.sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  const putBody = {
    scheduleId: Number(scheduleId),
    name: "skateOS operating hours (synced)",
    timeBlocks,
  };

  if (dryRun) {
    return jsonResponse({
      ok: true,
      dry_run: true,
      schedule_id: scheduleId,
      timeBlocks,
      skipped,
      note: "No PUT fired — this is a dry-run preview. Re-call with dry_run=false to push.",
    });
  }

  // PUT to Brivo
  let pushResult: any;
  try {
    pushResult = await brivoFetch(env, `/schedules/${scheduleId}`, {
      method: "PUT",
      json: putBody,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: "Brivo PUT failed: " + (e as Error).message, putBody }, 502);
  }

  const success = pushResult.status >= 200 && pushResult.status < 300;

  // Audit log
  await sb.from("webhook_log").insert({
    source:     "brivo-sync-schedule",
    event_type: success ? "synced" : "failed",
    status:     success ? "processed" : "error",
    payload:    { schedule_id: scheduleId, timeBlocks_count: timeBlocks.length, skipped, actor_email: actorEmail, brivo_response_status: pushResult.status },
    error_message: success ? null : pushResult.raw?.slice(0, 500),
  }).catch(() => {});

  if (!success) {
    return jsonResponse({
      ok: false,
      error: "Brivo rejected the schedule (HTTP " + pushResult.status + ")",
      brivo_response: pushResult.raw?.slice(0, 500),
      putBody,
      hint: "Brivo's schedule shape may vary by account tier. Check the response above + verify against Brivo dashboard → API docs for the exact PUT /schedules/{id} body format. Adjust supabase/functions/brivo-sync-schedule/index.ts if needed.",
    }, 502);
  }

  return jsonResponse({
    ok: true,
    schedule_id: scheduleId,
    pushed_timeBlocks: timeBlocks.length,
    timeBlocks,
    skipped,
    brivo_status: pushResult.status,
  });
});
