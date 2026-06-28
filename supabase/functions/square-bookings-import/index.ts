// ============================================================
// square-bookings-import — pull Square Appointments → skateOS lessons
//
// Square sees: customer Joe books 4pm Saturday with Doug for a 60-min
// Private Lesson. Goes into Square Appointments. Until now, skateOS
// had no idea — calendar empty, customer portal empty.
//
// This function:
//   1. Fetches /v2/bookings/search filtered by start_at window
//   2. Fetches /v2/team-members so we can resolve seller IDs → names
//   3. (Optionally) /v2/catalog/list?types=ITEM,ITEM_VARIATION for service names
//   4. For each booking:
//      a. Skip if square_booking_id already in lessons (dedupe via unique idx)
//      b. Lookup customer by square_customer_id
//      c. Resolve instructor display name from team_member_id
//      d. Derive lesson type from service name (private/group/camp/etc)
//      e. Map booking.status → lesson status
//      f. Insert lesson with square_booking_id tag
//
// Request:
//   { action: 'preview' | 'commit',
//     since: '2026-01-01',    // optional, defaults to 90 days ago
//     until: '2027-12-31' }   // optional, defaults to 365 days from now
//
// Response: { ok, summary: { fetched, inserted, skipped, failed }, sample? }
// ============================================================

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-12-18";

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

