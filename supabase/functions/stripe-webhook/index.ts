// ============================================================
// stripe-webhook — Supabase Edge Function (Deno)
//
// Receives Stripe events and marks the matching skateOS sale /
// invoice paid. The reliable money-confirmation path (the
// success_url redirect is just UX; this is the source of truth).
//
// Handles:
//   checkout.session.completed  (+ async_payment_succeeded)
//   charge.refunded             (mirrors full / partial refunds back)
//
// SECRET REQUIRED:
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx --project-ref zecurmlenxyxanqucrga
//   (copy from Stripe Dashboard → Developers → Webhooks → your endpoint)
//
// Endpoint to register in Stripe Dashboard:
//   https://zecurmlenxyxanqucrga.functions.supabase.co/stripe-webhook
//   Events: checkout.session.completed
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt --project-ref zecurmlenxyxanqucrga
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

// Stripe signature verification — HMAC-SHA256 over `${t}.${rawBody}`.
async function verify(raw: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const parts = Object.fromEntries(sigHeader.split(",").map((kv) => kv.split("=")));
    const t = parts["t"]; const v1 = parts["v1"];
    if (!t || !v1) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
    const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
    // True constant-time compare — iterates over max(a,b) length so the
    // early-return-on-length-mismatch doesn't leak timing on attacker-
    // supplied signatures. HMAC-SHA256 hex is always 64 chars; we set max
    // explicitly so static-analysis tools don't trip on the bounds.
    const maxLen = Math.max(hex.length, v1.length);
    let diff = hex.length ^ v1.length;
    for (let i = 0; i < maxLen; i++) {
      diff |= (hex.charCodeAt(i) || 0) ^ (v1.charCodeAt(i) || 0);
    }
    return diff === 0;
  } catch { return false; }
}

async function log(sb: any, event: string, status: string, ref_table: string | null, ref_id: string | null, payload: any, error?: string) {
  try {
    await sb.from("webhook_log").insert({
      source: "stripe-webhook", event_type: event, status,
      ref_table, ref_id, payload, error: error || null,
    });
  } catch (_) { /* webhook_log may not exist on older installs */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("Only POST", { status: 405, headers: cors });

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const raw = await req.text();
  const sb = admin();

  // Verify signature when the secret is configured (strongly recommended).
  if (secret) {
    const sig = req.headers.get("stripe-signature") || "";
    const ok = await verify(raw, sig, secret);
    if (!ok) { await log(sb, "?", "rejected", null, null, { reason: "bad signature" }); return new Response("bad signature", { status: 400, headers: cors }); }
  }

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return new Response("bad json", { status: 400, headers: cors }); }

  const type = evt?.type || "";
  const obj = evt?.data?.object || {};

  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    const meta = obj.metadata || {};
    const saleId = meta.skateos_sale_id;
    const invId = meta.skateos_invoice_id;
    const paidAt = new Date().toISOString();
    const txnId = obj.payment_intent || obj.id;

    // Mark sale completed/paid (mig 088 columns)
    if (saleId) {
      try {
        await sb.from("sales").update({
          status: "completed",
          payment_method: "Card (Stripe)",
          stripe_payment_intent_id: txnId,
          stripe_paid_at: paidAt,
        }).eq("id", saleId);
      } catch (_) {}
      await log(sb, type, "ok", "sales", saleId, { amount_total: obj.amount_total, txnId });
    } else {
      // Fallback: locate sale by stripe_checkout_session_id (mig 088 unique index)
      try {
        await sb.from("sales").update({
          status: "completed",
          payment_method: "Card (Stripe)",
          stripe_payment_intent_id: txnId,
          stripe_paid_at: paidAt,
        }).eq("stripe_checkout_session_id", obj.id);
      } catch (_) {}
    }

    // Mark invoice paid
    if (invId) {
      try {
        await sb.from("invoices").update({ status: "paid", paid_at: paidAt }).eq("id", invId);
      } catch (_) {}
      await log(sb, type, "ok", "invoices", invId, { amount_total: obj.amount_total, txnId });
    }

    if (!saleId && !invId) await log(sb, type, "ignored", null, null, { reason: "no skateos metadata", session: obj.id });
  } else if (type === "charge.refunded") {
    // Mirror refunds back to skateOS. Look up by payment_intent_id (mig 088).
    // Use GREATEST so out-of-order webhook deliveries (Stripe doesn't
    // guarantee ordering for multiple partial refunds) can't decrease an
    // already-recorded refund total.
    const piId = obj.payment_intent;
    const refundedTotal = (obj.amount_refunded || 0) / 100;
    const fullyRefunded = obj.refunded === true;
    if (piId) {
      try {
        // First fetch current refunded_amount so we can max() in app code
        // (PostgREST doesn't support GREATEST() in PATCH directly).
        const { data: cur } = await sb.from("sales")
          .select("refunded_amount").eq("stripe_payment_intent_id", piId).maybeSingle();
        const curAmt = Number(cur?.refunded_amount || 0);
        const finalAmt = Math.max(curAmt, refundedTotal);
        const patch: Record<string, unknown> = {
          refunded_amount: finalAmt,
          refunded_at: new Date().toISOString(),
        };
        if (fullyRefunded) patch.status = "refunded";
        await sb.from("sales").update(patch).eq("stripe_payment_intent_id", piId);
      } catch (_) {}
      await log(sb, type, "ok", "sales", null, { piId, refundedTotal, fullyRefunded });
    } else {
      await log(sb, type, "ignored", null, null, { reason: "no payment_intent on charge" });
    }
  } else {
    await log(sb, type, "ignored", null, null, { id: obj.id });
  }

  // Always 200 so Stripe doesn't retry indefinitely on handled events.
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { ...cors, "content-type": "application/json" } });
});
