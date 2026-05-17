// ============================================================
// helcim-invoice — Supabase Edge Function (Deno)
//
// Creates a Helcim invoice and returns the hosted-payment URL.
// Used for remote payment flows: birthday party deposits, lesson
// packages booked over the phone, member renewals texted to a
// parent, etc.
//
// Status: BUILT FROM HELCIM PUBLIC DOCS, NEVER TESTED LIVE.
// See header in helcim-charge/index.ts for setup steps —
// same HELCIM_API_TOKEN secret is reused.
//
// API reference:
//   POST https://api.helcim.com/v2/invoices/
//   Auth: api-token: <HELCIM_API_TOKEN>
//   Body: { currency, lineItems[], billingAddress?, tax?, discount? }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return new Response("Only POST", { status: 405, headers: corsHeaders });

  const apiToken = Deno.env.get("HELCIM_API_TOKEN");
  if (!apiToken) {
    return new Response(
      JSON.stringify({ ok: false, error: "HELCIM_API_TOKEN not set." }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: "invalid JSON" }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } }); }

  // ---- normalize inputs -----------------------------------------------
  // Accept the admin's loose shape and translate to Helcim's strict shape.
  // {
  //   currency: 'USD',
  //   customer: { code?, email, name },
  //   lineItems: [{ sku, description, quantity, price }],
  //   tax?, discount?, billingAddress?, dueDate?, notes?,
  //   skateos_invoice_id?  -- our internal ID for backref
  // }
  const currency = (body?.currency || "USD").toUpperCase();
  const items = Array.isArray(body?.lineItems) ? body.lineItems : [];
  if (items.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "lineItems[] required (sku, description, quantity, price)" }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
  for (const it of items) {
    if (!it.description || !it.quantity || it.price == null) {
      return new Response(JSON.stringify({ ok: false, error: "each line item needs description, quantity, price" }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });
    }
  }

  const helcimBody: Record<string, unknown> = {
    currency,
    lineItems: items.map((it: any) => ({
      sku:         it.sku || "",
      description: it.description,
      quantity:    Number(it.quantity),
      price:       Number(it.price),
    })),
  };
  if (body.tax)            helcimBody.tax = body.tax;
  if (body.discount)       helcimBody.discount = body.discount;
  if (body.billingAddress) helcimBody.billingAddress = body.billingAddress;
  if (body.dueDate)        helcimBody.dueDate = body.dueDate;
  if (body.notes)          helcimBody.notes = body.notes;
  if (body.customer)       helcimBody.customer = body.customer;

  // ---- call Helcim ---------------------------------------------------
  let helcimResp: Response;
  try {
    helcimResp = await fetch(`${HELCIM_BASE}/invoices/`, {
      method: "POST",
      headers: {
        "api-token":    apiToken,
        "accept":       "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(helcimBody),
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: "network error calling Helcim", details: (e as Error).message }),
      { status: 502, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const helcimResult = await helcimResp.json().catch(() => ({}));
  const helcimOk = helcimResp.ok;

  // ---- write back to local invoices table if a skateos_invoice_id was passed -
  if (body.skateos_invoice_id && helcimOk) {
    try {
      const sb = admin();
      await sb.from("invoices").update({
        payment_provider: "helcim",
        payment_id:       helcimResult?.invoiceNumber ? String(helcimResult.invoiceNumber) : null,
        sent_at:          new Date().toISOString(),
        status:           "sent",
      }).eq("id", body.skateos_invoice_id);
    } catch (e) {
      console.warn("Failed to update invoice row after Helcim invoice create:", e);
    }
  }

  // The hosted-pay URL Helcim returns lets you text/email it to the customer.
  return new Response(
    JSON.stringify({
      ok: helcimOk,
      helcimInvoiceNumber: helcimResult?.invoiceNumber,
      hostedPaymentUrl:    helcimResult?.hostedPaymentUrl,  // share with customer
      pdfUrl:              helcimResult?.pdfUrl,
      helcimStatus:        helcimResp.status,
      helcim:              helcimResult,
    }, null, 2),
    { status: helcimOk ? 200 : 502, headers: { ...corsHeaders, "content-type": "application/json" } },
  );
});
