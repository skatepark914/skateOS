// ============================================================
// stripe-checkout — Supabase Edge Function (Deno)
//
// Creates a Stripe Checkout Session and returns the hosted-payment
// URL. The "get going now" card-payment path while Helcim is wired
// up later. Works for BOTH:
//   • In-person: cashier shows the QR / opens the link on the iPad,
//     customer taps to pay on Stripe's hosted page (zero PCI scope).
//   • Remote: text/email the link for deposits, renewals, party balances.
//
// Talks to Stripe's REST API directly with fetch + form-encoding
// (Stripe's API is form-encoded, not JSON) so there is NO SDK
// dependency to vendor.
//
// SECRET REQUIRED (set by owner, never in the browser):
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx --project-ref zecurmlenxyxanqucrga
//   (use sk_test_xxx first to smoke-test, then swap to live)
//
// Deploy:  bash admin/deploy-functions.sh   (or)
//          supabase functions deploy stripe-checkout --no-verify-jwt --project-ref zecurmlenxyxanqucrga
//
// Stripe API reference:
//   POST https://api.stripe.com/v1/checkout/sessions
//   Auth: Authorization: Bearer <STRIPE_SECRET_KEY>
//   Body (x-www-form-urlencoded): mode, success_url, cancel_url,
//        line_items[n][price_data][...], customer_email, metadata[...]
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_BASE = "https://api.stripe.com/v1";

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

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Only POST", { status: 405, headers: corsHeaders });

  const sk = Deno.env.get("STRIPE_SECRET_KEY");
  if (!sk) {
    return json({ ok: false, error: "STRIPE_SECRET_KEY not set. Owner must run: supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx --project-ref zecurmlenxyxanqucrga && bash admin/deploy-functions.sh" }, 500);
  }

  let body: any;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "invalid JSON" }, 400); }

  // ---- normalize inputs (accept the admin's loose shape) ---------------
  // {
  //   currency?: 'usd',
  //   customer?: { email?, name? },
  //   lineItems: [{ description, quantity, price }],   // price in DOLLARS
  //   tax?: number,                                     // dollars, added as a line
  //   amount?: number,                                  // dollars, fallback single-line
  //   success_url?, cancel_url?,
  //   skateos_sale_id?, skateos_invoice_id?, customer_id?
  // }
  const currency = String(body.currency || "usd").toLowerCase();
  const items: Array<{ description: string; quantity: number; price: number }> = Array.isArray(body.lineItems) ? body.lineItems : [];

  // Fallback: a single "amount" with no line breakdown.
  if (!items.length && body.amount != null) {
    items.push({ description: body.description || "2nd Nature Park", quantity: 1, price: Number(body.amount) || 0 });
  }
  if (!items.length) return json({ ok: false, error: "lineItems or amount required" }, 400);

  const cents = (d: number) => Math.round((Number(d) || 0) * 100);

  // ---- build Stripe form body -----------------------------------------
  const form = new URLSearchParams();
  form.set("mode", "payment");
  // Default redirect targets — overridable. {CHECKOUT_SESSION_ID} is Stripe's
  // placeholder, swapped server-side on redirect so the success page can verify.
  form.set("success_url", body.success_url || "https://app.skateos.com/paid.html?provider=stripe&session={CHECKOUT_SESSION_ID}");
  form.set("cancel_url", body.cancel_url || "https://app.skateos.com/");
  if (body.customer?.email) form.set("customer_email", body.customer.email);

  // BUG FIX 2026-06-22: this loop used to `continue` on amt <= 0, which
  // silently DROPPED any negative-amount line (e.g. cart-level discount
  // passed as { description:'Discount', price: -discount }). Customer
  // ended up charged the full pre-discount amount.
  //
  // Now: positive lines go through as before. Negative lines accumulate
  // into a single Stripe one-time coupon at the session level so the
  // checkout total matches the cart total.
  let li = 0;
  let discountCents = 0;
  for (const it of items) {
    const amt = cents(it.price);
    const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
    if (amt < 0) {
      discountCents += Math.abs(amt) * qty;
      continue;
    }
    if (amt === 0) continue;
    form.set(`line_items[${li}][price_data][currency]`, currency);
    form.set(`line_items[${li}][price_data][product_data][name]`, String(it.description || "Item").slice(0, 250));
    form.set(`line_items[${li}][price_data][unit_amount]`, String(amt));
    form.set(`line_items[${li}][quantity]`, String(qty));
    li++;
  }
  // If a discount was passed, create a one-time coupon and attach it to
  // the session. Stripe requires this two-step dance for cart-level
  // discounts (you can't just pass a negative line amount).
  if (discountCents > 0) {
    try {
      const coupForm = new URLSearchParams();
      coupForm.set("amount_off", String(discountCents));
      coupForm.set("currency", currency);
      coupForm.set("duration", "once");
      coupForm.set("name", "Discount");
      const cResp = await fetch(`${STRIPE_BASE}/coupons`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: coupForm.toString(),
      });
      const cData = await cResp.json();
      if (cResp.ok && cData?.id) form.set("discounts[0][coupon]", cData.id);
    } catch (_) { /* non-fatal — discount won't apply but session still works */ }
  }
  // Tax as its own line (admin already computed it into the cart).
  if (body.tax && Number(body.tax) > 0) {
    form.set(`line_items[${li}][price_data][currency]`, currency);
    form.set(`line_items[${li}][price_data][product_data][name]`, "Sales tax");
    form.set(`line_items[${li}][price_data][unit_amount]`, String(cents(body.tax)));
    form.set(`line_items[${li}][quantity]`, "1");
    li++;
  }
  if (li === 0) return json({ ok: false, error: "all line amounts were zero" }, 400);

  // Metadata for webhook reconciliation back into our DB.
  if (body.skateos_sale_id)    form.set("metadata[skateos_sale_id]", String(body.skateos_sale_id));
  if (body.skateos_invoice_id) form.set("metadata[skateos_invoice_id]", String(body.skateos_invoice_id));
  if (body.customer_id)        form.set("metadata[customer_id]", String(body.customer_id));
  if (body.customer?.name)     form.set("metadata[customer_name]", String(body.customer.name).slice(0, 200));

  // ---- call Stripe -----------------------------------------------------
  let resp: Response, data: any;
  try {
    resp = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sk}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    data = await resp.json();
  } catch (e) {
    return json({ ok: false, error: "Stripe request failed: " + (e as Error).message }, 502);
  }

  if (!resp.ok) {
    return json({ ok: false, stripeStatus: resp.status, error: data?.error?.message || "Stripe error", raw: data?.error }, 200);
  }

  // ---- best-effort: stamp the session id onto our invoice for backref --
  if (body.skateos_invoice_id) {
    try {
      await admin().from("invoices")
        .update({ stripe_session_id: data.id, notes: undefined })
        .eq("id", body.skateos_invoice_id);
    } catch (_) { /* non-fatal — column may not exist yet */ }
  }
  // Stamp the sales row too (mig 088) so the webhook can dedupe + cashier
  // can re-open the link from the receipt modal.
  if (body.skateos_sale_id) {
    try {
      await admin().from("sales")
        .update({
          stripe_checkout_session_id: data.id,
          stripe_payment_url: data.url,
        })
        .eq("id", body.skateos_sale_id);
    } catch (_) { /* non-fatal — pre-mig-088 installs */ }
  }

  return json({ ok: true, id: data.id, url: data.url, hostedPaymentUrl: data.url, provider: "stripe" });
});
