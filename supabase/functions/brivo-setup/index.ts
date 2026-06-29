// ============================================================
// brivo-setup — one-time: create the dedicated "skateOS Active Members"
// group and grant it Park Door access on the 24/7 schedule.
// Idempotent: reuses the group if it already exists.
// Body: { group_name?, schedule_id? }  (defaults: skateOS Active Members, 24/7)
// ============================================================
import { loadBrivoEnv, brivoFetch } from "../_brivo/api.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function out(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "content-type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const env = loadBrivoEnv();
  if (!env) return out({ ok: false, error: "Brivo creds not configured." }, 500);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const groupName = String(body?.group_name || "skateOS Active Members");
  const scheduleId = Number(body?.schedule_id || 6464176); // "24/7"
  const parkDoor = Number(Deno.env.get("BRIVO_PARK_DOOR_AP_ID") || 0);
  const result: any = { groupName, scheduleId, parkDoor };

  // 1. Find or create the group
  const list = await brivoFetch(env, "/groups?pageSize=100");
  const groups = list.data?.data || list.data || [];
  let grp = Array.isArray(groups) ? groups.find((g: any) => g.name === groupName) : null;
  if (grp) {
    result.create = "already exists";
  } else {
    const cr = await brivoFetch(env, "/groups", { method: "POST", json: { name: groupName } });
    result.create = { status: cr.status, body: (cr.raw || "").slice(0, 200) };
    grp = cr.data;
  }
  const groupId = grp?.id;
  result.groupId = groupId;
  if (!groupId) { result.ok = false; result.error = "no group id"; return out(result, 502); }

  // 2. Grant Park Door access on the schedule — try documented endpoint shapes
  const tries: Array<{ p: string; j?: unknown }> = [
    { p: `/access-points/${parkDoor}/groups/${groupId}`, j: { scheduleId } },
    { p: `/groups/${groupId}/access-points/${parkDoor}`, j: { scheduleId } },
    { p: `/groups/${groupId}/access-points`, j: { accessPointId: parkDoor, scheduleId } },
    { p: `/access-points/${parkDoor}/groups`, j: { groupId, scheduleId } },
  ];
  result.assign = [];
  for (const t of tries) {
    const r = await brivoFetch(env, t.p, { method: "POST", json: t.j });
    result.assign.push({ path: t.p, status: r.status, body: (r.raw || "").slice(0, 140) });
    if (r.status >= 200 && r.status < 300) { result.assigned = true; result.assignedVia = t.p; break; }
  }
  result.ok = !!result.assigned || result.create === "already exists";
  return out(result);
});
