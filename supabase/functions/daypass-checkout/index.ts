// ============================================================
// daypass-checkout — public self-serve day-pass purchase
// ============================================================
// Drives admin/door.html (the laminated-QR "buy a pass at the door" page).
//
// POST {
//   name:  string,
//   email: string,
//   phone?: string,
//   dob?:  ISO date,
//   accept_waiver: boolean,    // must be true
//   hours?: number             // pass length, default 24, capped 1..72
// }
//
// Flow:
//   1. Validate + upsert the customer (CRM record created right here — this IS
//      the "info downloads into skateOS" step).
//   2. POOL CAP: count active day passes whose window still includes now. If
//      that's >= settings.brivo.dayPassPoolSize (default 25), refuse politely
//      and upsell — this is what stops walk-ups from blowing past the number of
//      Brivo mobile-pass licenses you keep in rotation.
//   3. Create a local invoice row + a Helcim hosted invoice tagged
//      "Day Pass: <customer_id> until <ISO>" in the notes.
//   4. Return the Helcim hostedPaymentUrl. The phone redirects there to pay.
//
// On payment, helcim-webhook sees invoice.paid + the "Day Pass:" marker and
// fires brivo-issue-event-pass(now .. now+hours) → customer gets their Brivo
// Mobile/Wallet Pass by email. The 5-min expiry sweep (mig 067) de-provisions
// when the window ends, returning the license to the pool.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DEFAULT_POOL = 25;
const DEFAULT_PRICE = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* tolerate */ }

  const name = String(body?.name || "").trim().slice(0, 120);
  const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);
  const phone = String(body?.phone || "").trim().slice(0, 40);
  const dob = String(body?.dob || "").trim() || null;
  const acceptWaiver = body?.accept_waiver === true;
  const hours = Math.max(1, Math.min(72, Math.floor(Number(body?.hours) || 24)));

  if (!name) return json({ ok: false, error: "name required" }, 400);
  if (!email && !phone) return json({ ok: false, error: "email or phone required" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "invalid email" }, 400);
  if (!acceptWaiver) return json({ ok: false, error: "waiver acknowledgement required" }, 400);

  const sb = admin();

  // ── settings: pool cap + price ────────────────────────────
  let poolCap = DEFAULT_POOL, price = DEFAULT_PRICE;
  try {
    const { data: s } = await sb.from("app_settings").select("value").eq("key", "all").maybeSingle();
    const v: any = (s as any)?.value || {};
    poolCap = Number(v?.brivo?.dayPassPoolSize ?? v?.dayPassPoolSize ?? DEFAULT_POOL) || DEFAULT_POOL;
    price = Number(v?.dayPassPrice ?? DEFAULT_PRICE) || DEFAULT_PRICE;
  } catch { /* defaults */ }

  // ── upsert customer (match email then phone digits) ───────
  const phoneDigits = phone.replace(/\D/g, "");
  let customer: any = null;
  if (email) {
    const { data } = await sb.from("customers").select("id, name, email, phone, waiver_signed_at, tenant_id").ilike("email", email).limit(1);
    customer = data?.[0] || null;
  }
  if (!customer && phoneDigits.length >= 10) {
    const { data } = await sb.from("customers").select("id, name, email, phone, waiver_signed_at, tenant_id").limit(50);
    customer = (data || []).find((c: any) => String(c.phone || "").replace(/\D/g, "").endsWith(phoneDigits.slice(-10))) || null;
  }
  if (customer) {
    const upd: any = {};
    if (acceptWaiver) upd.waiver_signed_at = new Date().toISOString();
    if (!customer.email && email) upd.email = email;
    if (!customer.phone && phone) upd.phone = phone;
    if (Object.keys(upd).length) await sb.from("customers").update(upd).eq("id", customer.id);
  } else {
    const { data, error } = await sb.from("customers").insert({
      name, email: email || null, phone: phone || null, dob,
      waiver_signed_at: acceptWaiver ? new Date().toISOString() : null,
      notes: `[Self-registered via door day-pass ${new Date().toISOString().slice(0, 10)}]`,
    }).select("id, tenant_id").single();
    if (error) return json({ ok: false, error: "could not create customer: " + error.message }, 500);
    customer = data;
  }

  // ── POOL CAP — the "not too many tokens" guard ────────────
  const { count: activeCount } = await sb
    .from("brivo_event_passes")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .ilike("reason", "%day pass%")
    .gt("valid_until", new Date().toISOString());
  if ((activeCount || 0) >= poolCap) {
    return json({
      ok: false, pool_full: true,
      message: `All ${poolCap} day-pass spots are currently in use. Buzz the intercom or grab a monthly membership for instant access.`,
      customer_id: customer.id,
    });
  }

  // ── create local invoice + Helcim hosted payment ──────────
  const validUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const notesMarker = `Day Pass: ${customer.id} until ${validUntil}`;
  let invoiceId: string | null = null;
  try {
    const { data: inv } = await sb.from("invoices").insert({
      customer_id: customer.id, tenant_id: customer.tenant_id,
      client_name: name, client_email: email || null,
      subject: `${hours}-hour day pass`,
      line_items: [{ description: `Day pass (${hours}h door access)`, quantity: 1, price }],
      total: price, balance: price, status: "sent", notes: notesMarker,
    }).select("id").single();
    invoiceId = (inv as any)?.id || null;
  } catch { /* invoice table optional — webhook can still match on customer */ }

  const helcimResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/helcim-invoice`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customer: { email, name },
      lineItems: [{ sku: "DAYPASS", description: `${hours}-hour day pass — door access`, quantity: 1, price }],
      notes: notesMarker,
      skateos_invoice_id: invoiceId,
    }),
  });
  const helcim = await helcimResp.json().catch(() => null);
  if (!helcim?.ok || !helcim?.hostedPaymentUrl) {
    return json({
      ok: false,
      error: "online payment isn't set up yet — please buzz the intercom for staff",
      detail: helcim?.error || null,
      customer_id: customer.id,
    }, 502);
  }

  return json({
    ok: true,
    customer_id: customer.id,
    hosted_payment_url: helcim.hostedPaymentUrl,
    valid_hours: hours,
    price,
  });
});
