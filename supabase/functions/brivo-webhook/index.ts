// ============================================================
// brivo-webhook — receive door access events from Brivo
// ============================================================
// Configure in Brivo dashboard → API Management → Webhooks:
//   URL:     https://zecurmlenxyxanqucrga.supabase.co/functions/v1/brivo-webhook
//   Events:  access_granted, access_denied, door_held_open, door_forced
//   Secret:  set BRIVO_WEBHOOK_SECRET via supabase secrets (HMAC-SHA256)
//
// On access_granted at the park door:
//   • Insert brivo_access_log row (audit trail)
//   • Cross-reference brivo_user_id → customer via customers table
//   • Auto-open a checkins row if the customer isn't already in the park
//     and door grant happened in the last 5 min (24/7 member auto-checkin)
//   • Write webhook_log entry
//
// Configure in supabase secrets:
//   BRIVO_WEBHOOK_SECRET             — HMAC verifier shared with Brivo
//   BRIVO_PARK_DOOR_AP_ID            — numeric access point id (park door)
//   BRIVO_SHOP_DOOR_AP_ID            — numeric access point id (shop door)
//   BRIVO_AUTO_CHECKIN_ENABLED       — "true" to auto-create checkins row
//                                       (default: true; set "false" to disable)
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyBrivoSignature, loadBrivoEnvForTenant } from "../_brivo/api.ts";

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function classifyDoor(apId: string | null | undefined): "park_door" | "shop_door" | "other" {
  if (!apId) return "other";
  if (apId === Deno.env.get("BRIVO_PARK_DOOR_AP_ID")) return "park_door";
  if (apId === Deno.env.get("BRIVO_SHOP_DOOR_AP_ID")) return "shop_door";
  return "other";
}

function classifyEventType(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  const s = String(raw).toLowerCase();
  if (s.includes("granted") || s.includes("permitted") || s.includes("access ok"))  return "access_granted";
  if (s.includes("denied")  || s.includes("rejected"))                              return "access_denied";
  if (s.includes("held"))                                                            return "door_held_open";
  if (s.includes("forced") || s.includes("breach"))                                  return "door_forced";
  // Face recognition events from Brivo BDS / Mullion cameras when enabled
  // in Brivo dashboard. Falls into one of three buckets:
  //   - face_matched: a face matched an enrolled Brivo user → likely auto-unlock
  //   - face_unknown: a face was detected but didn't match anyone enrolled
  //   - face_enrolled: a new face was enrolled (admin action, not a door event)
  if (s.includes("face") && (s.includes("match") || s.includes("recogniz"))) return "face_matched";
  if (s.includes("face") && s.includes("unknown"))                            return "face_unknown";
  if (s.includes("face") && s.includes("enroll"))                             return "face_enrolled";
  // Video events — Brivo can fire when a clip is ready for an associated event
  if (s.includes("video") || s.includes("clip"))                              return "video_clip";
  // Intercom events — BDS doorbell press
  if (s.includes("intercom") || s.includes("doorbell") || s.includes("call")) return "intercom_call";
  return s;
}

