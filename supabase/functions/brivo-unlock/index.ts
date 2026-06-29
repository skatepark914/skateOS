// ============================================================
// brivo-unlock — remotely pulse (open) a Brivo door from skateOS.
//
// This is the "buzz someone in" / front-desk remote-open path —
// separate from member Mobile Passes (which open the door at the
// reader via Bluetooth). Calls Brivo's access-point unlock command.
//
// Body: { access_point_id?: string, actor?: string }
//   access_point_id defaults to BRIVO_PARK_DOOR_AP_ID.
//
// Tries the documented Brivo unlock endpoints in order and returns
// the first that succeeds, so it doubles as endpoint discovery.
//
// SECURITY: opening a physical door. Keep this gated (PIN / login /
// shared secret) before leaving a permanent front-desk button.
// ============================================================
import { loadBrivoEnv, brivoFetch } from "../_brivo/api.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function out(b: unknown, s = 200) {
  return new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const env = loadBrivoEnv();
  if (!env) return out({ ok: false, error: "Brivo creds not configured." }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  const apId = String(body?.access_point_id || Deno.env.get("BRIVO_PARK_DOOR_AP_ID") || "");
  if (!apId) return out({ ok: false, error: "No access point id (set BRIVO_PARK_DOOR_AP_ID or pass access_point_id)." }, 400);

  // Candidate unlock endpoints (Brivo's docs vary by tier/version).
  const tries: Array<{ p: string; j?: unknown }> = [
    { p: `/access-points/${apId}/unlock` },
    { p: `/access_points/${apId}/unlock` },
    { p: `/access-points/${apId}/control`, j: { action: "unlock" } },
    { p: `/access-points/${apId}/pulse` },
  ];

  const attempts: any[] = [];
  for (const t of tries) {
    try {
      const r = await brivoFetch(env, t.p, { method: "POST", json: t.j });
      attempts.push({ path: t.p, status: r.status, body: (r.raw || "").slice(0, 120) });
      if (r.status >= 200 && r.status < 300) {
        return out({ ok: true, opened: true, via: t.p, access_point_id: apId, actor: body?.actor || null, attempts });
      }
    } catch (e) {
      attempts.push({ path: t.p, error: String((e as Error).message) });
    }
  }
  return out({ ok: false, opened: false, access_point_id: apId, attempts }, 502);
});
