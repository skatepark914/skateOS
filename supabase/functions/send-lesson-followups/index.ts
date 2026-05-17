// ============================================================
// send-lesson-followups — Supabase Edge Function (Deno)
//
// Fires hourly (via pg_cron from migration 038, default :15 past).
// Finds lessons that were attended within the configured window
// (default 2–48 hours ago) and have NOT yet had a follow-up sent,
// then emails the skater (or guardian email for minors) a one-shot:
//   • "How was your lesson?" with a Google review link
//   • Optional "Tip your instructor" link (Venmo / CashApp / etc)
//
// Idempotency: stamps `lessons.followup_sent_at` after a successful
// send so subsequent cron runs skip already-followed-up rows.
//
// CAN-SPAM: respects `customers.email_opt_out_at` (migration 035) and
// includes an unsubscribe footer with the per-customer URL.
//
// All copy + URLs + windows are owner-tunable via the `app_settings`
// row with key='followups' (JSONB). Falls back to sane defaults so
// it works the moment the migration lands, before Doug touches Settings.
//
// Setup:
//   1. Apply migration 038_lesson_followups.sql
//   2. Deploy: bash admin/deploy-functions.sh
//   3. Configure in admin Settings → Follow-ups (review URL, tip URL,
//      enable/disable, edit copy)
//   4. Manual fire: curl -X POST https://...functions/v1/send-lesson-followups
//      -H "Authorization: Bearer <service-role>"
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

async function postEmail(payload: any): Promise<{ ok: boolean; error?: string }> {
  const url = Deno.env.get("SUPABASE_URL") + "/functions/v1/send-email";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(payload),
  }).catch((e) => ({ ok: false, _err: String(e) } as any));
  if (!r || (r as any)._err) return { ok: false, error: (r as any)?._err || "fetch failed" };
  const data = await (r as Response).json().catch(() => ({}));
  if (!(r as Response).ok || !(data as any).ok) {
    return { ok: false, error: (data as any).error || `HTTP ${(r as Response).status}` };
  }
  return { ok: true };
}

function escHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

