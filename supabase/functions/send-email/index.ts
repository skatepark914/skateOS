// ============================================================
// send-email — Supabase Edge Function (Deno)
//
// Resend-based outbound email proxy. Solves browser-side CORS
// on the Resend API and keeps the API key server-side only.
//
// Adapted structurally from BM's send-email function
// (see _bm-reference/supabase-functions/send-email/index.ts) —
// BM uses SendGrid; skateOS uses Resend per Settings → Integrations.
//
// IMPORTANT — STATUS as of 2026-04-29
// ----------
// This function is BUILT but NOT DEPLOYED and NEVER TESTED LIVE.
// Doug needs to:
//   1. Create a Resend account at resend.com (free up to 3k/mo,
//      $20/mo for 50k/mo).
//   2. Verify the sending domain (2ntr.com) — Resend gives DNS
//      records (SPF, DKIM, DMARC) to add to the registrar.
//   3. Generate an API key in the Resend dashboard.
//   4. Set the secret:
//        supabase secrets set RESEND_API_KEY=re_xxx \
//          --project-ref zecurmlenxyxanqucrga
//   5. Deploy: bash admin/deploy-functions.sh
//   6. Send a test from admin Settings → Integrations → Resend.
//
// API reference: https://resend.com/docs/api-reference/emails/send-email
//
// Request shape (browser → this function):
//   {
//     to:        "skater@example.com" | ["a@x.com", "b@y.com"],
//     subject:   "Your receipt for $25.00",
//     html?:     "<p>Hi…</p>",
//     text?:     "Hi…",
//     from?:     "info@2ntr.com",          // optional override
//     fromName?: "2nd Nature Park",        // optional override
//     replyTo?:  "support@2ntr.com",       // optional
//     tags?:     [{ name: "type", value: "receipt" }]  // for Resend analytics
//   }
//
// Response: { ok: true, id: "<resend-message-id>" } on success,
//           { ok: false, error: "<message>", details?: ... } on failure.
// ============================================================

const RESEND_BASE = "https://api.resend.com";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return new Response("Only POST", { status: 405, headers: corsHeaders });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return jsonResponse({
      ok: false,
      error: "RESEND_API_KEY not set on this Edge Function. See send-email/index.ts header for setup.",
    }, 500);
  }

  // ---- parse + validate -----------------------------------------------
  let body: any;
  try { body = await req.json(); }
  catch { return jsonResponse({ ok: false, error: "invalid JSON" }, 400); }

  const {
    to, subject, html, text,
    from:    fromOverride,
    fromName: fromNameOverride,
    replyTo,
    tags,
  } = body || {};

  if (!to)                        return jsonResponse({ ok: false, error: "`to` is required" }, 400);
  if (!subject)                   return jsonResponse({ ok: false, error: "`subject` is required" }, 400);
  if (!html && !text)             return jsonResponse({ ok: false, error: "`html` or `text` is required" }, 400);

  // Normalize to[] and validate every entry looks like an email
  const recipients = Array.isArray(to) ? to : [to];
  const badEmail = recipients.find((e: unknown) => typeof e !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (badEmail !== undefined) return jsonResponse({ ok: false, error: `invalid email: ${String(badEmail)}` }, 400);

  // ---- Compose Resend payload -----------------------------------------
  // Defaults match skateOS config.js / Settings → Integrations → Resend.
  const fromAddr = fromOverride       || Deno.env.get("RESEND_FROM_ADDRESS") || "info@2ntr.com";
  const fromName = fromNameOverride   || Deno.env.get("RESEND_FROM_NAME")    || "2nd Nature Park";
  const fromHeader = `${fromName} <${fromAddr}>`;

  const payload: Record<string, unknown> = {
    from:    fromHeader,
    to:      recipients,
    subject: String(subject),
  };
  if (html)    payload.html     = String(html);
  if (text)    payload.text     = String(text);
  if (replyTo) payload.reply_to = String(replyTo);
  if (Array.isArray(tags) && tags.length) payload.tags = tags;

  // ---- Call Resend ----------------------------------------------------
  let resendResp: Response;
  try {
    resendResp = await fetch(`${RESEND_BASE}/emails`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: "network error calling Resend", details: (e as Error).message }, 502);
  }

  const respBody = await resendResp.json().catch(() => ({}));
  if (!resendResp.ok) {
    return jsonResponse({
      ok: false,
      error: respBody?.message || respBody?.name || `Resend returned ${resendResp.status}`,
      status: resendResp.status,
      details: respBody,
    }, resendResp.status);
  }

  return jsonResponse({
    ok: true,
    id: respBody?.id,
    to: recipients,
    subject,
  });
});
