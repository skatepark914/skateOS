// ============================================================
// helcim-pay-init — Supabase Edge Function (Deno)
//
// Initializes a HelcimPay.js checkout session. The HelcimPay
// flow (used for browser/iPad in-person card capture):
//
//   1. Front-desk admin calls THIS function with { amount }.
//   2. We call Helcim's /v2/helcim-pay/initialize with the
//      API token and get back a `checkoutToken`.
//   3. Browser embeds `https://secure.helcim.app/helcim-pay/services/start.js`
//      and calls `appendHelcimPayIframe(checkoutToken)`.
//   4. Customer enters card in the Helcim iframe.
//   5. Helcim posts a `helcim-pay-js-event` with eventStatus
//      = "SUCCESS" / "ABORTED" / "HIDE" — payload includes
//      transactionId, amount, cardType, etc. The transaction
//      has ALREADY HAPPENED at that point (Helcim charges via
//      the iframe; we just record the result).
//   6. Browser POSTs the result to a sales row update.
//
// Status: BUILT FROM HELCIM PUBLIC DOCS, NEVER TESTED LIVE.
//
// API reference:
//   POST https://api.helcim.com/v2/helcim-pay/initialize
//   Auth: api-token: <HELCIM_API_TOKEN>
//   Body: { paymentType: "purchase", amount, currency,
//           customerCode?, invoiceNumber?, ... }
//   Returns: { checkoutToken, secretToken? }
// ============================================================

const HELCIM_BASE = "https://api.helcim.com/v2";

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

  const apiToken = Deno.env.get("HELCIM_API_TOKEN");
  if (!apiToken) {
    return jsonResponse({
      ok: false,
      error: "HELCIM_API_TOKEN not set on this Edge Function. See helcim-charge/index.ts header for setup.",
    }, 500);
  }

  let body: any;
  try { body = await req.json(); }
  catch { return jsonResponse({ ok: false, error: "invalid JSON" }, 400); }

  const amount = Number(body?.amount);
  if (!amount || amount <= 0) {
    return jsonResponse({ ok: false, error: "`amount` is required and must be > 0" }, 400);
  }

  const helcimReq: Record<string, unknown> = {
    paymentType: body?.paymentType || "purchase",
    amount,
    currency: (body?.currency || "USD").toUpperCase(),
  };
  if (body.customerCode)   helcimReq.customerCode   = body.customerCode;
  if (body.invoiceNumber)  helcimReq.invoiceNumber  = String(body.invoiceNumber);
  if (body.taxAmount != null)      helcimReq.taxAmount = Number(body.taxAmount);
  if (body.allowPartial != null)   helcimReq.allowPartial = !!body.allowPartial;

  let helcimResp: Response;
  try {
    helcimResp = await fetch(`${HELCIM_BASE}/helcim-pay/initialize`, {
      method: "POST",
      headers: {
        "api-token":    apiToken,
        "accept":       "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(helcimReq),
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: "network error calling Helcim", details: (e as Error).message }, 502);
  }

  const helcimResult = await helcimResp.json().catch(() => ({}));
  if (!helcimResp.ok) {
    return jsonResponse({
      ok: false,
      error: helcimResult?.errors || helcimResult?.message || `Helcim returned ${helcimResp.status}`,
      helcimStatus: helcimResp.status,
      helcim: helcimResult,
    }, helcimResp.status);
  }

  return jsonResponse({
    ok: true,
    checkoutToken: helcimResult?.checkoutToken,
    secretToken:   helcimResult?.secretToken,  // used to verify the postMessage signature on the client
    helcim:        helcimResult,
  });
});
