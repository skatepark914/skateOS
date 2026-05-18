// ============================================================
// smartwaiver-webhook — Supabase Edge Function (Deno)
//
// Receives Smartwaiver POST callbacks when a new waiver is signed.
// Updates customers.waiver_id / .waiver_signed_at / .waiver_pdf_url
// so the check-in screen can clear the gate without a manual lookup.
//
// Configure in Smartwaiver dashboard → Settings → Webhooks:
//   URL:    https://zecurmlenxyxanqucrga.supabase.co/functions/v1/smartwaiver-webhook
//   Event:  Waiver Signed (and Waiver Updated, if you want re-syncs)
//   Secret: copy whatever you set; we verify it via header.
//
// Required Edge Function secrets:
//   SMARTWAIVER_WEBHOOK_SECRET — shared secret for header-based verification
//   SUPABASE_URL                — auto
//   SUPABASE_SERVICE_ROLE_KEY   — auto
//
// Deploy:
//   supabase functions deploy smartwaiver-webhook --project-ref zecurmlenxyxanqucrga --no-verify-jwt
//   supabase secrets set SMARTWAIVER_WEBHOOK_SECRET=xxx --project-ref zecurmlenxyxanqucrga
//
// NOTE: --no-verify-jwt because Smartwaiver doesn't send a Supabase JWT.
//        We verify via our shared secret header instead.
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SW_BASE = "https://api.smartwaiver.com/v4";

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function fetchWaiver(id: string) {
  const apiKey = Deno.env.get("SMARTWAIVER_API_KEY");
  if (!apiKey) throw new Error("SMARTWAIVER_API_KEY not set");
  const r = await fetch(`${SW_BASE}/waivers/${id}`, {
    headers: { "sw-api-key": apiKey },
  });
  if (!r.ok) throw new Error(`Smartwaiver ${r.status}`);
  return r.json();
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Only POST", { status: 405 });

  // Verify shared secret if configured.
  // Smartwaiver delivers the webhook private key as a `secret` form field
  // OR `?key=` query param OR `x-webhook-secret` header — accept any of them.
  const expectedSecret = Deno.env.get("SMARTWAIVER_WEBHOOK_SECRET");

  // Parse body — Smartwaiver sends application/x-www-form-urlencoded by default;
  // JSON is supported for clients that opt in. Handle both.
  let body: Record<string, any> = {};
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("application/json")) {
      body = await req.json();
    } else {
      // form-urlencoded OR multipart — read raw + URLSearchParams
      const raw = await req.text();
      const params = new URLSearchParams(raw);
      body = Object.fromEntries(params.entries());
    }
  } catch {
    return new Response("Invalid body", { status: 400 });
  }

  // Auth — accept secret from header, form field, or query param
  if (expectedSecret) {
    const url = new URL(req.url);
    const got = req.headers.get("x-webhook-secret")
      || body?.secret
      || body?.key
      || url.searchParams.get("secret")
      || url.searchParams.get("key")
      || "";
    if (got !== expectedSecret) {
      return new Response(`Unauthorized (no matching secret in header/body/query)`, { status: 401 });
    }
  }

  // Smartwaiver webhook payload typically contains { unique_id, event, waiverId, ... }
  const waiverId = body?.unique_id || body?.waiverId || body?.id;
  if (!waiverId) return new Response("Missing waiver id", { status: 400 });

  try {
    // Fetch the full waiver record so we have email + signed_at
    const full = await fetchWaiver(waiverId);
    const w = full?.waiver || full;
    const email = (w?.participants?.[0]?.email || w?.email || "").toString().toLowerCase().trim();
    if (!email) return new Response(JSON.stringify({ ok: true, note: "no email on waiver, skipped" }), { status: 200 });

    const sb = admin();
    const update = {
      waiver_id: w?.waiverId || w?.id || waiverId,
      waiver_signed_at: w?.createdOn || w?.signedDate || new Date().toISOString(),
      waiver_pdf_url: w?.pdf || null,
    };

    // Upsert into customers — only update if a customer with this email exists.
    const { data, error } = await sb
      .from("customers")
      .update(update)
      .eq("email", email)
      .select("id, name");

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, matched: data?.length || 0, email }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
