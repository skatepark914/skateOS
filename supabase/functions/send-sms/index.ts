// ============================================================
// send-sms — Supabase Edge Function (Deno)
//
// Twilio-backed SMS proxy for skateOS. Use cases:
//   - Lesson reminders 24h before scheduled time
//   - Punch-card "1 left" warnings
//   - Member-card link to scan at the door
//   - Helcim payment links texted to customers
//
// Adapted from BM's pattern (BM uses Twilio too — same Account SID
// and Auth Token shape).
//
// Status: BUILT, NOT DEPLOYED, NEVER TESTED LIVE.
//
// Setup:
//   1. Sign up at twilio.com, get a number (~$1.15/mo).
//   2. Buy + verify a sender number, or activate A2P 10DLC if you'll
//      send from a long code at scale.
//   3. Set the secrets:
//        supabase secrets set TWILIO_ACCOUNT_SID=ACxxx \
//          --project-ref zecurmlenxyxanqucrga
//        supabase secrets set TWILIO_AUTH_TOKEN=xxx \
//          --project-ref zecurmlenxyxanqucrga
//        supabase secrets set TWILIO_FROM_NUMBER=+19140000000 \
//          --project-ref zecurmlenxyxanqucrga
//   4. Deploy: bash admin/deploy-functions.sh
//
// Request shape:
//   {
//     to:   "+19145551234"  | ["+1...", "+1..."],
//     body: "Hey, your lesson at 2nd Nature is tomorrow at 4pm.",
//     from?: "+19140000000"  // override default
//   }
// Response:
//   { ok: true, sid: "SM..." }  on success
//   { ok: false, error: "...", details? } on failure
// ============================================================

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

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

function basicAuth(sid: string, token: string): string {
  return "Basic " + btoa(sid + ":" + token);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return new Response("Only POST", { status: 405, headers: corsHeaders });

  const sid       = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token     = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromEnv   = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !token) {
    return jsonResponse({
      ok: false,
      error: "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set on this Edge Function.",
    }, 500);
  }

  let body: any;
  try { body = await req.json(); }
  catch { return jsonResponse({ ok: false, error: "invalid JSON" }, 400); }

  const { to, body: msgBody, from: fromOverride } = body || {};
  if (!to)      return jsonResponse({ ok: false, error: "`to` is required" },   400);
  if (!msgBody) return jsonResponse({ ok: false, error: "`body` is required" }, 400);

  const fromNumber = fromOverride || fromEnv;
  if (!fromNumber) {
    return jsonResponse({ ok: false, error: "No `from` number — pass one or set TWILIO_FROM_NUMBER secret." }, 400);
  }

  // Twilio expects E.164 format
  const recipients = Array.isArray(to) ? to : [to];
  const badNum = recipients.find((n: unknown) => typeof n !== "string" || !/^\+\d{8,15}$/.test(n));
  if (badNum !== undefined) {
    return jsonResponse({ ok: false, error: `invalid phone (must be E.164 like +19145551234): ${String(badNum)}` }, 400);
  }

  // Twilio API only sends to one number per call; loop and aggregate
  const sids: string[] = [];
  const failures: { to: string; error: string }[] = [];

  for (const recipient of recipients) {
    const form = new URLSearchParams({
      To:   recipient,
      From: fromNumber,
      Body: String(msgBody),
    });

    let resp: Response;
    try {
      resp = await fetch(`${TWILIO_BASE}/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          "Authorization": basicAuth(sid, token),
          "Content-Type":  "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
    } catch (e) {
      failures.push({ to: recipient, error: "network error: " + (e as Error).message });
      continue;
    }

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      failures.push({ to: recipient, error: result?.message || `Twilio returned ${resp.status}` });
    } else if (result?.sid) {
      sids.push(result.sid);
    }
  }

  if (sids.length && !failures.length) {
    return jsonResponse({ ok: true, sids });
  }
  if (sids.length && failures.length) {
    return jsonResponse({ ok: true, sids, failures, partial: true }, 207);
  }
  return jsonResponse({ ok: false, error: "all sends failed", failures }, 502);
});
