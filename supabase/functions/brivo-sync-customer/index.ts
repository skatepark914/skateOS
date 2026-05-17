// ============================================================
// brivo-sync-customer — single-customer Brivo reconciliation
// ============================================================
// POST { customer_id: UUID, force_invite?: boolean }
//
// 1. Reads desired state from brivo_member_desired view
// 2. Compares against current state on customers.brivo_*
// 3. Provisions / updates / revokes via Brivo API
// 4. Sends Mobile Pass invite on first provision
// 5. Writes credential state + last_synced_at back
// 6. Logs to webhook_log with source='brivo-sync'
//
// Idempotent — safe to call repeatedly. Each call clears
// brivo_sync_needed_at on success.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  loadBrivoEnv,
  loadBrivoEnvForTenant,
  createBrivoUser,
  updateBrivoUser,
  addUserToGroup,
  removeUserFromGroup,
  sendMobilePassInvite,
} from "../_brivo/api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Split a customers.name into first + last for Brivo (best effort)
function splitName(name: string | null | undefined): { firstName: string; lastName: string } {
  if (!name) return { firstName: "Member", lastName: "—" };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "—" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// Read biz info + brivo welcome toggle + lockdown state from app_settings.
// Returns sensible defaults if anything's missing.
async function loadBizSettings(sb: any) {
  const defaults = {
    bizName:  "2nd Nature Park",
    bizPhone: "(914) 402-4624",
    bizAddr:  "1 Highland Industrial Park, Peekskill NY 10566",
    bizEmail: "info@2ntr.com",
    welcomeEmailEnabled: true,
    welcomeSubject: "",   // empty = use baked-in default in buildWelcomeEmail
    welcomeBody:    "",   // empty = use baked-in default
    lockdownActive: false,
    lockdownReason: "",
  };
  try {
    const { data } = await sb.from("app_settings").select("value").eq("key", "all").maybeSingle();
    const v = data?.value || {};
    const ig = (v.integrations && v.integrations.brivo) || {};
    return {
      bizName:  v.bizName  || defaults.bizName,
      bizPhone: v.bizPhone || defaults.bizPhone,
      bizAddr:  v.bizAddr  || defaults.bizAddr,
      bizEmail: v.bizEmail || defaults.bizEmail,
      welcomeEmailEnabled: ig.welcomeEmailEnabled === false ? false : true,
      welcomeSubject: typeof ig.welcomeSubject === "string" ? ig.welcomeSubject : "",
      welcomeBody:    typeof ig.welcomeBody    === "string" ? ig.welcomeBody    : "",
      lockdownActive: !!(ig.lockdown && ig.lockdown.active),
      lockdownReason: (ig.lockdown && ig.lockdown.reason) || "",
    };
  } catch {
    return defaults;
  }
}

// Build the branded welcome email HTML — fires after a member's first
// Brivo provision. Sets expectations about 24/7 access + intercom backup
// + after-hours etiquette + what revokes access.
// Interpolate `{{first}}` / `{{biz}}` / `{{biz_phone}}` / `{{biz_address}}`
// in owner-supplied template strings. Keeps it minimal so we can extend
// later without breaking existing setups.
function interpolateWelcome(tpl: string, ctx: { firstName: string; biz: { bizName: string; bizPhone: string; bizAddr: string } }): string {
  return tpl
    .replace(/\{\{\s*first\s*\}\}/g,        ctx.firstName)
    .replace(/\{\{\s*biz\s*\}\}/g,          ctx.biz.bizName)
    .replace(/\{\{\s*biz_phone\s*\}\}/g,    ctx.biz.bizPhone)
    .replace(/\{\{\s*biz_address\s*\}\}/g,  ctx.biz.bizAddr);
}

function buildWelcomeEmail(opts: {
  firstName: string;
  biz: { bizName: string; bizPhone: string; bizAddr: string; bizEmail: string };
  unsubscribeUrl?: string;
  customSubject?: string;
  customBody?: string;
}): { subject: string; html: string; text: string } {
  const { firstName, biz, unsubscribeUrl, customSubject, customBody } = opts;
  const safeName  = firstName.replace(/[<>]/g, "");
  const safePhone = biz.bizPhone.replace(/[<>]/g, "");
  const safeAddr  = biz.bizAddr.replace(/[<>]/g, "");
  const safeBiz   = biz.bizName.replace(/[<>]/g, "");
  const ctx = { firstName: safeName, biz: { bizName: safeBiz, bizPhone: safePhone, bizAddr: safeAddr } };

  // Owner can override subject + body via app_settings.value.integrations.brivo
  // (set in Settings → Brivo card). Empty string falls back to baked-in default.
  const subject = customSubject && customSubject.trim()
    ? interpolateWelcome(customSubject, ctx)
    : "🔓 You're in — 24/7 park access activated";

  // If owner provided a custom body, build a simpler email with their text
  // wrapped in the same gradient-header chrome (consistent branding).
  if (customBody && customBody.trim()) {
    const interpolatedBody = interpolateWelcome(customBody, ctx)
      // Sanitize: strip any <script> tags + on-handlers (defensive — owner-edit
      // shouldn't be a vector but emails forwarded to recipient with raw HTML
      // could be flagged by spam filters if executable bits land).
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+="[^"]*"/gi, "");
    const html = '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#faf8f3;">'
      + '<div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e0d5;">'
      + '<div style="background:linear-gradient(135deg,#fb7185,#e11d48);color:#fff;padding:28px 24px;border-radius:10px;text-align:center;margin:-12px -12px 24px;">'
        + '<div style="font-size:14px;opacity:0.9;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">' + safeBiz + '</div>'
        + '<div style="font-size:28px;font-weight:800;margin-bottom:6px;">🔓 You\'re in</div>'
      + '</div>'
      + '<div style="font-size:14px;color:#444;line-height:1.7;">' + interpolatedBody + '</div>'
      + (unsubscribeUrl ? '<div style="margin-top:24px;padding-top:14px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;text-align:center;">Don\'t want these emails? <a href="' + unsubscribeUrl + '" style="color:#9ca3af;">Unsubscribe</a></div>' : '')
      + '</div></body></html>';
    const text = interpolatedBody.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "");
    return { subject, html, text };
  }


  const html = '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#faf8f3;">'
    + '<div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e0d5;">'
    + '<div style="background:linear-gradient(135deg,#fb7185,#e11d48);color:#fff;padding:28px 24px;border-radius:10px;text-align:center;margin:-12px -12px 24px;">'
      + '<div style="font-size:14px;opacity:0.9;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">' + safeBiz + '</div>'
      + '<div style="font-size:28px;font-weight:800;margin-bottom:6px;">🔓 You\'re in</div>'
      + '<div style="font-size:15px;opacity:0.95;">24/7 park access is now active on your account</div>'
    + '</div>'

    + '<div style="font-size:16px;color:#111;margin-bottom:16px;">Hey ' + safeName + ',</div>'
    + '<div style="font-size:14px;color:#444;line-height:1.6;margin-bottom:24px;">Welcome to the regulars. Your Brivo Mobile Pass invite arrived in your inbox separately — once you install the app and accept the pass, you have round-the-clock access to the park. Here\'s how it works.</div>'

    + '<div style="margin:24px 0;padding:18px;background:#fef2f2;border:1px solid #fecdd3;border-radius:10px;">'
      + '<div style="font-size:13px;color:#9f1239;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">📱 How to unlock the park door</div>'
      + '<div style="font-size:14px;color:#444;line-height:1.7;">'
        + '<div style="margin-bottom:6px;"><strong>1.</strong> Open the email from <strong>Brivo</strong> + tap "Accept Mobile Pass" — installs the Brivo Mobile app (App Store / Play Store)</div>'
        + '<div style="margin-bottom:6px;"><strong>2.</strong> Walk up to the park door (the one with the silver reader + intercom)</div>'
        + '<div><strong>3.</strong> Tap your phone to the reader — the door clicks open in under a second. Bluetooth must be on.</div>'
      + '</div>'
    + '</div>'

    + '<div style="margin:24px 0;padding:18px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">'
      + '<div style="font-size:13px;color:#1e40af;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">📞 Phone dead? Forgot it? Bluetooth off?</div>'
      + '<div style="font-size:14px;color:#444;line-height:1.6;">The intercom on the park door reader rings the front desk during staffed hours. Press it and we\'ll buzz you in. Outside staffed hours, your phone is the only way in — keep it charged.</div>'
    + '</div>'

    + '<div style="margin:24px 0;padding:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;">'
      + '<div style="font-size:13px;color:#a16207;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">🛹 After-hours etiquette</div>'
      + '<ul style="font-size:14px;color:#444;line-height:1.7;margin:0;padding-left:18px;">'
        + '<li><strong>Lock up behind you.</strong> The door auto-locks 5 seconds after close — never prop it.</li>'
        + '<li><strong>No guests outside your membership.</strong> Insurance issue + safety. Buddies need their own day pass or membership.</li>'
        + '<li><strong>Helmet on at all times.</strong> Loaners in the bin by the front desk if you forgot yours.</li>'
        + '<li><strong>If something\'s broken or sketchy,</strong> text us at ' + safePhone + ' — even at 2am, we\'d rather know.</li>'
      + '</ul>'
    + '</div>'

    + '<div style="margin:24px 0;padding:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#666;line-height:1.6;">'
      + '<strong style="color:#111;">Heads up — access auto-revokes when:</strong> your membership lapses (renew anytime via your account), your waiver expires (we\'ll email 30 days out), or your membership is paused. No surprise lockouts — we always email first.'
    + '</div>'

    + '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:13px;color:#666;text-align:center;line-height:1.6;">'
      + '<div style="font-weight:600;color:#111;">' + safeBiz + '</div>'
      + safeAddr + '<br>' + safePhone
    + '</div>'

    + (unsubscribeUrl
      ? '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;text-align:center;">Don\'t want these emails? <a href="' + unsubscribeUrl + '" style="color:#9ca3af;">Unsubscribe</a></div>'
      : '')

    + '</div></body></html>';

  const text = "🔓 You're in — 24/7 park access activated\n\n"
    + "Hey " + safeName + ",\n\n"
    + "Welcome to the regulars. Your Brivo Mobile Pass invite arrived separately — install the Brivo app + accept the pass to start using your access.\n\n"
    + "HOW TO UNLOCK THE PARK DOOR:\n"
    + "1. Open the Brivo email + tap Accept Mobile Pass\n"
    + "2. Walk up to the park door reader\n"
    + "3. Tap your phone to the reader — door clicks open in under a second (Bluetooth on)\n\n"
    + "Phone dead / forgot / Bluetooth off? Press the door intercom — rings the front desk during staffed hours.\n\n"
    + "AFTER-HOURS ETIQUETTE:\n"
    + "• Lock up behind you (auto-locks 5s after close — don't prop)\n"
    + "• No guests outside your membership\n"
    + "• Helmet on at all times — loaners in the front-desk bin\n"
    + "• Something broken? Text " + safePhone + " — even at 2am\n\n"
    + "Access auto-revokes if your membership lapses, your waiver expires, or your membership is paused. We'll always email first — no surprise lockouts.\n\n"
    + "— " + safeBiz + "\n" + safeAddr + " · " + safePhone;

  return { subject, html, text };
}