// Extract a video clip URL or snapshot thumbnail from a Brivo webhook payload.
// Brivo's exact field naming varies by tier — we look in the common spots.
function extractVideoUrl(body: any): { videoUrl: string | null; thumbUrl: string | null } {
  const videoUrl = body?.videoUrl
              || body?.video_url
              || body?.clipUrl
              || body?.clip_url
              || body?.videoClip?.url
              || body?.media?.video
              || null;
  const thumbUrl = body?.thumbnailUrl
              || body?.thumbnail_url
              || body?.snapshotUrl
              || body?.snapshot_url
              || body?.videoClip?.thumbnail
              || body?.media?.thumbnail
              || null;
  return { videoUrl, thumbUrl };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const raw = await req.text();
  const ipAddr = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  // Extract an explicit tenant routing hint, if Brivo posts include it.
  // Per-tenant URL pattern: /functions/v1/brivo-webhook?tenant=<uuid>
  // OR header: x-skateos-tenant: <uuid>
  // When present, we skip the customer-lookup dance during signature
  // verification — we go straight to that tenant's webhook_secret.
  const url = new URL(req.url);
  const explicitTenantId = url.searchParams.get("tenant")
                        || req.headers.get("x-skateos-tenant")
                        || null;

  // Parse the body first so we can extract brivo_user_id for tenant lookup
  // BEFORE signature verification. The brivo_user_id alone is not yet trusted
  // (signature hasn't been verified) — we use it only to pick which secret
  // to try. The actual cryptographic check happens below; nothing downstream
  // trusts the body until that passes.
  let body: any;
  try { body = JSON.parse(raw); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const sb = admin();

  // ── Signature verification (mig 069 multi-tenant aware) ────
  // Resolution order:
  //   0. EXPLICIT TENANT (query/header) → load that tenant's webhook_secret.
  //      Used by per-tenant webhook URLs. Falls through to (1) if no row.
  //   1. Try BRIVO_WEBHOOK_SECRET env var (single-tenant install, 2nd Nature)
  //   2. If env not set OR sig fails, look up brivo_user_id → customer →
  //      tenant_id → tenant_brivo_config.webhook_secret. Try that.
  //   3. If all fail, reject.
  // This works for: env-only installs, multi-tenant installs with per-tenant
  // URLs (cleanest — explicit routing), and multi-tenant installs that share
  // a single endpoint (fallback dance via customer lookup).
  const envSecret = Deno.env.get("BRIVO_WEBHOOK_SECRET");
  const sig = req.headers.get("x-brivo-signature")
           || req.headers.get("brivo-signature")
           || req.headers.get("webhook-signature")
           || "";
  let signatureValid = false;
  let signatureSource: "env" | "tenant_explicit" | "tenant_via_customer" | "none" = "none";
  let resolvedTenantId: string | null = null;

  // Step 0 — explicit tenant routing
  if (explicitTenantId && sig) {
    try {
      const tenantEnv = await loadBrivoEnvForTenant(sb, explicitTenantId);
      if (tenantEnv?.webhookSecret && await verifyBrivoSignature(raw, sig, tenantEnv.webhookSecret)) {
        signatureValid = true;
        signatureSource = "tenant_explicit";
        resolvedTenantId = explicitTenantId;
      }
    } catch (e) {
      console.warn("explicit tenant secret lookup failed:", e);
    }
  }

  // Step 1 — env var fallback
  if (!signatureValid && envSecret && sig) {
    if (await verifyBrivoSignature(raw, sig, envSecret)) {
      signatureValid = true;
      signatureSource = "env";
    }
  }

  // Step 2 — customer-lookup-based tenant resolution
  if (!signatureValid && sig) {
    const candidateUserId = body?.userId ? String(body.userId)
                          : body?.user?.id ? String(body.user.id) : null;
    if (candidateUserId) {
      try {
        const { data: cust } = await sb.from("customers")
          .select("tenant_id")
          .eq("brivo_user_id", candidateUserId)
          .maybeSingle();
        if (cust?.tenant_id) {
          const tenantEnv = await loadBrivoEnvForTenant(sb, cust.tenant_id);
          if (tenantEnv?.webhookSecret && await verifyBrivoSignature(raw, sig, tenantEnv.webhookSecret)) {
            signatureValid = true;
            signatureSource = "tenant_via_customer";
            resolvedTenantId = cust.tenant_id;
          }
        }
      } catch (e) {
        console.warn("tenant secret lookup failed:", e);
      }
    }
  }

  // If a signature was sent AND we have any secret configured anywhere, the
  // signature MUST verify. If no secrets are configured at all, accept
  // (URL-obscurity model — same as helcim-webhook for unconfigured deploys).
  if (sig && !signatureValid) {
    await sb.from("webhook_log").insert({
      source:     "brivo",
      event_type: "signature_check",
      status:     "signature_mismatch",
      payload:    {
        raw_len: raw.length,
        headers_seen: ["x-brivo-signature", "brivo-signature", "webhook-signature"],
        env_secret_set: !!envSecret,
        explicit_tenant: explicitTenantId,
      },
      ip_address: ipAddr,
    }).catch(() => {});
    return new Response("Bad signature", { status: 401 });
  }
  // If no signature header at all + a secret is configured, reject (someone's
  // posting without auth)
  if (!sig && (envSecret || explicitTenantId)) {
    return new Response("Signature required", { status: 401 });
  }

  // Brivo's webhook payload shape (per ACS docs):
  //   { id, eventType, occurredOn, accessPointId, userId, ... }
  // Tolerate a few field-name variants since the exact shape can vary
  // by Brivo account tier / API version.
  const eventId       = body?.id ? String(body.id) : (body?.eventId ? String(body.eventId) : null);
  const eventTypeRaw  = body?.eventType || body?.type || body?.action || null;
  const occurredOn    = body?.occurredOn || body?.occurredAt || body?.dateCreated || new Date().toISOString();
  const accessPointId = body?.accessPointId ? String(body.accessPointId)
                      : body?.accessPoint?.id ? String(body.accessPoint.id)
                      : null;
  const brivoUserId   = body?.userId ? String(body.userId)
                      : body?.user?.id ? String(body.user.id) : null;

  const accessPoint = classifyDoor(accessPointId);
  const eventType   = classifyEventType(eventTypeRaw);

  // Initial received log
  let logId: string | null = null;
  try {
    const ins = await sb.from("webhook_log").insert({
      source:     "brivo",
      event_type: eventType,
      event_id:   eventId,
      status:     "received",
      payload:    body,
      ip_address: ipAddr,
    }).select("id").single();
    logId = (ins.data as any)?.id ?? null;
  } catch (e) {
    console.warn("brivo webhook log insert failed:", e);
  }

  let outcomeStatus: "processed" | "error" | "ignored" = "processed";
  let errorMessage: string | null = null;
  let refId: string | null = null;
  let customerId: string | null = null;
  let didCheckin = false;

  try {
    // Cross-reference brivo_user_id → skateOS customer (if any)
    if (brivoUserId) {
      const { data: c } = await sb
        .from("customers")
        .select("id, name, tenant_id")
        .eq("brivo_user_id", brivoUserId)
        .maybeSingle();
      if (c?.id) {
        customerId = c.id;

        // Always insert the access event audit row
        const tenantId = c.tenant_id || null;
        const accIns = await sb.from("brivo_access_log").insert({
          tenant_id:       tenantId,
          brivo_event_id:  eventId,
          brivo_user_id:   brivoUserId,
          customer_id:     customerId,
          access_point:    accessPoint,
          access_point_id: accessPointId,
          event_type:      eventType,
          occurred_at:     occurredOn,
          raw_payload:     body,
        }).select("id").maybeSingle();
        refId = (accIns.data as any)?.id ?? null;

        // Auto-checkin on park door grant — only if not already checked in.
        // Includes face_matched events: when face recognition is enabled and
        // a face matches an enrolled Brivo user, that's effectively the same
        // signal as an access_granted (identified human at the door).
        const autoEnabled = (Deno.env.get("BRIVO_AUTO_CHECKIN_ENABLED") ?? "true") !== "false";
        const isGrantEvent = eventType === "access_granted" || eventType === "face_matched";

        // Capacity-aware alert: when a Brivo grant fires while the park is
        // already at/over maxCapacity, post a Team Chat reminder so staff can
        // monitor + decide whether to ask the late entrant to wait. Configured
        // via app_settings.value.maxCapacity (set to 0 to disable). Idempotent
        // per-hour window so we don't spam during a sustained-overflow event.
        if (isGrantEvent && accessPoint === "park_door") {
          try {
            const { data: setRow } = await sb.from("app_settings").select("value").eq("key", "all").maybeSingle();
            const maxCap = Number((setRow?.value as any)?.maxCapacity || 0);
            if (maxCap > 0) {
              const { count: openCount } = await sb.from("checkins")
                .select("id", { count: "exact", head: true })
                .is("checked_out_at", null);
              if ((openCount ?? 0) >= maxCap) {
                // Dedup: only one capacity alert per hour
                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
                const capMarker = "[brivo-capacity-overflow]";
                const { data: existing } = await sb
                  .from("team_messages")
                  .select("id")
                  .eq("kind", "reminder")
                  .gte("created_at", oneHourAgo)
                  .ilike("body", `%${capMarker}%`)
                  .limit(1);
                if (!existing || existing.length === 0) {
                  const eName = (await sb.from("customers").select("name").eq("id", customerId).maybeSingle())?.data?.name || "(unknown member)";
                  const body = `⚠️ Park at capacity (${openCount}/${maxCap}) — ${eName} just unlocked via Brivo. Monitor the floor; consider asking new arrivals to wait. ${capMarker}`;
                  await sb.from("team_messages").insert({
                    kind:           "reminder",
                    body,
                    due_at:         new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                    posted_by_name: "Brivo webhook",
                  });
                }
              }
            }
          } catch (capErr) {
            // Non-blocking — capacity alerts are advisory
            console.warn("brivo capacity alert non-fatal:", capErr);
          }
        }

        if (autoEnabled && accessPoint === "park_door" && isGrantEvent) {
          // Skip if already in the park (open checkins row in last 8h)
          const eightHoursAgo = new Date(Date.now() - 8 * 3600 * 1000).toISOString();
          const { data: openCheckins } = await sb
            .from("checkins")
            .select("id")
            .eq("customer_id", customerId)
            .is("checked_out_at", null)
            .gte("checked_in_at", eightHoursAgo)
            .limit(1);
          if (!openCheckins || openCheckins.length === 0) {
            const via = eventType === "face_matched" ? "face recognition" : "park door";
            const note = `[Auto-checked-in via Brivo ${via} ${new Date(occurredOn).toISOString()}]`;
            const ciIns = await sb.from("checkins").insert({
              customer_id:   customerId,
              tenant_id:     tenantId,
              checked_in_at: occurredOn,
              notes:         note,
            }).select("id").maybeSingle();
            didCheckin = !!ciIns.data;
          }
        }
      } else {
        // Brivo user ID we don't recognize — still log the event with
        // no customer linkage. Drift signal for brivo-sync-all.
        await sb.from("brivo_access_log").insert({
          brivo_event_id:  eventId,
          brivo_user_id:   brivoUserId,
          customer_id:     null,
          access_point:    accessPoint,
          access_point_id: accessPointId,
          event_type:      eventType,
          occurred_at:     occurredOn,
          raw_payload:     body,
        });
      }

      // ── Failed-access alert: 3+ denials in 5 min → Team Chat ──────
      // Catches lapsed memberships at the door, lost phones, banned
      // customers testing the system. One alert per customer per 30 min
      // window so we don't spam the team feed.
      if (eventType === "access_denied" && customerId) {
        try {
          const fiveAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data: recent } = await sb
            .from("brivo_access_log")
            .select("id")
            .eq("customer_id", customerId)
            .eq("event_type", "access_denied")
            .gte("occurred_at", fiveAgo);
          const denialCount = (recent?.length ?? 0);
          if (denialCount >= 3) {
            // Dedup: skip if a reminder for this customer was posted in last 30 min
            const halfHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
            const marker = `[brivo-failed-access:${customerId}]`;
            const { data: existing } = await sb
              .from("team_messages")
              .select("id")
              .eq("kind", "reminder")
              .gte("created_at", halfHourAgo)
              .ilike("body", `%${marker}%`)
              .limit(1);
            if (!existing || existing.length === 0) {
              const { data: c2 } = await sb
                .from("customers")
                .select("name, tags, brivo_credential_state")
                .eq("id", customerId)
                .maybeSingle();
              const name = c2?.name || "(unknown)";
              const stateHint = c2?.brivo_credential_state === "revoked"
                ? " · credential is REVOKED — likely expired membership or banned"
                : c2?.brivo_credential_state === "suspended"
                ? " · credential is SUSPENDED"
                : c2?.brivo_credential_state === "error"
                ? " · credential is in ERROR state"
                : "";
              const body = `⚠️ Failed park-door access · ${name} got denied ${denialCount}× in 5 min${stateHint}. Check their phone / membership / waiver. ${marker}`;
              const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();  // due in 1h
              await sb.from("team_messages").insert({
                kind:       "reminder",
                body,
                due_at:     dueAt,
                posted_by_name: "Brivo webhook",
              });
            }
          }
        } catch (alertErr) {
          // Best-effort — failed-access alert is a nice-to-have, never break
          // the webhook flow over it.
          console.warn("brivo failed-access alert non-fatal:", alertErr);
        }
      }
    } else {
      // No brivo_user_id — door-held or door-forced events may have no
      // user. Log without customer linkage.
      await sb.from("brivo_access_log").insert({
        brivo_event_id:  eventId,
        brivo_user_id:   null,
        customer_id:     null,
        access_point:    accessPoint,
        access_point_id: accessPointId,
        event_type:      eventType,
        occurred_at:     occurredOn,
        raw_payload:     body,
      });
    }
  } catch (e) {
    outcomeStatus = "error";
    errorMessage  = (e as Error).message;
    console.error("brivo webhook processing failed:", e);
  }

  // Update log row with outcome
  if (logId) {
    try {
      await sb.from("webhook_log").update({
        status:        outcomeStatus,
        ref_table:     refId ? "brivo_access_log" : null,
        ref_id:        refId,
        error_message: errorMessage,
      }).eq("id", logId);
    } catch (e) {
      console.warn("brivo webhook log update failed:", e);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    event_type: eventType,
    access_point: accessPoint,
    customer_id: customerId,
    auto_checkin: didCheckin,
  }), { headers: { "Content-Type": "application/json" } });
});
