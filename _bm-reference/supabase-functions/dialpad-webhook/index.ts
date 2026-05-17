// Dialpad webhook receiver — logs inbound calls, SMS, voicemails into Supabase.
//
// Deploy:
//   supabase functions deploy dialpad-webhook --no-verify-jwt
//
// Then in Dialpad admin → Automations → Webhooks, add:
//   https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/dialpad-webhook
//   Events: call.ringing, call.completed, sms.received, voicemail.created
//   Secret: (set as DIALPAD_WEBHOOK_SECRET env var in Supabase)
//
// Table expected:
//   CREATE TABLE communications (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
//     channel text NOT NULL,         -- 'call' | 'sms' | 'voicemail'
//     direction text NOT NULL,        -- 'inbound' | 'outbound'
//     from_number text,
//     to_number text,
//     duration_seconds int,
//     body text,                      -- sms body or voicemail transcript
//     recording_url text,
//     status text,                    -- 'ringing' | 'completed' | 'missed' etc.
//     dialpad_id text UNIQUE,
//     metadata jsonb,
//     created_at timestamptz DEFAULT now()
//   );
//   CREATE INDEX idx_comms_client ON communications(client_id);
//   CREATE INDEX idx_comms_created ON communications(created_at DESC);

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("DIALPAD_WEBHOOK_SECRET") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function normPhone(n?: string): string {
  if (!n) return "";
  return String(n).replace(/\D/g, "").slice(-10);
}

async function findClientByPhone(phone: string): Promise<string | null> {
  const p = normPhone(phone);
  if (p.length < 7) return null;
  // Try last-10-digits match against clients.phone
  const { data } = await sb
    .from("clients")
    .select("id, phone")
    .ilike("phone", `%${p}%`)
    .limit(1);
  return data && data.length ? data[0].id : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Optional shared-secret check (set same value in Dialpad + Supabase env)
  if (WEBHOOK_SECRET) {
    const got = req.headers.get("x-dialpad-signature") || req.headers.get("authorization") || "";
    if (!got.includes(WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const event: string = payload.event_type || payload.event || "unknown";
  const data = payload.data || payload;

  // Normalize across Dialpad event shapes
  let row: any = {
    channel: "call",
    direction: "inbound",
    from_number: data.from_number || data.external_number || data.from || null,
    to_number: data.to_number || data.internal_number || data.to || null,
    duration_seconds: data.duration || null,
    body: null,
    recording_url: data.recording_url || null,
    status: data.state || event,
    dialpad_id: String(data.call_id || data.id || data.uuid || `${event}-${Date.now()}`),
    metadata: payload,
  };

  if (event.startsWith("sms")) {
    row.channel = "sms";
    row.direction = data.direction === "outbound" ? "outbound" : "inbound";
    row.body = data.text || data.message || data.body || null;
  } else if (event.startsWith("voicemail")) {
    row.channel = "voicemail";
    row.body = data.transcription || data.transcript || null;
  } else if (event.startsWith("call")) {
    row.channel = "call";
    row.direction = data.direction === "outbound" ? "outbound" : "inbound";
  }

  // Try to auto-link to a client by phone number
  const lookupPhone = row.direction === "inbound" ? row.from_number : row.to_number;
  if (lookupPhone) {
    row.client_id = await findClientByPhone(lookupPhone);
  }

  // Upsert (idempotent on dialpad_id)
  const { error } = await sb
    .from("communications")
    .upsert(row, { onConflict: "dialpad_id" });

  if (error) {
    console.error("dialpad-webhook insert failed:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, matched_client: !!row.client_id }), {
    headers: { "content-type": "application/json" },
  });
});
