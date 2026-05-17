// ============================================================
// frigate-webhook — receive vision events from on-site Frigate
// ============================================================
// The skateOS Vision Box (Pi 5 + Coral, running Frigate) posts here
// whenever it detects an object event. We log to frigate_events
// (mig 068), cross-reference with brivo_access_log when applicable,
// and pass through quietly otherwise.
//
// Vision Box config (Frigate's `mqtt.tls.webhook` or `events.webhook`):
//   URL: https://zecurmlenxyxanqucrga.supabase.co/functions/v1/frigate-webhook
//   Header: x-frigate-tenant: <tenant_id>     (so multi-park installs route correctly)
//   Header: x-frigate-secret: <shared-secret> (set FRIGATE_WEBHOOK_SECRET)
//
// Frigate event payload shape (from their docs):
//   {
//     type: "new" | "update" | "end",
//     before: { ...event state before this update },
//     after:  { id, camera, label, sub_label, score, top_score, start_time, end_time,
//               has_clip, has_snapshot, snapshot_url, clip_url, ... }
//   }
// We use `after` as the canonical state.
//
// CROSS-REFERENCE WITH BRIVO:
//   On `type='end'` with label='person' at a camera mapped to park_door,
//   look for a brivo_access_log row with event_type IN ('access_granted',
//   'face_matched') AND access_point='park_door' AND occurred_at within
//   ±5 seconds of the event. If found, link them. Closes the loop for
//   forensics: "Brivo says Tommy entered at 9:47pm — did the camera see
//   one person or two (tailgater)?"
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey, x-frigate-tenant, x-frigate-secret",
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

