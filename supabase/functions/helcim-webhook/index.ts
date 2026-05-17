// ============================================================
// helcim-webhook — Supabase Edge Function (Deno)
//
// Receives Helcim's webhook callbacks (transaction.success,
// transaction.declined, invoice.paid, etc.) and updates the
// matching `sales` or `invoices` row in Supabase.
//
// Configure in Helcim dashboard → API Access → Webhooks:
//   URL:     https://zecurmlenxyxanqucrga.supabase.co/functions/v1/helcim-webhook
//   Events:  transaction events + invoice events
//   Secret:  set HELCIM_WEBHOOK_VERIFIER_TOKEN in Supabase secrets to verify
//
// Status: BUILT FROM PUBLIC DOCS, NEVER TESTED LIVE.
//
// API reference:
//   https://devdocs.helcim.com/docs/connected-account-webhooks
//   Helcim signs webhook payloads via webhookVerifierToken which you
//   compare against the body in HMAC-SHA256.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function verifyHmac(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(mac), b => b.toString(16).padStart(2, "0")).join("");
  // Accept either raw hex or base64 — Helcim's docs aren't crystal clear; tolerate both.
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return signature === hex || signature === b64;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Only POST", { status: 405 });

  const raw = await req.text();
  // Optional signature verification — turn ON by setting HELCIM_WEBHOOK_VERIFIER_TOKEN.
  // If unset, accept everything (URL obscurity, like Smartwaiver's webhook model).
  const verifier = Deno.env.get("HELCIM_WEBHOOK_VERIFIER_TOKEN");
  if (verifier) {
    const sig = req.headers.get("webhook-signature") || req.headers.get("x-helcim-signature") || "";
    const ok  = sig && await verifyHmac(raw, sig, verifier);
    if (!ok) return new Response("Bad signature", { status: 401 });
  }

  let body: any;
  try { body = JSON.parse(raw); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  // Helcim webhook payload shape (per docs): { id, type, dateCreated, ... }
  // type examples: 'cardTransaction.success', 'cardTransaction.declined',
  //                'invoice.paid', 'invoice.cancelled'
  const eventType = body?.type as string | undefined;
  const eventId   = body?.id ? String(body.id) : null;
  const ipAddr    = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const sb = admin();

  // Initial 'received' log entry — we'll update with the outcome below.
  let logId: string | null = null;
  try {
    const ins = await sb.from("webhook_log").insert({
      source:     "helcim",
      event_type: eventType ?? null,
      event_id:   eventId,
      status:     "received",
      payload:    body,
      ip_address: ipAddr,
    }).select("id").single();
    logId = (ins.data as any)?.id ?? null;
  } catch (e) {
    console.warn("Could not insert webhook_log row:", e);
  }

  let refTable: string | null = null;
  let refId: string | null = null;
  let outcomeStatus: "processed" | "error" | "ignored" = "ignored";
  let errorMessage: string | null = null;

  try {
    if (eventType?.startsWith("cardTransaction.")) {
      const txId = String(body?.id || body?.transactionId || "");
      if (txId) {
        const status = eventType === "cardTransaction.success" ? "completed"
                     : eventType === "cardTransaction.declined" ? "voided"
                     : eventType === "cardTransaction.refunded" ? "refunded"
                     : null;
        if (status) {
          const upd = await sb.from("sales").update({ status, payment_provider: "helcim" }).eq("payment_id", txId).select("id").maybeSingle();
          refTable = "sales";
          refId    = (upd.data as any)?.id ?? null;
          outcomeStatus = "processed";
        } else {
          outcomeStatus = "ignored";
        }
      }
    } else if (eventType?.startsWith("invoice.")) {
      const invNum = String(body?.invoiceNumber || body?.id || "");
      if (invNum) {
        const status = eventType === "invoice.paid"      ? "paid"
                     : eventType === "invoice.cancelled" ? "cancelled"
                     : eventType === "invoice.overdue"   ? "overdue"
                     : null;
        if (status) {
          const updates: Record<string, unknown> = { status };
          if (status === "paid") updates.paid_at = new Date().toISOString();
          const upd = await sb.from("invoices").update(updates).eq("payment_id", invNum).select("id, customer_id, notes").maybeSingle();
          refTable = "invoices";
          refId    = (upd.data as any)?.id ?? null;
          outcomeStatus = "processed";

          // ── Party deposit → auto-issue Brivo event pass (mig 067) ───
          // When a party-quote invoice flips to paid AND it has a linked
          // customer AND a parseable "Lesson ID: <uuid>" in the notes,
          // auto-fire brivo-issue-event-pass with the party's scheduled_at
          // + duration window. Closes the loop with admin/tools/party-quote.html.
          //
          // Idempotency: brivo-issue-event-pass refuses to issue retroactively
          // (valid_until > 1 hour ago = rejected) so retried webhooks won't
          // double-issue passes for parties that already happened.
          if (status === "paid" && (upd.data as any)?.customer_id) {
            try {
              const invRow = upd.data as { id: string; customer_id: string; notes: string | null };
              const lessonIdMatch = (invRow.notes || "").match(/Lesson ID:\s*([a-f0-9-]{30,})/i);
              if (lessonIdMatch) {
                const lessonId = lessonIdMatch[1];
                const { data: lesson } = await sb.from("lessons")
                  .select("scheduled_at, duration_min, type, customer_name")
                  .eq("id", lessonId)
                  .maybeSingle();
                const lessonType = (lesson as any)?.type;
                // Gate: only fire for party-type lessons. Other lesson types
                // (private/group/camp) use the standard membership flow.
                if (lesson && (lessonType === "birthday" || lessonType === "event" || lessonType === "party")) {
                  // Window: scheduled_at − 30 min (early arrival) to
                  // scheduled_at + duration + 30 min (party runs over).
                  const startMs = new Date((lesson as any).scheduled_at).getTime();
                  const durMin  = Number((lesson as any).duration_min || 120);
                  const validFrom  = new Date(startMs - 30 * 60 * 1000).toISOString();
                  const validUntil = new Date(startMs + (durMin + 30) * 60 * 1000).toISOString();
                  // Only fire if window isn't already in the past
                  if (new Date(validUntil).getTime() > Date.now() - 3600 * 1000) {
                    try {
                      const issueResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/brivo-issue-event-pass`, {
                        method: "POST",
                        headers: {
                          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                          "Content-Type":  "application/json",
                        },
                        body: JSON.stringify({
                          customer_id:  invRow.customer_id,
                          valid_from:   validFrom,
                          valid_until:  validUntil,
                          reason:       `Birthday party · auto-issued on Helcim deposit payment for invoice ${invNum}`,
                          send_invite:  true,
                          actor_email:  "helcim-webhook@auto",
                        }),
                      });
                      const issueData = await issueResp.json().catch(() => ({}));
                      console.log("party event pass auto-issue:", issueResp.status, issueData?.pass_id || issueData?.error);
                    } catch (passErr) {
                      console.warn("party event pass auto-issue exception (non-fatal):", passErr);
                    }
                  }
                }
              }
            } catch (partyErr) {
              console.warn("party auto-issue flow non-fatal:", partyErr);
            }
          }

          // ── Pre-order deposit + retail-order auto-flip ─────────────
          // If this invoice was created by the preorder flow, the cached
          // invoice number lives on form_submissions.data.helcim_invoice_number.
          // If this invoice was created by the retail-shop flow (mig 053),
          // same field. We look up either type of submission and flip the
          // appropriate status field based on which form_slug matched.
          //
          // For pre-orders: data.deposit_status='paid' + deposit_paid_at
          // For retail orders: data.payment_status='paid' + payment_paid_at
          // For invoice.cancelled: no-op (Doug handles via refund flow).
          if (status === "paid") {
            try {
              // Join form_submissions with forms so we can branch on the slug
              const { data: subs } = await sb.from("form_submissions")
                .select("id, data, forms(slug)")
                .eq("data->>helcim_invoice_number", invNum)
                .limit(1);
              if (subs && subs.length > 0) {
                const sub = subs[0] as { id: string; data: any; forms: { slug: string } | null };
                const slug = sub.forms?.slug || "";
                let newData;
                if (slug === "preorder-2026") {
                  newData = Object.assign({}, sub.data || {}, {
                    deposit_status:  "paid",
                    deposit_paid_at: new Date().toISOString(),
                    deposit_paid_via: "helcim_webhook",
                  });
                } else if (slug === "lesson-booking") {
                  newData = Object.assign({}, sub.data || {}, {
                    payment_status:  "paid",
                    payment_paid_at: new Date().toISOString(),
                    payment_paid_via: "helcim_webhook",
                  });
                  // Promote to real lessons row (mig 011 lessons table).
                  // Best-effort — failure here logs but doesn't break the
                  // payment flip. Doug can manually create the lesson if it
                  // fails (form_submissions captured the slot intent).
                  try {
                    const submissionData = sub.data || {};
                    const skater = submissionData.skater || {};
                    const contact = submissionData.contact || {};

                    // Try to find existing customer by email
                    let customerId: string | null = null;
                    if (contact.email) {
                      const { data: cust } = await sb.from("customers")
                        .select("id")
                        .eq("email", contact.email.toLowerCase())
                        .limit(1);
                      if (cust && cust.length > 0) customerId = cust[0].id;
                    }
                    // If still no match, auto-create a customer record so the
                    // lesson, customer detail, future loyalty, and reminders all
                    // attach properly. Best-effort — falls through to null
                    // customer_id if creation fails (cashier can manually link
                    // via the lesson modal afterwards).
                    if (!customerId && contact.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) {
                      try {
                        const insertPayload: any = {
                          name: skater.name || contact.name || 'Online booking',
                          email: contact.email.toLowerCase(),
                          phone: contact.phone || null,
                          notes: '[Auto-created ' + new Date().toISOString().slice(0,10) +
                                 ' via book.skateos.com lesson booking ' + (sub.id||'').slice(0,8) + ']'
                                 + (skater.age ? '\nAge: ' + skater.age : '')
                                 + (skater.skill_level ? '\nSkill: ' + skater.skill_level : ''),
                        };
                        // If skater age < 18, capture parent contact in
                        // dedicated columns (mig 001 schema)
                        if (skater.age && Number(skater.age) < 18) {
                          insertPayload.parent_name = contact.name || null;
                          insertPayload.parent_phone = contact.phone || null;
                          insertPayload.parent_email = contact.email.toLowerCase();
                        }
                        const { data: newCust, error: custErr } = await sb.from("customers")
                          .insert(insertPayload)
                          .select("id")
                          .single();
                        if (custErr) {
                          console.warn("Lesson customer auto-create failed:", custErr.message);
                        } else if (newCust) {
                          customerId = newCust.id;
                        }
                      } catch (custErr) {
                        console.warn("Lesson customer auto-create exception:", custErr);
                      }
                    }
                    // Stash on submission so admin can see the linkage
                    if (customerId) newData.customer_id = customerId;

                    // Create the lesson — status='scheduled' since paid
                    const { data: lessonRow, error: lessonErr } = await sb.from("lessons").insert({
                      scheduled_at:  submissionData.scheduled_at,
                      duration_min:  submissionData.duration_min || 60,
                      type:          submissionData.lesson_type || 'private',
                      instructor:    submissionData.instructor || null,
                      customer_id:   customerId,
                      customer_name: skater.name || contact.name || null,
                      price:         submissionData.price || null,
                      status:        'scheduled',
                      notes:         (submissionData.notes ? submissionData.notes + '\n' : '')
                                   + '[Booked online · book.skateos.com · payment received via Helcim]'
                                   + (skater.age ? '\nSkater age: ' + skater.age : '')
                                   + (skater.skill_level ? '\nSkill: ' + skater.skill_level : '')
                    }).select("id").single();
                    if (lessonErr) {
                      console.warn("Lesson auto-create failed:", lessonErr.message);
                    } else if (lessonRow) {
                      newData.lesson_id = lessonRow.id;
                    }

                    // Fire customer confirmation email — best-effort, fully wrapped
                    // so any failure (Resend not wired, no email on file, etc) doesn't
                    // break the webhook flow. The lesson + payment are the system of
                    // record; email is the cherry on top.
                    // Idempotent: if confirmation_email_sent_at is already stamped on
                    // the submission, skip — Helcim webhook may retry on 5xx.
                    try {
                      const alreadySent = (sub.data || {}).confirmation_email_sent_at;
                      if (!alreadySent && contact.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) {
                        const sendUrl = Deno.env.get("SUPABASE_URL") + "/functions/v1/send-email";
                        const startIso = submissionData.scheduled_at as string;
                        const dur = submissionData.duration_min || 60;
                        const startMs = new Date(startIso).getTime();
                        const endMs = startMs + dur * 60000;
                        const fmtCalDateUtc = (ms: number) => {
                          const d = new Date(ms);
                          const z = (n: number) => String(n).padStart(2,'0');
                          return d.getUTCFullYear() + z(d.getUTCMonth()+1) + z(d.getUTCDate()) + 'T' + z(d.getUTCHours()) + z(d.getUTCMinutes()) + z(d.getUTCSeconds()) + 'Z';
                        };
                        const fmtHumanDate = (ms: number) => {
                          try {
                            return new Date(ms).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
                          } catch { return new Date(ms).toISOString().slice(0,10); }
                        };
                        const fmtHumanTime = (ms: number) => {
                          try {
                            return new Date(ms).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
                          } catch { return new Date(ms).toISOString().slice(11,16); }
                        };
                        const dateStr = fmtHumanDate(startMs);
                        const timeStr = fmtHumanTime(startMs) + ' – ' + fmtHumanTime(endMs);
                        const lessonType = (submissionData.lesson_type || 'private');
                        const lessonTypeTitle = lessonType.charAt(0).toUpperCase() + lessonType.slice(1) + ' lesson';
                        const instructor = submissionData.instructor || 'TBD';
                        const skaterName = (skater.name || contact.name || '').trim();
                        const firstName = (skaterName.split(/\s+/)[0]) || (contact.name||'there');
                        const price = submissionData.price || 0;
                        const bizName = '2nd Nature Park';
                        const bizAddr = '1 Highland Industrial Park, Peekskill NY 10566';
                        const bizPhone = '(914) 402-4624';
                        // Google Calendar deep-link
                        const gcalParams = new URLSearchParams({
                          action: 'TEMPLATE',
                          text: lessonTypeTitle + ' at ' + bizName + (instructor !== 'TBD' ? ' (with ' + instructor + ')' : ''),
                          dates: fmtCalDateUtc(startMs) + '/' + fmtCalDateUtc(endMs),
                          details: 'Skate lesson booked via book.skateos.com\\n\\nInstructor: ' + instructor + '\\nSkater: ' + skaterName + '\\n\\nQuestions? Call ' + bizPhone,
                          location: bizAddr
                        });
                        const gcalUrl = 'https://calendar.google.com/calendar/render?' + gcalParams.toString();
                        const subj = '✓ Lesson confirmed · ' + dateStr;
                        const html = '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#faf8f3;">'
                          + '<div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e0d5;">'
                          + '<div style="background:linear-gradient(135deg,#fb7185,#ec4899);color:#fff;padding:24px;border-radius:8px;text-align:center;margin:-12px -12px 24px;">'
                            + '<div style="font-size:24px;font-weight:700;margin-bottom:8px;">🎓 Your lesson is booked!</div>'
                            + '<div style="font-size:14px;opacity:0.9;">See you at the park</div>'
                          + '</div>'
                          + '<div style="font-size:16px;color:#111;margin-bottom:16px;">Hey ' + firstName.replace(/[<>]/g,'') + ',</div>'
                          + '<div style="font-size:14px;color:#444;line-height:1.6;margin-bottom:24px;">Your skate lesson is confirmed — payment received and your spot is locked in. Here are the details:</div>'
                          + '<div style="margin:24px 0;padding:18px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">'
                            + '<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;color:#991b1b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Lesson</div>'
                            + '<div style="font-size:18px;font-weight:700;color:#111;margin-bottom:4px;">' + lessonTypeTitle + '</div>'
                            + '<div style="font-size:15px;color:#444;">' + dateStr + '</div>'
                            + '<div style="font-size:15px;color:#444;">' + timeStr + ' (' + dur + ' min)</div>'
                            + '<div style="font-size:15px;color:#444;margin-top:8px;">Instructor: <strong>' + instructor.replace(/[<>]/g,'') + '</strong></div>'
                            + (skaterName ? '<div style="font-size:15px;color:#444;">Skater: <strong>' + skaterName.replace(/[<>]/g,'') + '</strong></div>' : '')
                            + (price > 0 ? '<div style="font-size:13px;color:#15803d;margin-top:8px;font-weight:700;">$' + Number(price).toFixed(2) + ' · paid</div>' : '')
                          + '</div>'
                          + '<div style="margin:24px 0;text-align:center;">'
                            + '<a href="' + gcalUrl + '" style="display:inline-block;padding:12px 24px;background:#fb7185;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">📅 Add to Google Calendar</a>'
                          + '</div>'
                          + '<div style="margin:24px 0;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:13px;color:#166534;">'
                            + '<strong>What to bring:</strong> Helmet (we have loaners if you don\\\'t have one), pads, water. We\\\'ll have the rest covered.'
                          + '</div>'
                          + '<div style="margin:16px 0;padding:14px;background:#f9fafb;border-radius:6px;font-size:13px;color:#666;">'
                            + 'You\\\'ll get a reminder email + text 24 hours before. Need to reschedule? Reply to this email or call ' + bizPhone + ' — please give us as much notice as possible.'
                          + '</div>'
                          + '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:13px;color:#666;text-align:center;">'
                            + bizName + ' · ' + bizAddr + ' · ' + bizPhone
                          + '</div>'
                          + '</div></body></html>';
                        const textFallback = 'Your lesson is booked!\n\n'
                          + lessonTypeTitle + '\n'
                          + dateStr + '\n'
                          + timeStr + ' (' + dur + ' min)\n'
                          + 'Instructor: ' + instructor + '\n'
                          + (skaterName ? 'Skater: ' + skaterName + '\n' : '')
                          + (price > 0 ? '\nPaid: $' + Number(price).toFixed(2) + '\n' : '')
                          + '\nAdd to Google Calendar: ' + gcalUrl
                          + '\n\nWhat to bring: helmet, pads, water (loaner helmets available).'
                          + '\n\nReminder fires 24h before. Need to reschedule? Reply or call ' + bizPhone + '.'
                          + '\n\n' + bizName + ' · ' + bizAddr;
                        const emailResp = await fetch(sendUrl, {
                          method: "POST",
                          headers: {
                            "Authorization": "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
                            "Content-Type":  "application/json",
                          },
                          body: JSON.stringify({
                            to: contact.email,
                            subject: subj,
                            html: html,
                            text: textFallback,
                            tags: [
                              { name: "type", value: "lesson_confirmed" },
                              { name: "submission_id", value: sub.id }
                            ]
                          })
                        }).catch((e) => { console.warn("Lesson confirmation email failed:", e); return null; });
                        if (emailResp && emailResp.ok) {
                          // Stamp idempotency marker so webhook retries don't double-send
                          newData.confirmation_email_sent_at = new Date().toISOString();
                        }
                      }
                    } catch (emailErr) {
                      console.warn("Lesson confirmation email exception:", emailErr);
                    }
                  } catch (e) {
                    console.warn("Lesson auto-create exception:", e);
                  }
                } else if (slug === "retail-order") {
                  newData = Object.assign({}, sub.data || {}, {
                    payment_status:  "paid",
                    payment_paid_at: new Date().toISOString(),
                    payment_paid_via: "helcim_webhook",
                  });
                  // Atomic inventory decrement (mig 054). Best-effort —
                  // failure here logs but doesn't break the payment flip.
                  // The RPC is idempotent so re-firing the webhook is safe.
                  try {
                    const { data: invResult, error: invError } = await sb.rpc("process_retail_order_payment", {
                      p_submission_id: sub.id,
                    });
                    if (invError) {
                      console.warn("Inventory decrement RPC error:", invError.message);
                    } else if (invResult?.oversold_count > 0) {
                      console.warn("Oversold detected on order " + sub.id + ":", invResult.oversold);
                    }
                  } catch (e) {
                    console.warn("Inventory decrement failed:", e);
                  }

                  // Auto-link / create customer record on first paid order so
                  // future fulfillment, marketing, loyalty, and customer-detail
                  // surfaces can all attach properly. Idempotent via
                  // customer_id stamp on submission. Best-effort.
                  try {
                    const submissionData = sub.data || {};
                    const contact = submissionData.contact || {};
                    const totals = submissionData.totals || {};
                    const alreadyLinked = submissionData.customer_id;
                    if (!alreadyLinked && contact.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) {
                      // Look up by email first
                      let customerId: string | null = null;
                      const { data: cust } = await sb.from("customers")
                        .select("id")
                        .eq("email", contact.email.toLowerCase())
                        .limit(1);
                      if (cust && cust.length > 0) {
                        customerId = cust[0].id;
                      } else if (contact.phone) {
                        // Fall back to phone match (digits-only)
                        const phoneDigits = String(contact.phone).replace(/\D/g, '');
                        if (phoneDigits.length >= 7) {
                          const { data: byPhone } = await sb.from("customers")
                            .select("id, phone")
                            .ilike("phone", "%" + phoneDigits.slice(-7) + "%")
                            .limit(5);
                          if (byPhone && byPhone.length > 0) {
                            // Confirm last-7 match (ilike could be loose)
                            const exact = byPhone.find((c: any) => String(c.phone||'').replace(/\D/g,'').slice(-7) === phoneDigits.slice(-7));
                            if (exact) customerId = exact.id;
                          }
                        }
                      }
                      if (!customerId) {
                        // No existing customer — create one. Stamp source
                        // for audit so the cashier can see how it landed.
                        const insertPayload: any = {
                          name: contact.name || 'Online customer',
                          email: contact.email.toLowerCase(),
                          phone: contact.phone || null,
                          notes: '[Auto-created ' + new Date().toISOString().slice(0,10) +
                                 ' via shop.skateos.com retail order ' + (sub.id||'').slice(0,8) + ']',
                        };
                        // If shipping address present, capture it
                        const shipAddr = submissionData.shipping_address;
                        if (shipAddr && typeof shipAddr === 'object') {
                          if (shipAddr.line1) insertPayload.address = shipAddr.line1 + (shipAddr.line2 ? ' ' + shipAddr.line2 : '');
                          if (shipAddr.city) insertPayload.city = shipAddr.city;
                          if (shipAddr.state) insertPayload.state = shipAddr.state;
                          if (shipAddr.zip) insertPayload.zip = shipAddr.zip;
                        }
                        const { data: newCust, error: custErr } = await sb.from("customers")
                          .insert(insertPayload)
                          .select("id")
                          .single();
                        if (custErr) {
                          console.warn("Customer auto-create failed:", custErr.message);
                        } else if (newCust) {
                          customerId = newCust.id;
                        }
                      }
                      if (customerId) {
                        newData.customer_id = customerId;
                        // Increment denormalized total_spent + total_orders
                        // counters since this is a real paid sale (best-effort,
                        // not blocking).
                        try {
                          const subAmt = Number(totals.subtotal || 0);
                          if (subAmt > 0) {
                            // Use raw SQL via rpc would be cleaner, but the
                            // simpler approach: read + write with a delta.
                            const { data: cur } = await sb.from("customers")
                              .select("total_spent, total_orders")
                              .eq("id", customerId)
                              .single();
                            if (cur) {
                              await sb.from("customers")
                                .update({
                                  total_spent: Number(cur.total_spent || 0) + subAmt,
                                  total_orders: Number(cur.total_orders || 0) + 1,
                                })
                                .eq("id", customerId);
                            }
                          }
                        } catch (statsErr) {
                          console.warn("Customer stats update failed:", statsErr);
                        }
                      }
                    }
                  } catch (custLinkErr) {
                    console.warn("Customer auto-link exception:", custLinkErr);
                  }

                  // Fire customer payment-confirmation email — same pattern as
                  // lesson-booking. Best-effort, idempotent via
                  // payment_email_sent_at stamp on the submission's data JSONB.
                  // Different from order-shipped/fulfillment email (which fires
                  // when the cashier marks fulfilled in admin) — this one fires
                  // the moment payment lands, so customer gets immediate
                  // reassurance + can return to track via shop/order.html.
                  try {
                    const submissionData = sub.data || {};
                    const contact = submissionData.contact || {};
                    const items = submissionData.items || [];
                    const totals = submissionData.totals || {};
                    const isShip = submissionData.fulfillment === 'ship';
                    const alreadySent = submissionData.payment_email_sent_at;
                    if (!alreadySent && contact.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) {
                      const sendUrl = Deno.env.get("SUPABASE_URL") + "/functions/v1/send-email";
                      const firstName = ((contact.name||'').trim().split(/\s+/)[0]) || 'there';
                      const orderId = (sub.id||'').slice(0,8);
                      const statusUrl = 'https://shop.skateos.com/order.html?id=' + sub.id;
                      const bizName = '2nd Nature Park';
                      const bizPhone = '(914) 402-4624';
                      const bizAddr = '1 Highland Industrial Park, Peekskill NY 10566';
                      const subj = bizName + ' · payment received · order ' + orderId;
                      const heroLine = '✓ Payment received';
                      const heroSub = isShip
                        ? "We're packing your order — you'll get tracking when it ships"
                        : "Your order is being prepared for pickup";
                      // Compact items list
                      const itemsHtml = items.length
                        ? '<table style="width:100%;border-collapse:collapse;margin:16px 0;">' +
                          items.map((it: any) => {
                            const name = (it.name||'').replace(/[<>]/g,'');
                            const brand = (it.brand||'').replace(/[<>]/g,'');
                            const qty = it.qty || 1;
                            const lineTotal = (it.line_total || (it.unit_price * qty) || 0);
                            return '<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#444;font-size:14px;">' +
                                   (qty>1 ? qty + '× ' : '') +
                                   (brand ? '<strong>'+brand+'</strong> ' : '') +
                                   name +
                                   '</td><td style="padding:8px 0;border-bottom:1px solid #eee;color:#111;font-size:14px;text-align:right;font-weight:600;">$' +
                                   Number(lineTotal).toFixed(2) + '</td></tr>';
                          }).join('') +
                          '</table>'
                        : '';
                      const fulfillmentBlock = isShip
                        ? '<div style="margin:24px 0;padding:18px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">' +
                          '<div style="color:#1e40af;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">📦 Shipping</div>' +
                          '<div style="font-size:14px;color:#444;line-height:1.5;">We\\\'re pulling your gear + packing it now. You\\\'ll get another email with tracking the moment it ships — usually 1-2 business days.</div>' +
                          '</div>'
                        : '<div style="margin:24px 0;padding:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">' +
                          '<div style="color:#a16207;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">🛹 Pickup at the shop</div>' +
                          '<div style="font-size:16px;font-weight:600;color:#111;">' + bizName + '</div>' +
                          '<div style="font-size:14px;color:#444;margin-top:4px;">' + bizAddr + '</div>' +
                          '<div style="font-size:13px;color:#666;margin-top:10px;">We\\\'ll email you the moment it\\\'s ready. Open during park hours — bring your order # or photo ID.</div>' +
                          '</div>';
                      const html = '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#faf8f3;">'
                        + '<div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e0d5;">'
                        + '<div style="background:linear-gradient(135deg,#15803d,#16a34a);color:#fff;padding:24px;border-radius:8px;text-align:center;margin:-12px -12px 24px;">'
                          + '<div style="font-size:24px;font-weight:700;margin-bottom:8px;">' + heroLine + '</div>'
                          + '<div style="font-size:14px;opacity:0.95;">' + heroSub + '</div>'
                        + '</div>'
                        + '<div style="font-size:16px;color:#111;margin-bottom:16px;">Hey ' + firstName.replace(/[<>]/g,'') + ',</div>'
                        + '<div style="font-size:14px;color:#444;line-height:1.6;margin-bottom:16px;">'
                          + 'Thanks for shopping with us — payment hit and your order is in motion. Receipt below.'
                        + '</div>'
                        + (items.length ? '<div style="font-size:13px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Order ' + orderId + '</div>' + itemsHtml : '')
                        + '<div style="margin:16px 0;padding:14px;background:#f9fafb;border-radius:6px;text-align:right;font-weight:700;font-size:16px;color:#111;">'
                          + 'Total paid · $' + Number(totals.subtotal||0).toFixed(2)
                        + '</div>'
                        + fulfillmentBlock
                        + '<div style="margin:24px 0;text-align:center;">'
                          + '<a href="' + statusUrl + '" style="display:inline-block;padding:12px 24px;background:#fb7185;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Track your order →</a>'
                        + '</div>'
                        + '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:13px;color:#666;text-align:center;">'
                          + 'Order #' + orderId + ' · Questions? Reply or call ' + bizPhone
                        + '</div>'
                        + '</div></body></html>';
                      const textFallback = heroLine + '\n' + heroSub + '\n\n'
                        + 'Hey ' + firstName + ',\n\nThanks for shopping with us — payment hit and your order is in motion.\n\n'
                        + 'Order #' + orderId + '\n'
                        + items.map((it: any) => {
                            return ((it.qty||1)>1 ? it.qty + '× ' : '') + (it.brand?(it.brand+' '):'') + (it.name||'');
                          }).join('\n')
                        + '\n\nTotal paid: $' + Number(totals.subtotal||0).toFixed(2)
                        + '\n\n' + (isShip
                          ? "We're packing your gear now. Tracking email coming when it ships (1-2 business days)."
                          : "Pickup at " + bizName + " · " + bizAddr + ". We'll email when it's ready.")
                        + '\n\nTrack: ' + statusUrl
                        + '\n\nOrder #' + orderId + ' · Questions? Reply or call ' + bizPhone;
                      const emailResp = await fetch(sendUrl, {
                        method: "POST",
                        headers: {
                          "Authorization": "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
                          "Content-Type":  "application/json",
                        },
                        body: JSON.stringify({
                          to: contact.email,
                          subject: subj,
                          html: html,
                          text: textFallback,
                          tags: [
                            { name: "type", value: "retail_order_paid" },
                            { name: "submission_id", value: sub.id }
                          ]
                        })
                      }).catch((e) => { console.warn("Retail payment email failed:", e); return null; });
                      if (emailResp && emailResp.ok) {
                        newData.payment_email_sent_at = new Date().toISOString();
                      }
                    }
                  } catch (emailErr) {
                    console.warn("Retail payment email exception:", emailErr);
                  }
                } else {
                  // Unknown form — generic stamp so it's still visible
                  newData = Object.assign({}, sub.data || {}, {
                    payment_status: "paid",
                    payment_paid_at: new Date().toISOString(),
                  });
                }
                await sb.from("form_submissions").update({
                  data: newData,
                  status: "reviewed",
                }).eq("id", sub.id);
                refTable = "form_submissions";
                refId    = sub.id;
              }
            } catch (e) {
              console.warn("Submission auto-flip failed:", e);
            }
          }
        } else {
          outcomeStatus = "ignored";
        }
      }
    } else {
      outcomeStatus = "ignored";
    }
  } catch (e) {
    outcomeStatus = "error";
    errorMessage  = (e as Error).message;
    console.error("Failed to apply Helcim webhook update:", e);
  }

  // Update the log row with the outcome
  if (logId) {
    try {
      await sb.from("webhook_log").update({
        status:        outcomeStatus,
        ref_table:     refTable,
        ref_id:        refId,
        error_message: errorMessage,
      }).eq("id", logId);
    } catch (e) {
      console.warn("Could not update webhook_log row:", e);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: eventType, id: eventId, outcome: outcomeStatus }),
    { headers: { "content-type": "application/json" } },
  );
});
