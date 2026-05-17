// ============================================================
// _brivo/api.ts — Brivo ACS Web API client (shared helper)
// ============================================================
// Wraps Brivo's REST API for skateOS Edge Functions. OAuth 2.0
// client-credentials flow, in-memory token caching within an
// invocation, retry-on-401, clear error reporting.
//
// Credentials are read from these env vars (set via supabase secrets):
//   BRIVO_CLIENT_ID         — OAuth client ID from Brivo dashboard
//   BRIVO_CLIENT_SECRET     — OAuth client secret
//   BRIVO_API_KEY           — Subscription API key (separate from OAuth)
//   BRIVO_ACCOUNT_ID        — Brivo account/organization ID
//
// API ENDPOINTS USED:
//   POST https://auth.brivo.com/oauth/token  (OAuth client_credentials)
//   GET  https://api.brivo.com/v1/api/users/{id}
//   POST https://api.brivo.com/v1/api/users
//   PUT  https://api.brivo.com/v1/api/users/{id}
//   POST https://api.brivo.com/v1/api/users/{userId}/groups/{groupId}
//   DEL  https://api.brivo.com/v1/api/users/{userId}/groups/{groupId}
//   GET  https://api.brivo.com/v1/api/groups/{groupId}/users
//   POST https://api.brivo.com/v1/api/credentials
//
// IMPORTANT: Brivo's exact API paths can vary slightly by account
// region and API version tier. If a call 404s or 400s after secrets
// are wired, check the response body in webhook_log for the URL
// that actually was hit and compare with your Brivo dashboard's
// "API documentation" link in API Management. Adjust BRIVO_API_BASE
// or the per-endpoint paths below.
// ============================================================

const BRIVO_OAUTH_URL = "https://auth.brivo.com/oauth/token";
const BRIVO_API_BASE  = "https://api.brivo.com/v1/api";

export interface BrivoEnv {
  clientId:     string;
  clientSecret: string;
  apiKey:       string;
  accountId:    string;
  // Optional per-tenant Brivo dashboard config (mig 069). When set, the
  // Edge Function uses these instead of the BRIVO_*_ID env vars.
  activeMembersGroupId?:      string;
  parkDoorAccessPointId?:     string;
  shopDoorAccessPointId?:     string;
  operatingHoursScheduleId?:  string;
  webhookSecret?:             string;
  autoCheckinEnabled?:        boolean;
  source?:                    "tenant_table" | "env_vars";
}

// Single-tenant fallback — reads from Supabase secrets (env vars).
// 2nd Nature Park's current install uses this path.
export function loadBrivoEnv(): BrivoEnv | null {
  const clientId     = Deno.env.get("BRIVO_CLIENT_ID");
  const clientSecret = Deno.env.get("BRIVO_CLIENT_SECRET");
  const apiKey       = Deno.env.get("BRIVO_API_KEY");
  const accountId    = Deno.env.get("BRIVO_ACCOUNT_ID");
  if (!clientId || !clientSecret || !apiKey || !accountId) return null;
  return {
    clientId, clientSecret, apiKey, accountId,
    activeMembersGroupId:     Deno.env.get("BRIVO_ACTIVE_MEMBERS_GROUP_ID") || undefined,
    parkDoorAccessPointId:    Deno.env.get("BRIVO_PARK_DOOR_AP_ID") || undefined,
    shopDoorAccessPointId:    Deno.env.get("BRIVO_SHOP_DOOR_AP_ID") || undefined,
    operatingHoursScheduleId: Deno.env.get("BRIVO_OPERATING_HOURS_SCHEDULE_ID") || undefined,
    webhookSecret:            Deno.env.get("BRIVO_WEBHOOK_SECRET") || undefined,
    autoCheckinEnabled:       (Deno.env.get("BRIVO_AUTO_CHECKIN_ENABLED") ?? "true") !== "false",
    source: "env_vars",
  };
}