// Convert Frigate's epoch-seconds to ISO timestamp
function toIso(epochSec: number | null | undefined): string | null {
  if (epochSec === null || epochSec === undefined || isNaN(Number(epochSec))) return null;
  return new Date(Number(epochSec) * 1000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ ok: false, error: "POST only" }, 405);

  // Optional shared-secret check
  const secret = Deno.env.get("FRIGATE_WEBHOOK_SECRET");
  if (secret) {
    const sent = req.headers.get("x-frigate-secret") || "";
    if (sent !== secret) {
      return new Response("Bad secret", { status: 401 });
    }
  }

  const tenantHeader = req.headers.get("x-frigate-tenant");
  const ipAddr = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const sb = admin();

  // Initial received log entry — failures still get traced via webhook_log
  let logId: string | null = null;
  try {
    const ins = await sb.from("webhook_log").insert({
      source:     "frigate",
      event_type: body?.type ?? "unknown",
      event_id:   body?.after?.id ? String(body.after.id) : null,
      status:     "received",
      payload:    body,
      ip_address: ipAddr,
    }).select("id").single();
    logId = (ins.data as any)?.id ?? null;
  } catch (e) {
    console.warn("frigate webhook log insert failed:", e);
  }

  // Frigate fires 'new' when an event starts, 'update' as it evolves,
  // 'end' when finalized. We persist a single row per event_id and
  // UPSERT on subsequent updates so end-state has the full data.
  const ev = body?.after || {};
  const eventId = ev.id ? String(ev.id) : null;
  if (!eventId) {
    // Some Frigate configs fire events without IDs (raw motion etc) — log + ignore
    if (logId) {
      await sb.from("webhook_log").update({ status: "ignored", error_message: "no event id" }).eq("id", logId).catch(() => {});
    }
    return jsonResponse({ ok: true, ignored: "no event id" });
  }

  // Look up the camera_id (FK) by camera_key — null if not configured yet
  let cameraFkId: string | null = null;
  let cameraLocationLabel: string | null = null;
  const cameraKey = ev.camera ? String(ev.camera) : null;
  if (cameraKey) {
    const { data: camRow } = await sb.from("frigate_cameras")
      .select("id, location_label")
      .eq("camera_key", cameraKey)
      .maybeSingle();
    if (camRow) {
      cameraFkId = (camRow as any).id;
      cameraLocationLabel = (camRow as any).location_label;
    }
  }

  // Build the row payload
  const rowData = {
    frigate_event_id: eventId,
    camera_id:        cameraFkId,
    camera_key:       cameraKey,
    label:            ev.label || "unknown",
    sub_label:        ev.sub_label || null,
    score:            typeof ev.score === "number" ? ev.score : null,
    top_score:        typeof ev.top_score === "number" ? ev.top_score : null,
    start_time:       toIso(ev.start_time) ?? new Date().toISOString(),
    end_time:         toIso(ev.end_time),
    has_clip:         !!ev.has_clip,
    has_snapshot:     !!ev.has_snapshot,
    clip_url:         ev.clip_url || null,
    snapshot_url:     ev.snapshot_url || null,
    raw_payload:      body,
  };

  // UPSERT by frigate_event_id so 'new'/'update'/'end' updates land
  // on the same row. Honor the optional tenant header so multi-park
  // Vision Boxes route correctly.
  let upsertPayload: Record<string, unknown> = { ...rowData };
  if (tenantHeader) {
    upsertPayload.tenant_id = tenantHeader;
  }

  let eventRowId: string | null = null;
  let eventLinkedToBrivo: string | null = null;
  let outcomeStatus: "processed" | "error" | "ignored" = "processed";
  let errorMessage: string | null = null;

  try {
    const upResp = await sb.from("frigate_events")
      .upsert(upsertPayload, { onConflict: "frigate_event_id" })
      .select("id")
      .single();
    eventRowId = (upResp.data as any)?.id ?? null;

    // Cross-reference with brivo_access_log when this is a person-event
    // at the park door, on 'end' (so we have the full time window).
    if (body?.type === "end" && rowData.label === "person" && cameraLocationLabel === "park_door") {
      try {
        const startMs = new Date(rowData.start_time).getTime();
        const winStart = new Date(startMs - 5_000).toISOString();
        const winEnd   = new Date(startMs + 5_000).toISOString();
        const { data: matches } = await sb.from("brivo_access_log")
          .select("id, customer_id")
          .eq("access_point", "park_door")
          .in("event_type", ["access_granted", "face_matched"])
          .gte("occurred_at", winStart)
          .lte("occurred_at", winEnd)
          .limit(1);
        if (matches && matches.length > 0) {
          const m = matches[0] as { id: string; customer_id: string | null };
          eventLinkedToBrivo = m.id;
          await sb.from("frigate_events").update({
            brivo_access_log_id: m.id,
            customer_id:         m.customer_id,
          }).eq("id", eventRowId!);
        } else {
          // No Brivo grant nearby — this is a potential tailgater /
          // unauthorized entry. Count recent unmatched person events at
          // park_door in last 10 min. When ≥3, post Team Chat reminder
          // (idempotent per 30-min window so we don't spam).
          try {
            const tenAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            const { count: unmatchedCount } = await sb.from("frigate_events")
              .select("id", { count: "exact", head: true })
              .eq("label", "person")
              .is("brivo_access_log_id", null)
              .gte("start_time", tenAgo);
            // Limit to park-door camera via FK
            const { data: parkDoorCams } = await sb.from("frigate_cameras")
              .select("id")
              .eq("location_label", "park_door");
            const camIds = (parkDoorCams ?? []).map((c: any) => c.id);
            if (camIds.length > 0 && (unmatchedCount ?? 0) >= 3) {
              // Re-query scoped to park_door cameras for the real count
              const { count: scopedCount } = await sb.from("frigate_events")
                .select("id", { count: "exact", head: true })
                .eq("label", "person")
                .is("brivo_access_log_id", null)
                .in("camera_id", camIds)
                .gte("start_time", tenAgo);
              if ((scopedCount ?? 0) >= 3) {
                // Dedup: only one tailgater alert per 30 min
                const halfHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
                const tagMarker = "[frigate-tailgater-alert]";
                const { data: existing } = await sb
                  .from("team_messages")
                  .select("id")
                  .eq("kind", "reminder")
                  .gte("created_at", halfHourAgo)
                  .ilike("body", `%${tagMarker}%`)
                  .limit(1);
                if (!existing || existing.length === 0) {
                  await sb.from("team_messages").insert({
                    kind:           "reminder",
                    body:           `⚠️ ${scopedCount} person detection(s) at park door without matching Brivo grant in the last 10 min — possible tailgater or Vision Box over-firing. Check live camera + Activity Log → Brivo events. ${tagMarker}`,
                    due_at:         new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                    posted_by_name: "Frigate webhook",
                  });
                }
              }
            }
          } catch (alertErr) {
            // Non-blocking — tailgater alerts are advisory
            console.warn("frigate tailgater alert non-fatal:", alertErr);
          }
        }
      } catch (xrefErr) {
        console.warn("brivo cross-ref non-fatal:", xrefErr);
      }
    }
  } catch (e) {
    outcomeStatus = "error";
    errorMessage  = (e as Error).message;
    console.error("frigate_events upsert failed:", e);
  }

  // Update webhook_log with outcome
  if (logId) {
    try {
      await sb.from("webhook_log").update({
        status:        outcomeStatus,
        ref_table:     eventRowId ? "frigate_events" : null,
        ref_id:        eventRowId,
        error_message: errorMessage,
      }).eq("id", logId);
    } catch (e) {
      console.warn("frigate webhook_log update failed:", e);
    }
  }

  return jsonResponse({
    ok: outcomeStatus !== "error",
    event_id:           eventId,
    type:               body?.type,
    label:              rowData.label,
    camera_key:         cameraKey,
    camera_location:    cameraLocationLabel,
    brivo_cross_ref:    eventLinkedToBrivo,
  });
});