async function sq(method: "GET" | "POST", path: string, token: string, body?: unknown) {
  const r = await fetch(SQUARE_BASE + path, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let json: any;
  try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
  if (!r.ok) {
    throw new Error(`Square ${method} ${path} ${r.status}: ${txt.slice(0, 300)}`);
  }
  return json;
}

// Map a service name → skateOS lesson type
function classifyLessonType(svcName: string): string {
  const n = (svcName || "").toLowerCase();
  if (/birthday|party/.test(n)) return "birthday";
  if (/camp/.test(n)) return "camp";
  if (/group|class/.test(n)) return "group";
  if (/event/.test(n)) return "event";
  return "private";  // default + Square's "Private Skateboard Lesson" pattern
}

// Map Square booking.status → skateOS lessons.status
function classifyStatus(sqStatus: string): string {
  switch ((sqStatus || "").toUpperCase()) {
    case "ACCEPTED":
    case "PENDING":               return "scheduled";
    case "NO_SHOW":               return "no_show";
    case "CANCELLED_BY_CUSTOMER":
    case "CANCELLED_BY_SELLER":
    case "DECLINED":              return "cancelled";
    default:                      return "scheduled";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sqToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
  if (!sqToken) {
    return jsonResponse({ ok: false, error: "SQUARE_ACCESS_TOKEN not set" }, 500);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action: "preview" | "commit" = body?.action === "commit" ? "commit" : "preview";

  const now = new Date();
  const sinceIso = body?.since
    ? new Date(body.since).toISOString()
    : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const untilIso = body?.until
    ? new Date(body.until).toISOString()
    : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    // Pre-fetch team-members map (id → display_name)
    let teamMap: Record<string, string> = {};
    try {
      const tm = await sq("POST", "/v2/team-members/search", sqToken, {
        query: { filter: { status: "ACTIVE" } },
        limit: 100,
      });
      (tm.team_members || []).forEach((t: any) => {
        const name = [t.given_name, t.family_name].filter(Boolean).join(" ").trim()
          || t.email_address || t.id;
        teamMap[t.id] = name;
      });
    } catch (_e) {
      // Fallback to GET endpoint if search isn't allowed at this tier
      try {
        const tm = await sq("GET", "/v2/team-members", sqToken);
        (tm.team_members || []).forEach((t: any) => {
          const name = [t.given_name, t.family_name].filter(Boolean).join(" ").trim()
            || t.email_address || t.id;
          teamMap[t.id] = name;
        });
      } catch (_e2) { /* fallback to raw ID below */ }
    }

    // Pre-fetch catalog (services) map: variation_id → service_name
    let serviceMap: Record<string, string> = {};
    try {
      let cursor: string | undefined;
      let pages = 0;
      do {
        pages++;
        if (pages > 20) break;
        const qs = new URLSearchParams({ types: "ITEM_VARIATION" });
        if (cursor) qs.set("cursor", cursor);
        const r = await sq("GET", `/v2/catalog/list?${qs.toString()}`, sqToken);
        (r.objects || []).forEach((o: any) => {
          if (o.id && o?.item_variation_data?.name) {
            serviceMap[o.id] = o.item_variation_data.name;
          }
        });
        cursor = r.cursor;
      } while (cursor);
    } catch (_e) { /* fallback */ }

    // Square's /v2/bookings caps each call at 31 days, so walk the window
    // in 30-day chunks. Each chunk paginates via cursor for up to 5 pages
    // (more than enough — 500 bookings per chunk).
    const allBookings: any[] = [];
    const winStart = new Date(sinceIso);
    const winEnd = new Date(untilIso);
    let chunkStart = winStart;
    let totalChunks = 0;
    while (chunkStart < winEnd) {
      totalChunks++;
      if (totalChunks > 60) break; // safety: ~5 years
      const chunkEnd = new Date(chunkStart.getTime() + 30 * 24 * 60 * 60 * 1000);
      const sliceEnd = chunkEnd > winEnd ? winEnd : chunkEnd;
      let cursor: string | undefined;
      let pages = 0;
      do {
        pages++;
        if (pages > 5) break;
        const qs = new URLSearchParams({
          limit: "100",
          start_at_min: chunkStart.toISOString(),
          start_at_max: sliceEnd.toISOString(),
        });
        if (cursor) qs.set("cursor", cursor);
        const r = await sq("GET", `/v2/bookings?${qs.toString()}`, sqToken);
        const list = r.bookings || [];
        allBookings.push(...list);
        cursor = r.cursor;
        if (!cursor) break;
      } while (cursor);
      chunkStart = sliceEnd;
    }

    const summary: any = {
      window: { since: sinceIso, until: untilIso },
      fetched: allBookings.length,
      team_members_resolved: Object.keys(teamMap).length,
      services_resolved: Object.keys(serviceMap).length,
    };

    if (action === "preview") {
      summary.sample = allBookings.slice(0, 5).map((b: any) => {
        const seg = (b.appointment_segments || [])[0] || {};
        return {
          id: b.id,
          start_at: b.start_at,
          status: b.status,
          customer_id: b.customer_id,
          team_member_id: seg.team_member_id,
          team_member: teamMap[seg.team_member_id] || seg.team_member_id,
          service_variation_id: seg.service_variation_id,
          service: serviceMap[seg.service_variation_id] || "(unknown service)",
          duration_min: seg.duration_minutes,
        };
      });
      return jsonResponse({ ok: true, summary });
    }

    // COMMIT path — pre-fetch dedupe set + customer/staff lookups
    const bookingIds = allBookings.map(b => b.id).filter(Boolean);
    const existingIds = new Set<string>();
    for (let i = 0; i < bookingIds.length; i += 200) {
      const batch = bookingIds.slice(i, i + 200);
      const { data } = await sb.from("lessons")
        .select("square_booking_id")
        .in("square_booking_id", batch);
      (data || []).forEach((r: any) => existingIds.add(r.square_booking_id));
    }

    // Customer lookup map: square_customer_id → { id, name }
    const sqCustIds = Array.from(new Set(allBookings.map(b => b.customer_id).filter(Boolean)));
    const custMap = new Map<string, { id: string; name: string }>();
    for (let i = 0; i < sqCustIds.length; i += 200) {
      const batch = sqCustIds.slice(i, i + 200);
      const { data } = await sb.from("customers")
        .select("id, name, square_customer_id")
        .in("square_customer_id", batch);
      (data || []).forEach((c: any) => {
        if (c.square_customer_id) custMap.set(c.square_customer_id, { id: c.id, name: c.name });
      });
    }

    let inserted = 0, skipped = 0, failed = 0;
    const failures: string[] = [];

    for (const b of allBookings) {
      try {
        if (!b.id) { skipped++; continue; }
        if (existingIds.has(b.id)) { skipped++; continue; }

        const seg = (b.appointment_segments || [])[0] || {};
        const customer = b.customer_id ? custMap.get(b.customer_id) : undefined;
        const instructorName = teamMap[seg.team_member_id] || null;
        const serviceName = serviceMap[seg.service_variation_id] || "";
        const lessonType = classifyLessonType(serviceName);
        const durationMin = Number(seg.duration_minutes) || 60;
        const status = classifyStatus(b.status);

        // Skip if no customer link AND no instructor — can't make a useful row
        if (!customer && !instructorName) { skipped++; continue; }

        const customerNote = (b.customer_note || "").trim();
        const sellerNote = (b.seller_note || "").trim();
        const notesParts = [`[Imported from Square Appointments]`];
        if (serviceName) notesParts.push(`Service: ${serviceName}`);
        if (customerNote) notesParts.push(`Customer note: ${customerNote}`);
        if (sellerNote) notesParts.push(`Seller note: ${sellerNote}`);

        const row: any = {
          square_booking_id: b.id,
          customer_id: customer?.id || null,
          instructor: instructorName,
          type: lessonType,
          scheduled_at: b.start_at,
          duration_min: durationMin,
          status,
          notes: notesParts.join(" · "),
        };

        const { error } = await sb.from("lessons").insert(row);
        if (error) {
          if (String(error.message || "").toLowerCase().includes("duplicate")) {
            skipped++;
          } else {
            failed++;
            failures.push(`${b.id}: ${error.message}`);
          }
        } else {
          inserted++;
        }
      } catch (e) {
        failed++;
        failures.push(`${b.id}: ${(e as Error).message}`);
      }
    }

    summary.inserted = inserted;
    summary.skipped = skipped;
    summary.failed = failed;
    if (failures.length > 0) summary.failures_sample = failures.slice(0, 5);

    return jsonResponse({ ok: true, summary });
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error).message }, 500);
  }
});
