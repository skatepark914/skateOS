// ============================================================
// send-overdue-rentals — Supabase Edge Function (Deno)
//
// Daily cron (15:00 UTC via migration 040) — finds open equipment_loans
// where `due_at < now()` and emails the customer asking them to bring
// the gear back. Stamps `overdue_reminder_sent_at` on success so the
// same loan doesn't get pinged twice in the same window (configurable
// via `min_gap_h`, default 23 hours so a daily cron sends one per day).
//
// Manual single-row fire: POST { loan_id } skips the grace-hours +
// min-gap checks (owner explicitly clicked the button).
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = admin();

  // --- Optional per-loan override ---
  let manualLoanId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof (body as any).loan_id === "string") {
        manualLoanId = (body as any).loan_id;
      }
    } catch (_e) { /* empty body — normal cron */ }
  }

  // --- Read owner config ---
  const { data: cfgRow } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", "overdue_rentals")
    .maybeSingle();
  const cfg = (cfgRow?.value ?? {}) as any;

  const enabled    = cfg.enabled !== false;
  if (!enabled && !manualLoanId) {
    return jsonResponse({ ok: true, skipped: true, reason: "overdue rental reminders disabled" });
  }

  const graceH     = Math.max(0, Number(cfg.grace_hours ?? 0));
  const minGapH    = Math.max(1, Number(cfg.min_gap_h ?? 23));
  const subjectTmpl= String(cfg.subject || "Reminder: please return your {{biz}} rental");
  const bodyTmpl   = String(cfg.body_html || "");

  const bizName = Deno.env.get("BIZ_NAME") || "2nd Nature Park";
  const bizPhone= Deno.env.get("BIZ_PHONE") || "";
  const appBase = (Deno.env.get("APP_BASE_URL") || "https://app.skateos.com").replace(/\/+$/, "");

  // --- Find candidates ---
  const nowMs = Date.now();
  const cutoffIso = new Date(nowMs - graceH * 3600_000).toISOString();
  const minGapCutoffIso = new Date(nowMs - minGapH * 3600_000).toISOString();

  let q = sb
    .from("equipment_loans")
    .select("id,equipment_id,customer_id,customer_name,checked_out_at,due_at,returned_at,overdue_reminder_sent_at,fee_charged,notes")
    .is("returned_at", null)
    .not("due_at", "is", null);

  if (manualLoanId) {
    q = q.eq("id", manualLoanId);
  } else {
    q = q
      .lt("due_at", cutoffIso)
      .or(`overdue_reminder_sent_at.is.null,overdue_reminder_sent_at.lt.${minGapCutoffIso}`)
      .order("due_at", { ascending: true })
      .limit(200);
  }

  const { data: loans, error: lErr } = await q;
  if (lErr) {
    return jsonResponse({ ok: false, error: "loan fetch failed: " + lErr.message }, 502);
  }
  if (!loans || loans.length === 0) {
    return jsonResponse({ ok: true, sent: 0, skipped: 0, candidates: 0, message: "No overdue rentals." });
  }

  const sent: any[] = [];
  const skipped: any[] = [];
  const failed: any[] = [];

  for (const l of loans) {
    if (!l.customer_id) {
      skipped.push({ id: l.id, reason: "walk-in (no customer linked)" });
      continue;
    }
    const { data: c } = await sb
      .from("customers")
      .select("id,name,first_name,email,parent_email,email_opt_out_at,dob")
      .eq("id", l.customer_id)
      .maybeSingle();
    if (!c) { skipped.push({ id: l.id, reason: "no customer" }); continue; }
    if (c.email_opt_out_at) {
      // Overdue reminders are arguably transactional (related to a contract
      // they signed when borrowing gear) but treat as marketing to be safe.
      skipped.push({ id: l.id, reason: "email opted out" });
      continue;
    }

    let toEmail = c.email;
    try {
      if (c.dob && c.parent_email) {
        const age = Math.floor((nowMs - new Date(c.dob).getTime()) / (365.25 * 86400_000));
        if (age < 18) toEmail = c.parent_email;
      }
    } catch (_e) { /* dob parse failure — fallback */ }
    if (!toEmail) { skipped.push({ id: l.id, reason: "no email" }); continue; }

    // Lookup equipment for the email body
    const { data: eq } = await sb
      .from("equipment")
      .select("type,size,asset_tag")
      .eq("id", l.equipment_id)
      .maybeSingle();
    const itemDesc = eq
      ? `${eq.type || "rental"}${eq.size ? " (size " + eq.size + ")" : ""} — tag #${eq.asset_tag || l.equipment_id?.slice(0,8)}`
      : `rental #${(l.equipment_id ?? "").slice(0, 8)}`;

    const dueMs = new Date(l.due_at as string).getTime();
    const hoursOverdue = Math.max(0, Math.round((nowMs - dueMs) / 3600_000));
    const daysOverdue  = Math.floor(hoursOverdue / 24);
    const overdueLabel = daysOverdue >= 1
      ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`
      : `${hoursOverdue} hour${hoursOverdue === 1 ? "" : "s"} overdue`;

    const first = c.first_name || (c.name ? c.name.split(" ")[0] : "skater");
    const vars: Record<string, string> = {
      first:     escHtml(first),
      biz:       escHtml(bizName),
      biz_phone: escHtml(bizPhone),
      item:      escHtml(itemDesc),
      due_at:    escHtml(new Date(l.due_at as string).toLocaleString([], {
                  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                 })),
      overdue:   escHtml(overdueLabel),
      hours_overdue: String(hoursOverdue),
    };

    const subject = tmpl(subjectTmpl, vars);
    let html: string;
    if (bodyTmpl) {
      html = tmpl(bodyTmpl, vars);
    } else {
      const unsubUrl = `${appBase}/admin/unsubscribe.html?cid=${encodeURIComponent(c.id)}`;
      const phoneLine = bizPhone
        ? `<p style="margin:0 0 12px;">If you can't make it back today, give us a call at <strong>${escHtml(bizPhone)}</strong> and we'll work something out.</p>`
        : "";
      // Color escalates with how overdue
      const banner = daysOverdue >= 3 ? "#dc2626" : daysOverdue >= 1 ? "#d97706" : "#15803d";
      html = `
<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#f9fafb;padding:20px;color:#14161a;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    <div style="background:${banner};color:#fff;padding:24px;text-align:center;">
      <div style="font-size:36px;line-height:1;">🛹</div>
      <div style="font-size:22px;font-weight:900;margin-top:8px;">Hey ${vars.first} — please return your rental</div>
    </div>
    <div style="padding:24px;font-size:15px;line-height:1.6;color:#374151;">
      <p style="margin:0 0 14px;">Our records show you have a <strong>${vars.item}</strong> still out from ${vars.biz}.</p>
      <p style="margin:0 0 14px;">It was due <strong>${vars.due_at}</strong> — that's <strong>${vars.overdue}</strong>.</p>
      <p style="margin:0 0 14px;">Please drop it back at the front desk as soon as possible so the next skater can grab it.</p>
      ${phoneLine}
      <p style="margin:18px 0 0;color:#6b7280;font-size:13px;">— ${vars.biz}</p>
      <hr style="margin-top:18px;border:none;border-top:1px solid #f3f4f6;">
      <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;">Don't want these reminders? <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe</a> (we'll still ping you in person about returning the gear).</p>
    </div>
  </div>
</div>`;
    }

    const result = await postEmail({
      to: toEmail,
      subject,
      html,
      tags: [
        { name: "type",        value: "overdue-rental" },
        { name: "loan_id",     value: l.id },
        { name: "customer_id", value: c.id },
      ],
    });

    if (!result.ok) {
      failed.push({ loan_id: l.id, customer_id: c.id, email: toEmail, error: result.error });
      continue;
    }

    const { error: stampErr } = await sb
      .from("equipment_loans")
      .update({ overdue_reminder_sent_at: new Date().toISOString() })
      .eq("id", l.id);
    if (stampErr) {
      console.warn("overdue stamp failed for loan", l.id, stampErr.message);
    }
    sent.push({ loan_id: l.id, customer_id: c.id, email: toEmail, hours_overdue: hoursOverdue });
  }

  return jsonResponse({
    ok: true,
    candidates: loans.length,
    sent: sent.length,
    skipped: skipped.length,
    failed: failed.length,
    sent_detail: sent,
    skipped_detail: skipped,
    failures: failed,
  });
});
