// ============================================================
// birthday-greetings — Supabase Edge Function (Deno)
//
// Fires daily (via pg_cron, default 8am ET = 13:00 UTC) and emails
// every customer whose `dob` matches today's month+day a friendly
// "happy birthday — free pass on us" message via the send-email
// function (which proxies Resend).
//
// Idempotent within a calendar day: stamps `customers.last_birthday_email_at`
// after a successful send so re-runs the same day skip already-greeted skaters.
// (That column is added by migration 033 — the function tolerates its absence
// and fires every time until Doug applies the migration.)
//
// Setup:
//   1. Deploy: bash admin/deploy-functions.sh
//   2. Schedule via pg_cron — see migrations/033 for the SQL.
//   3. Manual fire: curl -X POST https://...functions/v1/birthday-greetings
//      -H "Authorization: Bearer <service-role>"
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = admin();
  const today = new Date();
  // Compose today's MM-DD in ET — we don't need precision since dob is a DATE.
  const tzOffsetMs = 4 * 3600 * 1000; // EDT-ish; close enough for greeting framing
  const localToday = new Date(today.getTime() - tzOffsetMs);
  const mm = String(localToday.getMonth() + 1).padStart(2, "0");
  const dd = String(localToday.getDate()).padStart(2, "0");

  // Pull customers whose dob month+day matches today. PostgREST doesn't have
  // a tidy `EXTRACT()` predicate, so we query everyone with dob set + an email
  // and filter in TS. At skatepark scale this is fine.
  const { data: candidates, error: candErr } = await sb
    .from("customers")
    .select("id,name,first_name,email,dob,last_birthday_email_at,email_opt_out_at")
    .not("dob", "is", null)
    .not("email", "is", null)
    .is("email_opt_out_at", null);   // CAN-SPAM: respect opt-outs (migration 035)

  if (candErr) {
    return new Response(JSON.stringify({ ok: false, error: "fetch failed: " + candErr.message }), {
      status: 502, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const todayIso = localToday.toISOString().slice(0, 10);
  const matches = (candidates || []).filter((c: any) => {
    if (!c.dob) return false;
    const [_y, m, d] = c.dob.split("-");
    if (m !== mm || d !== dd) return false;
    // Idempotency: skip if we already sent today
    if (c.last_birthday_email_at) {
      const sentDay = new Date(c.last_birthday_email_at).toISOString().slice(0, 10);
      if (sentDay === todayIso) return false;
    }
    return true;
  });

  if (!matches.length) {
    return new Response(JSON.stringify({
      ok: true,
      sent: [],
      candidates: candidates?.length || 0,
      matches: 0,
      message: "No birthdays today.",
    }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  }

  const ownerEmail = Deno.env.get("OWNER_EMAIL") || "info@2ntr.com";
  const bizName = Deno.env.get("BIZ_NAME") || "2nd Nature Park";
  const sendUrl = Deno.env.get("SUPABASE_URL") + "/functions/v1/send-email";

  const sent: any[] = [];
  const failed: any[] = [];

  const appBase = (Deno.env.get("APP_BASE_URL") || "https://app.skateos.com").replace(/\/+$/, "");
  for (const c of matches) {
    const first = c.first_name || (c.name ? c.name.split(" ")[0] : "skater");
    const subject = `🎂 Happy birthday from ${bizName}!`;
    const unsubUrl = `${appBase}/admin/unsubscribe.html?cid=${encodeURIComponent(c.id)}`;
    const html = `
<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#f9fafb;padding:20px;color:#14161a;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    <div style="background:linear-gradient(135deg,#be123c,#e11d48);color:#fff;padding:32px 24px;text-align:center;">
      <div style="font-size:48px;line-height:1;">🎂</div>
      <div style="font-size:24px;font-weight:900;margin-top:12px;">Happy birthday, ${first}!</div>
    </div>
    <div style="padding:28px 24px;font-size:15px;line-height:1.6;color:#374151;">
      <p style="margin:0 0 16px;">Hope you're having a great day. From all of us at <strong>${bizName}</strong>, we wanted to say <strong>thanks for skating with us</strong>.</p>
      <p style="margin:0 0 16px;">Drop by anytime this month and we'll comp your session — just mention this email at the front desk.</p>
      <div style="text-align:center;margin:28px 0 8px;">
        <a href="${appBase}" style="display:inline-block;padding:12px 28px;background:#e11d48;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">See you at the park →</a>
      </div>
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">— ${bizName}</p>
      <hr style="margin-top:18px;border:none;border-top:1px solid #f3f4f6;">
      <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;">Don’t want birthday emails? <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe</a>.</p>
    </div>
  </div>
</div>`;

    try {
      const resp = await fetch(sendUrl, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          to: c.email,
          subject,
          html,
          tags: [{ name: "type", value: "birthday" }, { name: "customer_id", value: c.id }],
        }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok || !(body as any).ok) {
        failed.push({ id: c.id, email: c.email, error: (body as any).error || "HTTP " + resp.status });
        continue;
      }
      // Stamp idempotency column — silent if migration 033 hasn't run yet
      await sb.from("customers").update({ last_birthday_email_at: new Date().toISOString() }).eq("id", c.id).then((r: any) => {
        if (r.error && !/last_birthday_email_at.*does not exist/i.test(r.error.message || "")) {
          console.warn("Stamp failed:", r.error.message);
        }
      });
      sent.push({ id: c.id, email: c.email });
    } catch (e: any) {
      failed.push({ id: c.id, email: c.email, error: e?.message || String(e) });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    today: todayIso,
    candidates: candidates?.length || 0,
    matches: matches.length,
    sent: sent.length,
    failed: failed.length,
    failures: failed,
    biz: bizName,
    owner: ownerEmail,
  }), { headers: { ...corsHeaders, "content-type": "application/json" } });
});
