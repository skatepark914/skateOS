// ============================================================
// square-lesson-checkout — create Square Online Checkout for a lesson booking
//
// 1. Validates the slot is still open
// 2. Inserts a lesson row with status='pending_payment'
// 3. Creates a Square Online Checkout payment link via POST
//    /v2/online-checkout/payment-links
// 4. Stamps the lesson with the checkout URL + id
// 5. Returns { url, lesson_id } for the frontend to redirect
//
// Anon-callable. Uses service-role for DB writes (bypasses RLS).
//
// AUTH: SQUARE_ACCESS_TOKEN (already set as a Supabase secret —
// same token we use for catalog/customer/orders import).
// ============================================================

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-12-18";

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

// Lesson type → price-in-cents lookup. Adjustable via env vars later.
function priceCents(lessonType: string): number {
  switch ((lessonType || "").toLowerCase()) {
    case "private":  return 9000;  // $90
    case "group":    return 5000;  // $50/skater
    case "camp":     return 12000; // $120
    case "event":    return 10000;
    case "birthday": return 40000; // $400 minimum
    default:         return 9000;
  }
}

function lessonLabel(type: string): string {
  switch ((type || "").toLowerCase()) {
    case "private":  return "Private 1:1 Skate Lesson";
    case "group":    return "Group Skate Lesson";
    case "camp":     return "Skate Camp Session";
    case "birthday": return "Birthday Party · Skate Lesson";
    case "event":    return "Skate Event";
    default:         return "Skate Lesson";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "POST only" }, 405);

  const sqToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
  if (!sqToken) {
    return jsonResponse({ ok: false, error: "Square not configured (SQUARE_ACCESS_TOKEN missing)" }, 500);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const {
    instructor,
    lesson_type,
    slot_iso,
    skater_name,
    skater_email,
    skater_phone,
    parent_name,
    notes,
    return_url, // where Square redirects back to after payment
  } = body || {};

  // Validate inputs
  if (!instructor)          return jsonResponse({ ok: false, error: "Missing instructor" }, 400);
  if (!lesson_type)         return jsonResponse({ ok: false, error: "Missing lesson type" }, 400);
  if (!slot_iso)            return jsonResponse({ ok: false, error: "Missing slot time" }, 400);
  if (!skater_name)         return jsonResponse({ ok: false, error: "Missing skater name" }, 400);
  if (!skater_email && !skater_phone) {
    return jsonResponse({ ok: false, error: "Need email or phone" }, 400);
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Step 1: validate slot + create the lesson row via the existing
  // public_book_lesson RPC (race-safe). Then patch status to pending_payment.
  const { data: bookResp, error: bookErr } = await sb.rpc("public_book_lesson", {
    p_instructor:   instructor,
    p_lesson_type:  lesson_type,
    p_slot_iso:     slot_iso,
    p_skater_name:  skater_name,
    p_skater_email: skater_email || null,
    p_skater_phone: skater_phone || null,
    p_parent_name:  parent_name || null,
    p_notes:        notes || null,
  });

  if (bookErr || !bookResp?.ok) {
    return jsonResponse({
      ok: false,
      error: bookResp?.error || bookErr?.message || "Couldn't reserve slot",
    }, 400);
  }

  const lessonId: string = bookResp.lesson_id;

  // Step 2: get the price + label
  const amount = priceCents(lesson_type);
  const label = lessonLabel(lesson_type);

  // Step 3: create the Square Checkout payment link
  // Docs: https://developer.squareup.com/reference/square/checkout-api/create-payment-link
  // For QuickPay we provide a name + price; Square hosts the page.
  const idemKey = `lesson-${lessonId}-${Date.now()}`;
  const sqPayload: any = {
    idempotency_key: idemKey,
    quick_pay: {
      name: label + " with " + instructor,
      price_money: { amount, currency: "USD" },
      location_id: undefined,
    },
    pre_populated_data: {
      buyer_email: skater_email || undefined,
      // Square requires E.164 format. Normalize US phone numbers by
      // stripping non-digits + prepending +1 when we get 10 digits.
      // Skip pre-population if we can't make it E.164 — the customer can
      // still fill it in on the Square page.
      buyer_phone_number: (() => {
        if (!skater_phone) return undefined;
        const digits = String(skater_phone).replace(/\D/g, "");
        if (digits.length === 10) return "+1" + digits;
        if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
        return undefined;
      })(),
    },
    checkout_options: {
      redirect_url: (return_url
        ? `${return_url}?lesson=${lessonId}`
        : `https://skateos.com/2ntr/lessons/thanks?lesson=${lessonId}`),
      ask_for_shipping_address: false,
      merchant_support_email: "info@2ntr.com",
    },
    note: `Lesson booking · ${lesson_type} with ${instructor} · ${slot_iso} · ${skater_name}`,
  };

  // Pull first location to satisfy quick_pay.location_id
  try {
    const locRes = await fetch(`${SQUARE_BASE}/v2/locations`, {
      headers: {
        "Authorization": `Bearer ${sqToken}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
    });
    const locJson = await locRes.json();
    const locId = locJson?.locations?.[0]?.id;
    if (locId) sqPayload.quick_pay.location_id = locId;
  } catch (_e) {
    /* non-fatal */
  }

  const sqRes = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${sqToken}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sqPayload),
  });

  if (!sqRes.ok) {
    const errText = await sqRes.text();
    // Roll back the lesson — we don't want orphan pending bookings
    await sb.from("lessons").delete().eq("id", lessonId);
    return jsonResponse({
      ok: false,
      error: `Square checkout creation failed (${sqRes.status}): ${errText.slice(0, 280)}`,
    }, 500);
  }

  const sqJson = await sqRes.json();
  const link = sqJson?.payment_link;
  const url = link?.url || link?.long_url;
  const checkoutId = link?.id;

  if (!url) {
    await sb.from("lessons").delete().eq("id", lessonId);
    return jsonResponse({
      ok: false,
      error: `No payment URL returned: ${JSON.stringify(sqJson).slice(0, 280)}`,
    }, 500);
  }

  // Step 4: stamp the lesson with payment info + flip status
  await sb.from("lessons")
    .update({
      status: "pending_payment",
      square_checkout_id: checkoutId,
      payment_url: url,
      price: amount / 100,
    })
    .eq("id", lessonId);

  return jsonResponse({
    ok: true,
    url,
    lesson_id: lessonId,
    checkout_id: checkoutId,
    amount_cents: amount,
  });
});
