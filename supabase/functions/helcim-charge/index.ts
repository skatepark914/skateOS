// ============================================================
// helcim-charge — Supabase Edge Function (Deno)
//
// Charges a credit card via Helcim's Payment API.
// Called from admin after the customer enters their card via
// HelcimPay.js (which returns a card token). Token + amount
// land here; this function calls Helcim's purchase endpoint
// and writes the result to the matching `sales` row.
//
// IMPORTANT — STATUS as of 2026-04-29
// ----------
// This function is BUILT FROM HELCIM'S PUBLIC DOCS, not from
// patterns in the Branch Manager codebase (which is on a drive
// Doug hasn't located yet). It SHOULD work but has never been
// tested end-to-end against a real Helcim merchant account.
// Doug needs to:
//   1. Sign up for a Helcim merchant account (helcim.com)
//   2. Create an API Access Configuration with permissions:
//        - Positions: API Access (Connect)
//        - Sub-permissions: Payment API → Purchase, Refund
//   3. Set the HELCIM_API_TOKEN secret:
//        supabase secrets set HELCIM_API_TOKEN=helcim_pat_xxx \
//          --project-ref zecurmlenxyxanqucrga
//   4. Deploy: bash admin/deploy-functions.sh
//   5. Run a $1 test charge in Helcim's test mode to confirm.
//
// API reference:
//   POST https://api.helcim.com/v2/payment/purchase
//   Auth: api-token: <HELCIM_API_TOKEN>
//   Body: { ipAddress, amount, currency, cardData }
//   Header: idempotency-key: <UUID>
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HELCIM_BASE = "https://api.helcim.com/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function uuid() {
  // RFC 4122 v4-ish — 32 hex chars + dashes. Helcim accepts this format.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return new Response("Only POST", { status: 405, headers: corsHeaders });

  const apiToken = Deno.env.get("HELCIM_API_TOKEN");
  if (!apiToken) {
    return new Response(
      JSON.stringify({ ok: false, error: "HELCIM_API_TOKEN not set on this Edge Function. See helcim-charge/index.ts header for setup." }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: "invalid JSON" }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } }); }

  // ---- validate inputs -------------------------------------------------
  const amount      = Number(body?.amount);
  const currency    = (body?.currency || "USD").toUpperCase();
  const sale_id     = body?.sale_id        as string | undefined;  // optional — link the charge to an existing sales row
  const customer_id = body?.customer_id    as string | undefined;  // optional — for staff-portal customer attribution
  const cardData    = body?.cardData;                              // either { cardToken } or { cardNumber, cardExpiry, cardCVV } (NEVER pass raw cards from browser — always use HelcimPay.js)
  const customerIp  = body?.ipAddress || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";

  if (!amount || amount <= 0) return new Response(JSON.stringify({ ok: false, error: "amount required and must be > 0" }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });
  if (!cardData)              return new Response(JSON.stringify({ ok: false, error: "cardData required (token from HelcimPay.js)" }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });

  // ---- call Helcim ----------------------------------------------------
  const idempotencyKey = uuid();
  let helcimResp: Response;
  try {
    helcimResp = await fetch(`${HELCIM_BASE}/payment/purchase`, {
      method: "POST",
      headers: {
        "api-token":      apiToken,
        "idempotency-key": idempotencyKey,
        "accept":         "application/json",
        "content-type":   "application/json",
      },
      body: JSON.stringify({
        ipAddress: customerIp,
        amount,
        currency,
        cardData,
        ecommerce: true,  // run Helcim Fraud Defender
        ...(customer_id ? { customerCode: customer_id } : {}),
      }),
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: "network error calling Helcim", details: (e as Error).message }),
      { status: 502, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const helcimBody = await helcimResp.json().catch(() => ({}));
  const helcimOk   = helcimResp.ok && helcimBody?.status !== "DECLINED";

  // ---- write result back to Supabase ---------------------------------
  if (sale_id) {
    try {
      const sb = admin();
      await sb.from("sales").update({
        payment_provider: "helcim",
        payment_id:       helcimBody?.transactionId ? String(helcimBody.transactionId) : null,
        payment_method:   helcimBody?.cardType || helcimBody?.cardData?.cardType || "card",
        status:           helcimOk ? "completed" : "voided",
      }).eq("id", sale_id);
    } catch (e) {
      console.warn("Failed to update sales row after Helcim charge:", e);
      // Don't fail the response — the charge succeeded, the local update can be retried.
    }
  }

  return new Response(
    JSON.stringify({
      ok: helcimOk,
      idempotencyKey,
      transactionId: helcimBody?.transactionId,
      approvalCode:  helcimBody?.approvalCode,
      cardType:      helcimBody?.cardType,
      avsResponse:   helcimBody?.avsResponse,
      cvvResponse:   helcimBody?.cvvResponse,
      helcim:        helcimBody,           // full Helcim response for debugging — strip in prod
      helcimStatus:  helcimResp.status,
    }, null, 2),
    { status: helcimOk ? 200 : 402, headers: { ...corsHeaders, "content-type": "application/json" } },
  );
});
