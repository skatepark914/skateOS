// ============================================================
// brivo-test — connectivity probe for Brivo REST API
//
// Doug picked "polling via REST API" for Brivo integration. Before
// building the full poll loop, this function tests:
//   1. BRIVO_CLIENT_ID + BRIVO_CLIENT_SECRET get an OAuth token
//   2. BRIVO_API_KEY is accepted by the v1/api endpoints
//   3. /v1/api/events returns recent door events
//
// If all 3 work, we know polling is viable + can build the full
// brivo-poll function. If 1 or 2 fail, his Brivo tier doesn't have
// API access enabled.
// ============================================================
const OAUTH_URL = "https://auth.brivo.com/oauth/token";
const API_BASE  = "https://api.brivo.com/v1/api";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function out(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const cid    = Deno.env.get("BRIVO_CLIENT_ID");
  const csec   = Deno.env.get("BRIVO_CLIENT_SECRET");
  const apiKey = Deno.env.get("BRIVO_API_KEY");
  const acctId = Deno.env.get("BRIVO_ACCOUNT_ID");

  const result: any = {
    secrets_present: {
      BRIVO_CLIENT_ID:     !!cid,
      BRIVO_CLIENT_SECRET: !!csec,
      BRIVO_API_KEY:       !!apiKey,
      BRIVO_ACCOUNT_ID:    !!acctId,
    },
  };

  if (!cid || !csec || !apiKey || !acctId) {
    result.ok = false;
    result.error = "Missing one or more Brivo secrets. Set them via:\n" +
      "  supabase secrets set BRIVO_CLIENT_ID=... BRIVO_CLIENT_SECRET=... BRIVO_API_KEY=... BRIVO_ACCOUNT_ID=... --project-ref zecurmlenxyxanqucrga";
    return out(result, 200);
  }

  // ── Step 1: OAuth token ─────────────────────────────────────
  let token: string | null = null;
  try {
    const basicAuth = btoa(`${cid}:${csec}`);
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "Brivo.API.OnAir",
    });
    const r = await fetch(OAUTH_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "api-key": apiKey,
      },
      body: form.toString(),
    });
    const body = await r.text();
    result.oauth_step = {
      status: r.status,
      ok: r.ok,
      body_preview: body.slice(0, 400),
    };
    if (!r.ok) {
      result.ok = false;
      result.error = `OAuth token request failed: ${r.status}. Common causes: bad CLIENT_ID/SECRET, API key not approved for production, OAuth scope wrong for your tier.`;
      return out(result, 200);
    }
    try {
      const j = JSON.parse(body);
      token = j.access_token || null;
    } catch {}
    if (!token) {
      result.ok = false;
      result.error = "OAuth response didn't contain access_token. See body_preview above.";
      return out(result, 200);
    }
    result.oauth_step.token_received = true;
    result.oauth_step.token_preview = token.slice(0, 16) + "…";
  } catch (e) {
    result.ok = false;
    result.error = `OAuth fetch threw: ${(e as Error).message}`;
    return out(result, 200);
  }

  // ── Step 2: Probe an authenticated endpoint ────────────────
  // /v1/api/accounts/{accountId} is the simplest "are you alive" check.
  try {
    const r = await fetch(`${API_BASE}/accounts/${acctId}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "api-key": apiKey,
      },
    });
    const body = await r.text();
    result.account_probe = {
      status: r.status,
      ok: r.ok,
      body_preview: body.slice(0, 300),
    };
    if (!r.ok) {
      result.ok = false;
      result.error = `Account probe failed: ${r.status}. Token works but this endpoint rejected. Check API_KEY scope or ACCOUNT_ID.`;
      return out(result, 200);
    }
  } catch (e) {
    result.account_probe = { error: (e as Error).message };
  }

  // ── Step 3: Probe events endpoint (the one we'll poll) ─────
  // Brivo's events endpoint is on the access control sub-API.
  // Path can vary by tier — try the standard one first.
  const eventsTries = [
    `${API_BASE}/events?offset=0&pageSize=10`,
    `${API_BASE}/accounts/${acctId}/events?offset=0&pageSize=10`,
  ];
  for (const url of eventsTries) {
    try {
      const r = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "api-key": apiKey,
        },
      });
      const body = await r.text();
      result.events_probe = result.events_probe || {};
      result.events_probe[url] = {
        status: r.status,
        ok: r.ok,
        body_preview: body.slice(0, 500),
      };
      if (r.ok) {
        try {
          const j = JSON.parse(body);
          result.events_probe[url].count = Array.isArray(j.data) ? j.data.length : (Array.isArray(j) ? j.length : "unknown");
        } catch {}
        result.events_probe.working_url = url;
        break;
      }
    } catch (e) {
      result.events_probe = result.events_probe || {};
      result.events_probe[url] = { error: (e as Error).message };
    }
  }

  result.ok = !!result.events_probe?.working_url;
  if (!result.ok) {
    result.next_step = "Events endpoint not found at standard paths. Your Brivo tier may not include API event access. Either upgrade Brivo or skip polling (option C from the chat).";
  } else {
    result.next_step = "✅ All 3 probes passed. Ready to build full brivo-poll function + pg_cron schedule.";
  }
  return out(result, 200);
});
