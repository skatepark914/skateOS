// ============================================================
// send-renewal-reminders — Supabase Edge Function (Deno)
//
// Daily cron (14:00 UTC via migration 039) — finds active subscriptions
// whose end_date is within the configured lead window (default 14 days
// out, default skip if already expired) and emails the customer asking
// them to renew. Stamps `renewal_reminder_sent_at` after successful send
// so the same row doesn't get pinged twice in the same window.
//
// Manual fire (admin button): POST {} fires the same sweep immediately.
// Manual single-row fire: POST { subscription_id: "uuid" } bypasses the
// window check + skips the plan-type filter (owner explicitly clicked).
//
// CAN-SPAM: respects customers.email_opt_out_at. Renewal nudges are
// arguably transactional (member-relationship), but treat as marketing
// to be safe — the unsubscribe link goes in every send.
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

function tmpl(s: string, vars: Record<string, string>): string {
  return String(s || "").replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / 86400_000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = admin();

  // --- Optional per-subscription override (manual fire) ---
  let manualSubId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof (body as any).subscription_id === "string") {
        manualSubId = (body as any).subscription_id;
      }
    } catch (_e) { /* empty body — normal cron call */ }
  }

  // --- Read owner config ---
  const { data: cfgRow } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", "renewal_reminders")
    .maybeSingle();
  const cfg = (cfgRow?.value ?? {}) as any;

  const enabled    = cfg.enabled !== false;
  if (!enabled && !manualSubId) {
    return jsonResponse({ ok: true, skipped: true, reason: "renewal reminders disabled in Settings" });
  }

  const leadDays   = Math.max(1, Number(cfg.lead_days ?? 14));
  const minDays    = Math.max(0, Number(cfg.min_days ?? 1));   // skip already-expired by default
  const planTypes  = Array.isArray(cfg.plan_types) && cfg.plan_types.length
    ? cfg.plan_types
    : ["monthly", "annual", "punch_card"];
  const subjectTmpl= String(cfg.subject || "Your {{biz}} membership expires {{when}}");
  const bodyTmpl   = String(cfg.body_html || "");
  const renewUrl   = String(cfg.renew_url || "").trim();

  const bizName = Deno.env.get("BIZ_NAME") || "2nd Nature Park";
  const appBase = (Deno.env.get("APP_BASE_URL") || "https://app.skateos.com").replace(/\/+$/, "");

  // --- Find candidates ---
  const today = new Date(); today.setHours(0,0,0,0);
  const earliestEndIso = new Date(today.getTime() + minDays*86400_000).toISOString().slice(0,10);
  const latestEndIso   = new Date(today.getTime() + leadDays*86400_000).toISOString().slice(0,10);

  let q = sb
    .from("subscriptions")
    .select("id,customer_id,plan_name,plan_type,end_date,renewal_reminder_sent_at,status,paused_until,monthly_rate")
    .eq("status", "active")
    .not("end_date", "is", null)
    .is("renewal_reminder_sent_at", null);

  if (manualSubId) {
    q = q.eq("id", manualSubId);
  } else {
    q = q
      .gte("end_date", earliestEndIso)
      .lte("end_date", latestEndIso)
      .order("end_date", { ascending: true })
      .limit(500);
  }

  const { data: subs, error: sErr } = await q;
  if (sErr) {
    return jsonResponse({ ok: false, error: "subscription fetch failed: " + sErr.message }, 502);
  }
  if (!subs || subs.length === 0) {
    return jsonResponse({ ok: true, sent: 0, skipped: 0, candidates: 0, message: "No memberships in window." });
  }

  const sent: any[] = [];
  const skipped: any[] = [];
  const failed: any[] = [];

  for (const s of subs) {
    if (!manualSubId && !planTypes.includes(s.plan_type)) {
      skipped.push({ id: s.id, reason: "plan_type filtered" });
      continue;
    }
    if (s.paused_until) {
      skipped.push({ id: s.id, reason: "paused" });
      continue;
    }

    const { data: c } = await sb
      .from("customers")
      .select("id,name,first_name,email,parent_email,email_opt_out_at,dob")
      .eq("id", s.customer_id)
      .maybeSingle();
    if (!c) { skipped.push({ id: s.id, reason: "no customer" }); continue; }
    if (c.email_opt_out_at) { skipped.push({ id: s.id, reason: "email opted out" }); continue; }

    let toEmail = c.email;
    try {
      if (c.dob && c.parent_email) {
        const age = Math.floor((Date.now() - new Date(c.dob).getTime()) / (365.25 * 86400_000));
        if (age < 18) toEmail = c.parent_email;
      }
    } catch (_e) { /* dob parse failure — fall back to customer email */ }
    if (!toEmail) { skipped.push({ id: s.id, reason: "no email" }); continue; }

    const endDate = new Date(s.end_date as string);
    const daysOut = daysBetween(today, endDate);
    const whenLabel = daysOut < 0 ? Math.abs(daysOut) + " days ago"
                    : daysOut === 0 ? "today"
                    : daysOut === 1 ? "tomorrow"
                    : "in " + daysOut + " days";

    const first = c.first_name || (c.name ? c.name.split(" ")[0] : "skater");
    const vars: Record<string, string> = {
      first:     escHtml(first),
      biz:       escHtml(bizName),
      plan:      escHtml(s.plan_name || s.plan_type || "membership"),
      end_date:  escHtml(s.end_date as string),
      when:      escHtml(whenLabel),
      days_out:  String(daysOut),
      renew_url: renewUrl,
    };

    const subject = tmpl(subjectTmpl, vars);
    let html: string;

    if (bodyTmpl) {
      html = tmpl(bodyTmpl, vars);
    } else {
      // Built-in default template
      const renewBlock = renewUrl ? `
        <div style="text-align:center;margin:24px 0 8px;">
          <a href="${renewUrl}" style="display:inline-block;padding:12px 28px;background:#e11d48;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Renew now →</a>
        </div>` : `
        <p style="margin:18px 0 0;text-align:center;color:#374151;">Stop by the front desk or give us a call to renew.</p>`;
      const unsubUrl = `${appBase}/admin/unsubscribe.html?cid=${encodeURIComponent(c.id)}`;
      const ribbonColor = daysOut <= 3 ? "#dc2626" : daysOut <= 7 ? "#d97706" : "#15803d";
      html = `
<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#f9fafb;padding:20px;color:#14161a;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    <div style="background:${ribbonColor};color:#fff;padding:24px;text-align:center;">
      <div style="font-size:36px;line-height:1;">🎟️</div>
      <div style="font-size:22px;font-weight:900;margin-top:8px;">Hey ${vars.first} — your ${vars.plan} expires ${vars.when}.</div>
    </div>
    <div style="padding:24px;font-size:15px;line-height:1.6;color:#374151;">
      <p style="margin:0 0 14px;">Just a heads-up — your <strong>${vars.plan}</strong> wraps up on <strong>${vars.end_date}</strong>. Renew before then to keep your access uninterrupted.</p>
      ${renewBlock}
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">— ${vars.biz}</p>
      <hr style="margin-top:18px;border:none;border-top:1px solid #f3f4f6;">
      <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;">Don't want renewal nudges? <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe</a>.</p>
    </div>
  </div>
</div>`;
    }

    const result = await postEmail({
      to: toEmail,
      subject,
      html,
      tags: [
        { name: "type",            value: "renewal-reminder" },
        { name: "subscription_id", value: s.id },
        { name: "customer_id",     value: c.id },
      ],
    });

    if (!result.ok) {
      failed.push({ subscription_id: s.id, customer_id: c.id, email: toEmail, error: result.error });
      continue;
    }

    const { error: stampErr } = await sb
      .from("subscriptions")
      .update({ renewal_reminder_sent_at: new Date().toISOString() })
      .eq("id", s.id);
    if (stampErr) {
      console.warn("renewal stamp failed for sub", s.id, stampErr.message);
    }
    sent.push({ subscription_id: s.id, customer_id: c.id, email: toEmail, days_out: daysOut });
  }

  return jsonResponse({
    ok: true,
    candidates: subs.length,
    sent: sent.length,
    skipped: skipped.length,
    failed: failed.length,
    sent_detail: sent,
    skipped_detail: skipped,
    failures: failed,
    config: { leadDays, minDays, planTypes },
  });
});