// Fire the branded welcome email via send-email Edge Function (Resend).
// Idempotent: caller must check brivo_welcome_sent_at first.
// Best-effort: failures are logged but don't break the sync flow.
async function sendBrivoWelcomeEmail(
  sb: any,
  c: { id: string; name: string | null; email: string | null; email_opt_out_at?: string | null },
  biz: { bizName: string; bizPhone: string; bizAddr: string; bizEmail: string; welcomeSubject?: string; welcomeBody?: string },
): Promise<{ sent: boolean; reason?: string }> {
  if (!c.email) return { sent: false, reason: "no_email" };
  if (c.email_opt_out_at) return { sent: false, reason: "opted_out" };

  const firstName = (c.name || "").trim().split(/\s+/)[0] || "there";
  const appBase = Deno.env.get("APP_BASE_URL") || "https://app.skateos.com";
  const unsubUrl = `${appBase}/unsubscribe.html?cid=${c.id}`;

  const { subject, html, text } = buildWelcomeEmail({
    firstName,
    biz,
    unsubscribeUrl: unsubUrl,
    customSubject: biz.welcomeSubject,
    customBody:    biz.welcomeBody,
  });

  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        to:      c.email,
        subject,
        html,
        text,
        tags: [
          { name: "type",        value: "brivo_welcome" },
          { name: "customer_id", value: c.id },
        ],
      }),
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      return { sent: false, reason: `send_failed_${r.status}: ${errBody.slice(0, 120)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: `send_exception: ${(e as Error).message}` };
  }
}

async function logSync(sb: any, customer_id: string, status: string, action: string, error: string | null, payload: any) {
  try {
    await sb.from("webhook_log").insert({
      source:        "brivo-sync",
      event_type:    action,
      event_id:      customer_id,
      status:        status,
      ref_table:     "customers",
      ref_id:        customer_id,
      payload,
      error_message: error,
    });
  } catch (e) {
    console.warn("brivo-sync log write failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ ok: false, error: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* tolerate empty */ }

  const customer_id = String(body?.customer_id || "").trim();
  if (!customer_id) return jsonResponse({ ok: false, error: "customer_id required" }, 400);
  const forceInvite = body?.force_invite === true;

  const sb = admin();

  // Credential resolution moved AFTER customer load so we can pick
  // per-tenant credentials when available (mig 069). Set below.
  let env: Awaited<ReturnType<typeof loadBrivoEnvForTenant>> | null = null;
  let groupId: string | undefined;

  // ── Load desired state for this customer ─────────────────
  const { data: desired, error: deErr } = await sb
    .from("brivo_member_desired")
    .select("*")
    .eq("customer_id", customer_id)
    .maybeSingle();
  if (deErr) {
    await logSync(sb, customer_id, "error", "load_desired", deErr.message, { customer_id });
    return jsonResponse({ ok: false, error: deErr.message }, 500);
  }

  // Customer not in the view (no subscription history, no Brivo user) —
  // nothing to do. Clear the flag so the sweep doesn't re-pick it.
  if (!desired) {
    await sb.from("customers").update({
      brivo_sync_needed_at: null,
      brivo_last_synced_at: new Date().toISOString(),
    }).eq("id", customer_id);
    return jsonResponse({ ok: true, action: "noop_no_desired_row", customer_id });
  }

  // ── Load current customer record (need email/phone for provisioning) ──
  const { data: c, error: cErr } = await sb
    .from("customers")
    .select("id, name, email, phone, tenant_id, brivo_user_id, brivo_credential_state, brivo_credential_sent_at, brivo_welcome_sent_at, email_opt_out_at")
    .eq("id", customer_id)
    .single();
  if (cErr) {
    await logSync(sb, customer_id, "error", "load_customer", cErr.message, { customer_id });
    return jsonResponse({ ok: false, error: cErr.message }, 500);
  }

  // ── PER-TENANT CREDENTIAL RESOLUTION (mig 069) ─────────────
  // Read credentials from tenant_brivo_config when available, else
  // fall back to env vars. 2nd Nature's current install (env vars
  // only, no tenant_brivo_config row) keeps working unchanged.
  env = await loadBrivoEnvForTenant(sb, (c as any).tenant_id);
  if (!env) {
    return jsonResponse({
      ok: false,
      error: "Brivo not configured",
      hint:  "Either set BRIVO_CLIENT_ID/SECRET/API_KEY/ACCOUNT_ID via supabase secrets (single-tenant) OR save per-tenant credentials via Settings → Brivo → Per-tenant credentials",
    }, 503);
  }
  groupId = env.activeMembersGroupId;
  if (!groupId) {
    return jsonResponse({
      ok: false,
      error: "BRIVO_ACTIVE_MEMBERS_GROUP_ID not set",
      hint:  env.source === "tenant_table"
        ? "Set active_members_group_id in this tenant's brivo config via brivo-save-config"
        : "Set BRIVO_ACTIVE_MEMBERS_GROUP_ID via supabase secrets",
    }, 503);
  }

  // ── LOCKDOWN GATE ──────────────────────────────────────────
  // If emergency lockdown is engaged via brivo-lockdown, refuse to
  // provision anyone — otherwise the cron would undo the lockdown
  // 5 min later. Existing revokes still go through (sync to suspended).
  const bizSettings = await loadBizSettings(sb);
  if (bizSettings.lockdownActive && desired.should_have_access === true) {
    await sb.from("customers").update({
      brivo_credential_state: "suspended",
      brivo_sync_error:       "lockdown active: " + (bizSettings.lockdownReason || "no reason given"),
      brivo_sync_needed_at:   null,
      brivo_last_synced_at:   new Date().toISOString(),
    }).eq("id", customer_id);
    await logSync(sb, customer_id, "ignored", "skipped_lockdown_active", null, {
      customer_id, reason: bizSettings.lockdownReason,
    });
    return jsonResponse({
      ok: true,
      action: "skipped_lockdown_active",
      lockdown_reason: bizSettings.lockdownReason,
    });
  }

  const wantAccess = desired.should_have_access === true;
  const reason     = desired.desired_reason as string;
  let action       = "noop";
  let newState     = c.brivo_credential_state || null;
  let invited      = false;

  try {
    if (wantAccess) {
      // Email is required for Mobile Pass invite
      if (!c.email) {
        action = "skipped_no_email";
        newState = "error";
        await sb.from("customers").update({
          brivo_credential_state: newState,
          brivo_sync_error:       "no email on file — required for mobile pass invite",
          brivo_sync_needed_at:   null,
          brivo_last_synced_at:   new Date().toISOString(),
        }).eq("id", customer_id);
        await logSync(sb, customer_id, "error", action, "no email", { customer_id });
        return jsonResponse({ ok: false, action, error: "no email on file" });
      }

      // PROVISION path
      const { firstName, lastName } = splitName(c.name);

      if (!c.brivo_user_id) {
        // New Brivo user
        const newId = await createBrivoUser(env, {
          firstName, lastName,
          email:      c.email,
          phone:      c.phone || undefined,
          externalId: c.id,
        });
        await addUserToGroup(env, newId, groupId);
        const inv = await sendMobilePassInvite(env, newId);
        invited = inv.ok;
        action  = invited ? "provisioned_invited" : "provisioned_invite_failed";
        newState = invited ? "pending" : "error";
        await sb.from("customers").update({
          brivo_user_id:           newId,
          brivo_credential_state:  newState,
          brivo_credential_sent_at: invited ? new Date().toISOString() : null,
          brivo_sync_error:        invited ? null : "invite send failed",
          brivo_sync_needed_at:    null,
          brivo_last_synced_at:    new Date().toISOString(),
        }).eq("id", customer_id);
      } else {
        // Existing Brivo user — ensure in group + (optionally) update profile
        await addUserToGroup(env, c.brivo_user_id, groupId);
        // Refresh contact info best-effort (failure non-blocking)
        try {
          await updateBrivoUser(env, c.brivo_user_id, {
            firstName, lastName, email: c.email, phone: c.phone || undefined,
          });
        } catch (e) {
          console.warn("brivo user update non-fatal:", (e as Error).message);
        }
        if (forceInvite) {
          const inv = await sendMobilePassInvite(env, c.brivo_user_id);
          invited = inv.ok;
        }
        action = "reactivated";
        newState = "active";
        await sb.from("customers").update({
          brivo_credential_state:   newState,
          brivo_credential_sent_at: invited ? new Date().toISOString() : c.brivo_credential_sent_at,
          brivo_sync_error:         null,
          brivo_sync_needed_at:     null,
          brivo_last_synced_at:     new Date().toISOString(),
        }).eq("id", customer_id);
      }
    } else {
      // REVOKE path
      if (!c.brivo_user_id) {
        // Never provisioned + shouldn't have access — clear flag, nothing to do
        action = "noop_not_eligible";
        await sb.from("customers").update({
          brivo_sync_needed_at: null,
          brivo_last_synced_at: new Date().toISOString(),
        }).eq("id", customer_id);
      } else {
        await removeUserFromGroup(env, c.brivo_user_id, groupId);
        action   = `revoked_${reason}`;
        newState = "revoked";
        await sb.from("customers").update({
          brivo_credential_state: newState,
          brivo_sync_error:       null,
          brivo_sync_needed_at:   null,
          brivo_last_synced_at:   new Date().toISOString(),
        }).eq("id", customer_id);
      }
    }
  } catch (e) {
    const msg = (e as Error).message;
    await sb.from("customers").update({
      brivo_credential_state: "error",
      brivo_sync_error:       msg.slice(0, 500),
      brivo_sync_needed_at:   null,
      brivo_last_synced_at:   new Date().toISOString(),
    }).eq("id", customer_id);
    await logSync(sb, customer_id, "error", "exception", msg, { customer_id, wantAccess, reason });
    return jsonResponse({ ok: false, action: "error", error: msg }, 500);
  }

  // ── Branded welcome email (mig 065) ───────────────────────────────
  // Fires after a successful provision (new credential OR reactivation)
  // when the customer hasn't received the welcome email yet. Best-effort,
  // never blocks the sync flow. Honors customers.email_opt_out_at +
  // app_settings.integrations.brivo.welcomeEmailEnabled.
  let welcomeSent = false;
  let welcomeSkipReason: string | undefined;
  const didProvisionOrReactivate =
    action === "provisioned_invited"
    || action === "provisioned_invite_failed"
    || action === "reactivated";
  if (didProvisionOrReactivate && !c.brivo_welcome_sent_at) {
    try {
      // Reuse the bizSettings loaded earlier for the lockdown gate
      if (!bizSettings.welcomeEmailEnabled) {
        welcomeSkipReason = "disabled_in_settings";
      } else {
        const res = await sendBrivoWelcomeEmail(sb, c as any, bizSettings as any);
        if (res.sent) {
          welcomeSent = true;
          await sb.from("customers").update({
            brivo_welcome_sent_at: new Date().toISOString(),
          }).eq("id", customer_id);
        } else {
          welcomeSkipReason = res.reason;
        }
      }
    } catch (e) {
      welcomeSkipReason = `exception: ${(e as Error).message}`;
      console.warn("brivo welcome email exception:", e);
    }
  } else if (didProvisionOrReactivate && c.brivo_welcome_sent_at) {
    welcomeSkipReason = "already_sent";
  }

  await logSync(sb, customer_id, "processed", action, null, {
    customer_id, wantAccess, reason, invited, welcomeSent, welcomeSkipReason,
  });

  return jsonResponse({
    ok: true,
    customer_id,
    action,
    state:        newState,
    desired:      wantAccess,
    reason,
    invited,
    welcome_sent: welcomeSent,
    welcome_skip_reason: welcomeSkipReason,
  });
});
