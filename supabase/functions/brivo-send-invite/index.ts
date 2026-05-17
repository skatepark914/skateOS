// ============================================================
// brivo-send-invite — manually resend Brivo Mobile Pass invite
// ============================================================
// POST { customer_id: UUID }
// Wraps brivo-sync-customer with force_invite=true so the admin
// "Resend invite" button on customer detail is one HTTP call.
// ============================================================
const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

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
  try { body = await req.json(); } catch { /* ok */ }

  const customer_id = String(body?.customer_id || "").trim();
  if (!customer_id) return jsonResponse({ ok: false, error: "customer_id required" }, 400);

  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/brivo-sync-customer`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ customer_id, force_invite: true }),
  });
  const j = await r.json().catch(() => ({}));
  return jsonResponse(j, r.status);
});