// Renders {{first}} {{biz}} {{instructor}} {{review_url}} {{tip_url}} placeholders.
function tmpl(s: string, vars: Record<string, string>): string {
  return String(s || "").replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = admin();

  // --- Optional per-lesson override (manual fire from admin) ---
  // POST body { lesson_id: "uuid" } skips the window check and fires for that
  // one row only. Still respects opt-outs + idempotency. Used by the
  // "Send follow-up" button on the lesson modal.
  let manualLessonId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof (body as any).lesson_id === "string") {
        manualLessonId = (body as any).lesson_id;
      }
    } catch (_e) { /* empty body — normal cron call */ }
  }

  // --- Read owner config ---
  const { data: cfgRow } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", "followups")
    .maybeSingle();
  const cfg = (cfgRow?.value ?? {}) as any;

  const enabled       = cfg.enabled !== false;
  if (!enabled && !manualLessonId) {
    // Manual fires bypass the master toggle — owner has explicitly clicked the button.
    return jsonResponse({ ok: true, skipped: true, reason: "followups disabled in Settings" });
  }

  const reviewUrl     = String(cfg.review_url || "").trim();
  const tipEnabled    = cfg.tip_enabled === true;
  const tipUrl        = String(cfg.tip_url || "").trim();
  const windowMinH    = Math.max(0, Number(cfg.window_min_h ?? 2));
  const windowMaxH    = Math.max(windowMinH + 1, Number(cfg.window_max_h ?? 48));
  const minPrice      = Math.max(0, Number(cfg.min_lesson_price ?? 0));
  const subjectTmpl   = String(cfg.subject || "How was your lesson at {{biz}}?");
  const bodyTmpl      = String(cfg.body_html || "");  // empty = use built-in template

  if (!reviewUrl && !tipEnabled) {
    return jsonResponse({ ok: true, skipped: true, reason: "no review_url and tips disabled — nothing to send" });
  }

  const bizName  = Deno.env.get("BIZ_NAME") || "2nd Nature Park";
  const appBase  = (Deno.env.get("APP_BASE_URL") || "https://app.skateos.com").replace(/\/+$/, "");

  // --- Find candidate lessons ---
  const nowMs    = Date.now();
  const earliest = new Date(nowMs - windowMaxH * 3600_000).toISOString();
  const latest   = new Date(nowMs - windowMinH * 3600_000).toISOString();

  let query = sb
    .from("lessons")
    .select("id,customer_id,instructor,type,price,attended_at,followup_sent_at,scheduled_at")
    .not("attended_at", "is", null)
    .is("followup_sent_at", null);

  if (manualLessonId) {
    // Manual fire — single lesson, skip the window
    query = query.eq("id", manualLessonId);
  } else {
    query = query
      .gte("attended_at", earliest)
      .lte("attended_at", latest)
      .order("attended_at", { ascending: true })
      .limit(200);
  }

  const { data: candidates, error: lErr } = await query;

  if (lErr) {
    return jsonResponse({ ok: false, error: "lesson fetch failed: " + lErr.message }, 502);
  }
  if (!candidates || candidates.length === 0) {
    return jsonResponse({ ok: true, sent: 0, skipped: 0, candidates: 0, message: "No lessons in window." });
  }

  const sent: any[] = [];
  const skipped: any[] = [];
  const failed: any[] = [];

  for (const l of candidates) {
    if (!manualLessonId && minPrice > 0 && Number(l.price ?? 0) < minPrice) {
      skipped.push({ id: l.id, reason: "below min_lesson_price" });
      continue;
    }

    // Lookup customer (skip when no email or opted out)
    const { data: c } = await sb
      .from("customers")
      .select("id,name,first_name,email,parent_email,email_opt_out_at,dob")
      .eq("id", l.customer_id)
      .maybeSingle();
    if (!c) { skipped.push({ id: l.id, reason: "no customer" }); continue; }
    if (c.email_opt_out_at) { skipped.push({ id: l.id, reason: "email opted out" }); continue; }

    // Prefer parent_email when minor (assume <18 from dob); otherwise customer email
    let toEmail = c.email;
    try {
      if (c.dob && c.parent_email) {
        const age = Math.floor((nowMs - new Date(c.dob).getTime()) / (365.25 * 86400_000));
        if (age < 18) toEmail = c.parent_email;
      }
    } catch (_e) { /* dob parse failed — fall back to customer email */ }
    if (!toEmail) { skipped.push({ id: l.id, reason: "no email" }); continue; }

    const first = c.first_name || (c.name ? c.name.split(" ")[0] : "skater");
    const vars: Record<string, string> = {
      first:      escHtml(first),
      biz:        escHtml(bizName),
      instructor: escHtml(l.instructor || "your instructor"),
      review_url: reviewUrl,
      tip_url:    tipUrl,
    };

    const subject = tmpl(subjectTmpl, vars);

    let html: string;
    if (bodyTmpl) {
      html = tmpl(bodyTmpl, vars);
    } else {
      // Built-in default template — clean rose-themed HTML.
      const reviewBlock = reviewUrl ? `
        <p style="margin:0 0 16px;">If you had a great time, would you mind leaving us a quick review? It helps other skaters find us — and it makes our day.</p>
        <div style="text-align:center;margin:24px 0 8px;">
          <a href="${reviewUrl}" style="display:inline-block;padding:12px 28px;background:#e11d48;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">⭐ Leave a review</a>
        </div>` : "";
      const tipBlock = (tipEnabled && tipUrl) ? `
        <hr style="margin:24px 0 18px;border:none;border-top:1px solid #f3f4f6;">
        <p style="margin:0 0 12px;font-size:14px;color:#374151;">Want to tip ${vars.instructor}? Totally optional, always appreciated.</p>
        <div style="text-align:center;margin:8px 0;">
          <a href="${tipUrl}" style="display:inline-block;padding:10px 22px;background:#15803d;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">💚 Send a tip</a>
        </div>` : "";
      const unsubUrl = `${appBase}/admin/unsubscribe.html?cid=${encodeURIComponent(c.id)}`;
      html = `
<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#f9fafb;padding:20px;color:#14161a;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    <div style="background:linear-gradient(135deg,#be123c,#e11d48);color:#fff;padding:28px 24px;text-align:center;">
      <div style="font-size:38px;line-height:1;">🛹</div>
      <div style="font-size:22px;font-weight:900;margin-top:10px;">Thanks for skating, ${vars.first}!</div>
    </div>
    <div style="padding:26px 24px;font-size:15px;line-height:1.6;color:#374151;">
      <p style="margin:0 0 16px;">Hope you crushed it with ${vars.instructor} today.</p>
      ${reviewBlock}
      ${tipBlock}
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">— ${vars.biz}</p>
      <hr style="margin-top:18px;border:none;border-top:1px solid #f3f4f6;">
      <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;">Don't want post-lesson emails? <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe</a>.</p>
    </div>
  </div>
</div>`;
    }

    const result = await postEmail({
      to: toEmail,
      subject,
      html,
      tags: [
        { name: "type",        value: "lesson-followup" },
        { name: "lesson_id",   value: l.id },
        { name: "customer_id", value: c.id },
      ],
    });

    if (!result.ok) {
      failed.push({ lesson_id: l.id, customer_id: c.id, email: toEmail, error: result.error });
      continue;
    }

    // Stamp idempotency column
    const { error: stampErr } = await sb
      .from("lessons")
      .update({ followup_sent_at: new Date().toISOString() })
      .eq("id", l.id);
    if (stampErr) {
      // Email already sent — log the stamp failure but count as sent so the customer
      // doesn't get hit twice on the next cron run if we panic and retry.
      console.warn("followup stamp failed for lesson", l.id, stampErr.message);
    }
    sent.push({ lesson_id: l.id, customer_id: c.id, email: toEmail });
  }

  return jsonResponse({
    ok: true,
    candidates: candidates.length,
    sent: sent.length,
    skipped: skipped.length,
    failed: failed.length,
    sent_detail: sent,
    skipped_detail: skipped,
    failures: failed,
    config: { reviewUrl, tipEnabled, tipUrl, windowMinH, windowMaxH, minPrice },
  });
});
