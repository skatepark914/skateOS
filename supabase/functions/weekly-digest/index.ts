// ============================================================
// weekly-digest — Supabase Edge Function (Deno)
//
// Fires every Monday (via pg_cron, 13:00 UTC = ~8am ET) and emails
// the owner a WEEKLY "how is 2nd Nature doing" report:
// revenue this week vs last week, sales count, new customers,
// avg ticket, top products, lessons, + a short skateOS line.
//
// Sends via the send-email Edge Function (inherits Resend config).
// Deploy:  supabase functions deploy weekly-digest --no-verify-jwt
// Manual:  curl -X POST https://<ref>.functions.supabase.co/weekly-digest \
//            -H "Authorization: Bearer <service-role>"
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const money = (n: number) => "$" + (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const since14 = new Date(Date.now() - 14 * 864e5).toISOString();

  // Pull two weeks of completed sales in one query, split in JS
  const { data: sales } = await sb.from("sales").select("total,created_at,status").gte("created_at", since14).eq("status", "completed");
  const wk = (sales || []).filter((s: any) => s.created_at >= since7);
  const prev = (sales || []).filter((s: any) => s.created_at < since7);
  const sum = (a: any[]) => a.reduce((t, s) => t + (Number(s.total) || 0), 0);
  const revWk = sum(wk), revPrev = sum(prev);
  const delta = revPrev > 0 ? Math.round(((revWk - revPrev) / revPrev) * 100) : 0;
  const avg = wk.length ? revWk / wk.length : 0;

  // New customers this week
  const { count: newCust } = await sb.from("customers").select("id", { count: "exact", head: true }).gte("created_at", since7);
  // Lessons this week
  const { count: lessons } = await sb.from("lessons").select("id", { count: "exact", head: true }).gte("scheduled_at", since7);

  // Top products this week
  const { data: items } = await sb.from("sale_items")
    .select("total, product_id, products(name), sales!inner(created_at,status)")
    .gte("sales.created_at", since7).eq("sales.status", "completed");
  const byProd: Record<string, { rev: number; u: number }> = {};
  (items || []).forEach((it: any) => {
    const nm = it.products?.name || "—";
    byProd[nm] = byProd[nm] || { rev: 0, u: 0 };
    byProd[nm].rev += Number(it.total) || 0; byProd[nm].u += 1;
  });
  const top = Object.entries(byProd).sort((a, b) => b[1].rev - a[1].rev).slice(0, 6);

  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "→";
  const arrowColor = delta >= 0 ? "#16a34a" : "#dc2626";

  const html = `
  <div style="font-family:ui-sans-serif,system-ui,Arial,sans-serif;max-width:600px;margin:0 auto;color:#0f1115;">
    <div style="background:linear-gradient(135deg,#e11d48,#be123c);color:#fff;padding:26px 24px;border-radius:16px 16px 0 0;">
      <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.9;">skateOS · Weekly Report</div>
      <div style="font-size:24px;font-weight:900;margin-top:4px;">2nd Nature Park — last 7 days</div>
    </div>
    <div style="border:1px solid #e7e7e2;border-top:none;border-radius:0 0 16px 16px;padding:24px;">
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;">
        <div style="flex:1;min-width:150px;background:#faf9f6;border-radius:12px;padding:16px;">
          <div style="font-size:11px;color:#5b5f66;font-weight:800;text-transform:uppercase;">Revenue this week</div>
          <div style="font-size:26px;font-weight:900;">${money(revWk)}</div>
          <div style="font-size:13px;font-weight:700;color:${arrowColor};">${arrow} ${Math.abs(delta)}% vs last week (${money(revPrev)})</div>
        </div>
        <div style="flex:1;min-width:150px;background:#faf9f6;border-radius:12px;padding:16px;">
          <div style="font-size:11px;color:#5b5f66;font-weight:800;text-transform:uppercase;">Sales · Avg ticket</div>
          <div style="font-size:26px;font-weight:900;">${wk.length}</div>
          <div style="font-size:13px;color:#5b5f66;">avg ${money(avg)} · ${newCust || 0} new customers</div>
        </div>
      </div>
      <div style="font-size:13px;color:#5b5f66;margin-bottom:14px;">🎓 ${lessons || 0} lessons scheduled this week</div>
      <div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#5b5f66;margin-bottom:8px;">Top sellers</div>
      ${top.map(([nm, v]) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0ec;font-size:14px;"><span>${esc(nm).slice(0, 46)}</span><strong>${money(v.rev)} · ${v.u}u</strong></div>`).join("") || '<div style="color:#5b5f66;font-size:14px;">No sales recorded this week.</div>'}
      <div style="margin-top:22px;padding:14px 16px;background:#fff5f7;border-radius:12px;font-size:13px;color:#5b5f66;">
        <strong style="color:#0f1115;">skateOS status:</strong> platform live (admin, marketing, member signup). Setup tracker: <a href="https://skateos.com/update" style="color:#e11d48;">skateos.com/update</a>.
      </div>
      <div style="margin-top:18px;font-size:12px;color:#9aa3ad;text-align:center;">Automated weekly · skateOS · 2nd Nature Park</div>
    </div>
  </div>`;

  const ownerEmail = Deno.env.get("OWNER_EMAIL") || "info@2ntr.com";
  let sendOk = false, sendErr = "";
  try {
    const r = await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") },
      body: JSON.stringify({ to: ownerEmail, subject: `skateOS Weekly — 2nd Nature ($${Math.round(revWk).toLocaleString()} this week)`, html }),
    });
    sendOk = r.ok; if (!r.ok) sendErr = await r.text();
  } catch (e) { sendErr = (e as Error).message; }

  return new Response(JSON.stringify({ ok: sendOk, sent_to: ownerEmail, rev_week: revWk, rev_prev: revPrev, sales: wk.length, error: sendErr || undefined }), {
    headers: { ...cors, "Content-Type": "application/json" }, status: sendOk ? 200 : 500,
  });
});