// Per-tenant lookup — reads tenant_brivo_config (mig 069). Falls back to
// env vars when the table has no row for this tenant OR when credentials
// columns are NULL. Returns null when neither source has full credentials.
//
// `sb` must be the service_role client (Edge Functions use admin()) so
// the RLS-blocked tenant_brivo_config table is readable.
export async function loadBrivoEnvForTenant(
  sb: any,
  tenantId: string | null | undefined,
): Promise<BrivoEnv | null> {
  if (!tenantId) return loadBrivoEnv();
  try {
    const { data, error } = await sb.from("tenant_brivo_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      // Table may not exist yet (pre-mig-069) — silent fall-through
      console.warn("tenant_brivo_config read non-fatal:", error.message);
      return loadBrivoEnv();
    }
    if (!data || !data.client_id || !data.client_secret || !data.api_key || !data.account_id) {
      // Row exists but incomplete — fall back to env vars
      return loadBrivoEnv();
    }
    return {
      clientId:                  data.client_id,
      clientSecret:              data.client_secret,
      apiKey:                    data.api_key,
      accountId:                 data.account_id,
      activeMembersGroupId:      data.active_members_group_id     || Deno.env.get("BRIVO_ACTIVE_MEMBERS_GROUP_ID") || undefined,
      parkDoorAccessPointId:     data.park_door_ap_id              || Deno.env.get("BRIVO_PARK_DOOR_AP_ID") || undefined,
      shopDoorAccessPointId:     data.shop_door_ap_id              || Deno.env.get("BRIVO_SHOP_DOOR_AP_ID") || undefined,
      operatingHoursScheduleId:  data.operating_hours_schedule_id  || Deno.env.get("BRIVO_OPERATING_HOURS_SCHEDULE_ID") || undefined,
      webhookSecret:             data.webhook_secret               || Deno.env.get("BRIVO_WEBHOOK_SECRET") || undefined,
      autoCheckinEnabled:        data.auto_checkin_enabled !== false,
      source: "tenant_table",
    };
  } catch (e) {
    console.warn("loadBrivoEnvForTenant exception, falling back to env:", e);
    return loadBrivoEnv();
  }
}

// ── OAuth token (cached for the invocation) ──────────────────
let _tokenCache: { token: string; expiresAt: number } | null = null;

export async function getBrivoToken(env: BrivoEnv): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 30_000) {
    return _tokenCache.token;
  }
  const basic = btoa(`${env.clientId}:${env.clientSecret}`);
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const r = await fetch(BRIVO_OAUTH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type":  "application/x-www-form-urlencoded",
      "api-key":       env.apiKey,
    },
    body: body.toString(),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Brivo OAuth ${r.status}: ${txt.slice(0, 200)}`);
  }
  const j = await r.json();
  const ttlMs = (Number(j.expires_in) || 3600) * 1000;
  _tokenCache = { token: j.access_token, expiresAt: now + ttlMs };
  return _tokenCache.token;
}

// ── Authenticated request wrapper ────────────────────────────
export async function brivoFetch(
  env: BrivoEnv,
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<{ status: number; data: any; raw: string }> {
  const url = path.startsWith("http") ? path : `${BRIVO_API_BASE}${path}`;

  async function doFetch(token: string) {
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("api-key",       env.apiKey);
    if (init.json !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    const r = await fetch(url, {
      method:  init.method ?? "GET",
      headers,
      body:    init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    const raw = await r.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    return { status: r.status, data, raw, ok: r.ok };
  }

  let token = await getBrivoToken(env);
  let resp = await doFetch(token);

  // Retry once on 401 (token may have been revoked)
  if (resp.status === 401) {
    _tokenCache = null;
    token = await getBrivoToken(env);
    resp = await doFetch(token);
  }
  return { status: resp.status, data: resp.data, raw: resp.raw };
}

// ── Domain helpers ───────────────────────────────────────────

export interface BrivoUserCreate {
  firstName: string;
  lastName:  string;
  email?:    string;
  phone?:    string;
  externalId?: string;   // skateOS customer UUID — round-trips via Brivo
}

export async function createBrivoUser(env: BrivoEnv, u: BrivoUserCreate): Promise<string> {
  const r = await brivoFetch(env, "/users", {
    method: "POST",
    json: {
      firstName:   u.firstName,
      lastName:    u.lastName,
      contactInfo: [
        ...(u.email ? [{ type: "email", value: u.email }] : []),
        ...(u.phone ? [{ type: "phone", value: u.phone }] : []),
      ],
      externalId:  u.externalId,
    },
  });
  if (r.status >= 200 && r.status < 300 && r.data?.id) {
    return String(r.data.id);
  }
  throw new Error(`Brivo create user failed (${r.status}): ${r.raw.slice(0, 300)}`);
}

export async function updateBrivoUser(env: BrivoEnv, brivoUserId: string, patch: Partial<BrivoUserCreate>): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.firstName)  body.firstName  = patch.firstName;
  if (patch.lastName)   body.lastName   = patch.lastName;
  if (patch.externalId) body.externalId = patch.externalId;
  if (patch.email || patch.phone) {
    body.contactInfo = [
      ...(patch.email ? [{ type: "email", value: patch.email }] : []),
      ...(patch.phone ? [{ type: "phone", value: patch.phone }] : []),
    ];
  }
  if (Object.keys(body).length === 0) return;
  const r = await brivoFetch(env, `/users/${brivoUserId}`, { method: "PUT", json: body });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Brivo update user failed (${r.status}): ${r.raw.slice(0, 300)}`);
  }
}

