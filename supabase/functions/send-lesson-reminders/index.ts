// ============================================================
// send-lesson-reminders — Supabase Edge Function (Deno)
//
// Finds lessons scheduled 22–26 hours from now (a window so the
// hourly cron call is forgiving of timezone drift) that don't yet
// have a reminder_sent_at, and pings the customer via Resend
// email + Twilio SMS (whichever are configured).
//
// Stamps reminder_sent_at + reminder_channels on success.
//
// Setup:
//   1. Apply migration 014_lesson_reminders.sql.
//   2. Deploy: bash admin/deploy-functions.sh
//   3. (Optional) Set up pg_cron to fire hourly:
//      SELECT cron.schedule(
//        'lesson-reminders-hourly',
//        '0 * * * *',
//        $$ SELECT net.http_post(
//             url := 'https://zecurmlenxyxanqucrga.supabase.co/functions/v1/send-lesson-reminders',
//             headers := jsonb_build_object('Authorization','Bearer '||current_setting('app.settings.service_role_key', true))
//           ) $$
//      );
//   4. Or: invoke manually from admin "Send reminders now" button.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function postEmail(payload: any): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL") + "/functions/v1/send-email";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(payload),
  }).catch(() => null);
  if (!r) return false;
  const data = await r.json().catch(() => ({}));
  return r.ok && (data as any).ok === true;
}

async function postSms(payload: any): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL") + "/functions/v1/send-sms";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(payload),
  }).catch(() => null);
  if (!r) return false;
  const data = await r.json().catch(() => ({}));
  return r.ok && (data as any).ok === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = admin();
  const now = new Date();
  const lo  = new Date(now.getTime() + 22 * 3600 * 1000);
  const hi  = new Date(now.getTime() + 26 * 3600 * 1000);

  const { data: rows, error } = await sb
    .from("lessons")
    .select("id, type, scheduled_at, duration_min, instructor, customer_id, customers(id, name, email, phone, parent_email, parent_phone, parent_name, email_opt_out_at)")
    .is("reminder_sent_at", null)
    .gte("scheduled_at", lo.toISOString())
    .lte("scheduled_at", hi.toISOString())
    .in("status", ["scheduled", "confirmed"]);

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500);
  }

  const sent: Array<{ lesson_id: string; channels: string[] }> = [];
  const skipped: Array<{ lesson_id: string; reason: string }> = [];

  for (const r of rows ?? []) {
    const cust: any = (r as any).customers;
    if (!cust) {
      skipped.push({ lesson_id: r.id, reason: "no customer linked" });
      continue;
    }
    // CAN-SPAM: respect opt-out (migration 035)
    if (cust.email_opt_out_at) {
      skipped.push({ lesson_id: r.id, reason: "customer opted out of email" });
      continue;
    }
    const email = cust.email   || cust.parent_email;
    const phone = cust.phone   || cust.parent_phone;
    const name  = cust.name    || cust.parent_name || "skater";
    if (!email && !phone) {
      skipped.push({ lesson_id: r.id, reason: "no contact info" });
      continue;
    }

    const when = new Date(r.scheduled_at).toLocaleString("en-US", {
      weekday: "long", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
    });
    const lessonType = (r as any).type || "lesson";
    const subj  = "Reminder: your " + lessonType + " tomorrow at 2nd Nature Park";
    const body  = "Hi " + name + " — just a reminder that your " + lessonType +
                  " is scheduled for " + when + " at 2nd Nature Park. " +
                  "Bring your helmet, water, and waiver if not on file. See you soon!";
    // CAN-SPAM unsubscribe link — required by §7704(a)(5).
    // Customer UUID is unguessable; the migration 035 RPC handles the opt-out.
    const appBase = (Deno.env.get("APP_BASE_URL") || "https://app.skateos.com").replace(/\/+$/, "");
    const unsubUrl = appBase + "/admin/unsubscribe.html?cid=" + encodeURIComponent(cust.id);
    const html  = "<div style=\"font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#14161a;\">" +
                  "<p>Hi " + name + ",</p>" +
                  "<p>Just a reminder that your <strong>" + lessonType + "</strong> at <strong>2nd Nature Park</strong> is coming up:</p>" +
                  "<p style=\"margin:14px 0;padding:14px;background:#ffe4e6;border-left:4px solid #e11d48;border-radius:6px;font-weight:700;color:#be123c;\">" + when + "</p>" +
                  "<p>Bring your helmet, water, and waiver if not on file.</p>" +
                  "<p>Questions? Reply to this email or call us.</p>" +
                  "<p>See you soon!<br>2nd Nature Park</p>" +
                  "<hr style=\"margin-top:24px;border:none;border-top:1px solid #e5e7eb;\">" +
                  "<p style=\"font-size:11px;color:#9ca3af;\">Don’t want lesson reminders? <a href=\"" + unsubUrl + "\" style=\"color:#9ca3af;\">Unsubscribe</a>.</p>" +
                  "</div>";

    const channels: string[] = [];
    if (email) {
      const ok = await postEmail({
        to: email, subject: subj, html, text: body,
        tags: [{ name: "type", value: "lesson_reminder" }, { name: "lesson_id", value: r.id }],
      });
      if (ok) channels.push("email");
    }
    if (phone) {
      // Best-effort phone normalization. send-sms will reject if not E.164.
      const e164 = phone.startsWith("+") ? phone : ("+1" + String(phone).replace(/\D/g, ""));
      const ok = await postSms({ to: e164, body });
      if (ok) channels.push("sms");
    }

    if (channels.length) {
      await sb.from("lessons").update({
        reminder_sent_at:  new Date().toISOString(),
        reminder_channels: channels,
      }).eq("id", r.id);
      sent.push({ lesson_id: r.id, channels });
    } else {
      skipped.push({ lesson_id: r.id, reason: "all sends failed" });
    }
  }

  return jsonResponse({
    ok: true,
    window: { from: lo.toISOString(), to: hi.toISOString() },
    candidates: rows?.length ?? 0,
    sent,
    skipped,
  });
});
