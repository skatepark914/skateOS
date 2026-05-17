// ============================================================
// smartwaiver-lookup — Supabase Edge Function (Deno)
//
// Server-side proxy to the Smartwaiver API. The Smartwaiver API key
// stays in this function's secret env var — NEVER ships to the browser.
//
// Called by admin/smartwaiver.js via:
//   POST /functions/v1/smartwaiver-lookup
//   { action: 'lookup_by_email' | 'lookup_by_id' | 'recent', payload: {...} }
//
// On a successful waiver hit, also writes the matching customer row in
// Supabase: customers.waiver_id + customers.waiver_signed_at.
//
// Required Edge Function secrets:
//   SMARTWAIVER_API_KEY    — from https://api.smartwaiver.com/dashboard
//   SUPABASE_URL           — auto-populated by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-populated by Supabase
//
// Deploy:
//   supabase functions deploy smartwaiver-lookup --project-ref zecurmlenxyxanqucrga
//   supabase secrets set SMARTWAIVER_API_KEY=sw_xxx --project-ref zecurmlenxyxanqucrga
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SW_BASE = "https://api.smartwaiver.com/v4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- helpers -----------------------------------------------------------

async function sw(path: string, params?: Record<string, string>) {
  const apiKey = Deno.env.get("SMARTWAIVER_API_KEY");
  if (!apiKey) throw new Error("SMARTWAIVER_API_KEY not set");
  const qs = params
    ? "?" + Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    : "";
  const r = await fetch(`${SW_BASE}${path}${qs}`, {
    headers: { "sw-api-key": apiKey },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Smartwaiver ${r.status}: ${body}`);
  }
  return r.json();
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// Pull useful fields out of a Smartwaiver waiver record (shape varies by version).
function extractWaiver(w: any) {
  return {
    waiver_id: w?.waiverId || w?.waiver_id || w?.id,
    signed_at: w?.createdOn || w?.created_on || w?.signedDate || w?.signed_date || null,
    pdf_url: w?.pdf || w?.pdfUrl || null,
    email: (w?.participants?.[0]?.email
      || w?.email
      || w?.firstParticipant?.email
      || "").toString().toLowerCase().trim(),
    first: w?.participants?.[0]?.firstName || w?.firstName || null,
    last: w?.participants?.[0]?.lastName || w?.lastName || null,
  };
}

// Upsert customers.waiver_id + .waiver_signed_at + .waiver_pdf_url for a given email.
// If the customer doesn't exist yet, we DO NOT create a row here — the front desk
// creates customers via the admin UI. We only update existing matches.
async function syncCustomerByEmail(w: ReturnType<typeof extractWaiver>) {
  if (!w.email || !w.waiver_id) return null;
  const sb = admin();
  const { data, error } = await sb
    .from("customers")
    .update({
      waiver_id: w.waiver_id,
      waiver_signed_at: w.signed_at,
      waiver_pdf_url: w.pdf_url,
    })
    .eq("email", w.email)
    .select("id, name, waiver_signed_at");
  if (error) throw error;
  return data;
}

// --- request handler ---------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { action, payload } = body || {};

  try {
    if (action === "lookup_by_email") {
      // Smartwaiver: GET /waivers?fromDts=...&search=email
      const email = (payload?.email || "").toString().toLowerCase().trim();
      if (!email) throw new Error("payload.email required");
      const r = await sw("/waivers", { search: email, limit: "5" });
      const waivers = (r?.waivers || []).map(extractWaiver).filter((w: any) => w.email === email);
      const synced = waivers.length ? await syncCustomerByEmail(waivers[0]) : null;
      return json({ waivers, synced });
    }

    if (action === "lookup_by_id") {
      const id = (payload?.id || "").toString();
      if (!id) throw new Error("payload.id required");
      const r = await sw(`/waivers/${id}`);
      const w = extractWaiver(r?.waiver || r);
      const synced = await syncCustomerByEmail(w);
      return json({ waiver: w, synced });
    }

    if (action === "recent") {
      const limit = Math.min(Number(payload?.limit) || 25, 100);
      const r = await sw("/waivers", { limit: String(limit) });
      return json({ waivers: (r?.waivers || []).map(extractWaiver) });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