export async function addUserToGroup(env: BrivoEnv, brivoUserId: string, groupId: string): Promise<void> {
  const r = await brivoFetch(env, `/users/${brivoUserId}/groups/${groupId}`, { method: "POST" });
  // 200/201 expected; 409 = already in group, treat as success
  if (r.status >= 200 && r.status < 300) return;
  if (r.status === 409) return;
  throw new Error(`Brivo add-to-group failed (${r.status}): ${r.raw.slice(0, 300)}`);
}

export async function removeUserFromGroup(env: BrivoEnv, brivoUserId: string, groupId: string): Promise<void> {
  const r = await brivoFetch(env, `/users/${brivoUserId}/groups/${groupId}`, { method: "DELETE" });
  if (r.status >= 200 && r.status < 300) return;
  if (r.status === 404) return; // already not in group
  throw new Error(`Brivo remove-from-group failed (${r.status}): ${r.raw.slice(0, 300)}`);
}

export async function listGroupMembers(env: BrivoEnv, groupId: string): Promise<Array<{ id: string; externalId?: string; firstName?: string; lastName?: string; email?: string }>> {
  // Brivo paginates — fetch all pages defensively (cap at 50 pages of 100)
  const out: Array<{ id: string; externalId?: string; firstName?: string; lastName?: string; email?: string }> = [];
  for (let pg = 0; pg < 50; pg++) {
    const r = await brivoFetch(env, `/groups/${groupId}/users?offset=${pg * 100}&pageSize=100`);
    if (r.status !== 200) throw new Error(`Brivo list-group failed (${r.status}): ${r.raw.slice(0, 300)}`);
    const items: any[] = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
    if (!items.length) break;
    for (const it of items) {
      const email = Array.isArray(it.contactInfo)
        ? it.contactInfo.find((c: any) => c.type === "email")?.value
        : undefined;
      out.push({
        id:         String(it.id),
        externalId: it.externalId ?? undefined,
        firstName:  it.firstName  ?? undefined,
        lastName:   it.lastName   ?? undefined,
        email,
      });
    }
    if (items.length < 100) break;
  }
  return out;
}

// Send Brivo Mobile Pass invite — Brivo's exact endpoint for this
// varies (some accounts expose it as /credentials/invite, others as
// /users/{id}/sendInvitation). We try the most common path and fall
// back; document the actual path in CLAUDE.md once verified live.
export async function sendMobilePassInvite(env: BrivoEnv, brivoUserId: string): Promise<{ ok: boolean; via: string; raw: string }> {
  // Try documented endpoint first
  let r = await brivoFetch(env, `/users/${brivoUserId}/credentials/mobilepass:invite`, { method: "POST", json: {} });
  if (r.status >= 200 && r.status < 300) return { ok: true, via: "credentials_mobilepass_invite", raw: r.raw };
  // Fallback path
  r = await brivoFetch(env, `/users/${brivoUserId}/sendInvitation`, { method: "POST", json: {} });
  if (r.status >= 200 && r.status < 300) return { ok: true, via: "sendInvitation", raw: r.raw };
  return { ok: false, via: "none", raw: r.raw };
}

// Shared owner-verification helper used by admin-triggered Brivo Edge
// Functions (save-config, lockdown, sync-schedule). Verifies caller's JWT
// resolves to an owner via is_owner() RPC + returns their tenant_id.
//
// Returns { ok: true, tenantId, actorEmail } on success, or
// { ok: false, status, error } when verification fails.
//
// Edge Functions call this near the top of their handler:
//   const v = await verifyOwnerFromRequest(req);
//   if (!v.ok) return jsonResponse({ ok: false, error: v.error }, v.status);
//
// (Inline createClient avoided here — caller imports createClient themselves
// to keep this module pure of supabase-client deps. We accept the JWT string.)
export interface OwnerVerification {
  ok: boolean;
  tenantId?: string;
  actorEmail?: string | null;
  status?: number;
  error?: string;
}

// Convenience extractor — pulls JWT from Authorization header
export function extractJwt(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// HMAC-SHA256 webhook signature verification (Brivo signs with
// shared secret you configure in the dashboard). Tolerates both
// hex and base64 encoding.
export async function verifyBrivoSignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const bytes = new Uint8Array(mac);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  const b64 = btoa(String.fromCharCode(...bytes));
  const cleaned = signature.replace(/^sha256=/, "");
  return cleaned === hex || cleaned === b64;
}
