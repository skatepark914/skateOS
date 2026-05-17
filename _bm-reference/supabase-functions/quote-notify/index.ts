/**
 * Branch Manager — Quote Notification
 * Supabase Edge Function
 *
 * Called by approve.html when a customer approves a quote or requests changes.
 * Sends notification email to info@peekskilltree.com (Team)
 * and confirmation email to customer (if email provided).
 *
 * Deploy:
 *   supabase functions deploy quote-notify --no-verify-jwt
 *
 * Set secrets:
 *   supabase secrets set SENDGRID_API_KEY=SG...
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY') ?? '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const APP_URL = 'https://peekskilltree.com/branchmanager/';

async function sendEmail(to: string, toName: string, subject: string, text: string, html?: string) {
  if (!SENDGRID_API_KEY) return;
  const body: any = {
    personalizations: [{ to: [{ email: to, name: toName }] }],
    from: { email: 'info@peekskilltree.com', name: 'Second Nature Tree Service' },
    reply_to: { email: 'info@peekskilltree.com', name: 'Second Nature Tree Service' },
    subject,
    content: [{ type: 'text/plain', value: text }]
  };
  if (html) body.content.push({ type: 'text/html', value: html });

  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function htmlWrap(headerBg: string, headerContent: string, bodyContent: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;">
  <div style="background:${headerBg};padding:24px 28px;border-radius:10px 10px 0 0;">
    ${headerContent}
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #e8e8e8;border-radius:0 0 10px 10px;">
    ${bodyContent}
    <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">Second Nature Tree Service · 1 Highland Industrial Park, Peekskill, NY 10566 · Licensed &amp; Insured · WC-32079 / PC-50644</p>
  </div>
</div>`;
}

function money(n: number): string {
  return '$' + (+(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const data = await req.json();
    const { event, quoteId, quoteNumber, clientName, total, property, changeNotes, clientEmail } = data;

    const qNum = quoteNumber || quoteId || '—';
    const cName = clientName || 'Customer';
    const firstName = cName.split(' ')[0] || 'there';
    const totalFmt = money(total || 0);
    const propFmt = property || '—';

    if (event === 'approved') {
      // ── Team notification ──────────────────────────────────────────────
      const teamSubject = `✅ Quote #${qNum} approved — ${cName}`;
      const teamText = `Quote #${qNum} approved by ${cName}.

Property: ${propFmt}
Total:    ${totalFmt}

Customer approved via online portal. Create a job and schedule service.

View in Branch Manager:
${APP_URL}`;

      const teamHtml = htmlWrap(
        '#1a3c12',
        `<div style="color:#fff;font-size:22px;font-weight:800;">✅ Quote Approved</div>
    <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">Second Nature Tree Service</div>`,
        `<h2 style="color:#1a3c12;font-size:20px;margin:0 0 16px;">Quote #${qNum} — ${cName}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
      <tr><td style="color:#888;padding:5px 0;width:110px;">Property</td><td style="font-weight:600;">${propFmt}</td></tr>
      <tr><td style="color:#888;padding:5px 0;">Total</td><td style="font-weight:700;font-size:18px;color:#1a3c12;">${totalFmt}</td></tr>
    </table>
    <div style="background:#e8f5e9;border-left:3px solid #1a3c12;border-radius:0 8px 8px 0;padding:14px 16px;margin:16px 0;font-size:14px;color:#333;">
      Customer approved via online portal. <strong>Create a job and schedule service.</strong>
    </div>
    <a href="${APP_URL}" style="display:inline-block;background:#1a3c12;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Open Branch Manager</a>`
      );

      await sendEmail('info@peekskilltree.com', 'Team', teamSubject, teamText, teamHtml);

      // ── Customer confirmation ──────────────────────────────────────────
      if (clientEmail) {
        const custSubject = 'Your quote is confirmed — Second Nature Tree Service';
        const custText = `Hi ${firstName},

Thank you for approving Quote #${qNum}. We'll be in touch shortly to confirm your scheduling.

Questions? Call or text us at (914) 391-5233 or reply to this email.

— Doug & Catherine
Second Nature Tree Service
Peekskill, NY · Licensed & Insured · WC-32079 / PC-50644
peekskilltree.com`;

        const custHtml = htmlWrap(
          '#1a3c12',
          `<div style="color:#fff;font-size:22px;font-weight:800;">🌳 Second Nature Tree Service</div>
    <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">Peekskill, NY · (914) 391-5233</div>`,
          `<h2 style="color:#1a3c12;font-size:20px;margin:0 0 12px;">Quote Confirmed! ✅</h2>
    <p style="color:#444;font-size:15px;line-height:1.6;">Hi ${firstName},</p>
    <p style="color:#444;font-size:15px;line-height:1.6;">Thank you for approving <strong>Quote #${qNum}</strong>. We'll be in touch shortly to confirm your scheduling and any prep needed before we arrive.</p>
    <div style="background:#f0f7f0;border-left:3px solid #1a3c12;border-radius:0 8px 8px 0;padding:14px 16px;margin:16px 0;font-size:14px;color:#333;">
      Questions? Reply to this email or call/text us directly:
    </div>
    <a href="tel:9143915233" style="display:inline-block;background:#1a3c12;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-top:4px;">📞 (914) 391-5233</a>
    <p style="color:#444;font-size:14px;margin-top:20px;">You can also visit us at <a href="https://peekskilltree.com" style="color:#1a3c12;">peekskilltree.com</a></p>`
        );

        await sendEmail(clientEmail, firstName, custSubject, custText, custHtml);
      }

    } else if (event === 'changes_requested') {
      // ── Team notification ──────────────────────────────────────────────
      const teamSubject = `💬 Quote #${qNum} — changes requested — ${cName}`;
      const teamText = `Quote #${qNum} — changes requested by ${cName}.

Property: ${propFmt}
Total:    ${totalFmt}

Customer notes:
${changeNotes || '(no notes provided)'}

Review and send a revised quote:
${APP_URL}`;

      const teamHtml = htmlWrap(
        '#b45309',
        `<div style="color:#fff;font-size:22px;font-weight:800;">💬 Changes Requested</div>
    <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">Second Nature Tree Service</div>`,
        `<h2 style="color:#92400e;font-size:20px;margin:0 0 16px;">Quote #${qNum} — ${cName}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
      <tr><td style="color:#888;padding:5px 0;width:110px;">Property</td><td style="font-weight:600;">${propFmt}</td></tr>
      <tr><td style="color:#888;padding:5px 0;">Total</td><td style="font-weight:700;font-size:18px;color:#92400e;">${totalFmt}</td></tr>
    </table>
    <div style="font-size:12px;color:#999;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px;">Customer Notes</div>
    <div style="background:#fff7ed;border-left:3px solid #b45309;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:16px;font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap;">${changeNotes || '(no notes provided)'}</div>
    <div style="font-size:14px;color:#555;margin-bottom:16px;">Review and send a revised quote.</div>
    <a href="${APP_URL}" style="display:inline-block;background:#b45309;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Open Branch Manager</a>`
      );

      await sendEmail('info@peekskilltree.com', 'Team', teamSubject, teamText, teamHtml);

      // ── Customer confirmation ──────────────────────────────────────────
      if (clientEmail) {
        const custSubject = `We got your feedback — Second Nature Tree Service`;
        const custText = `Hi ${firstName},

Thanks for your feedback on Quote #${qNum}. We'll review your request and send a revised quote soon.

Questions? Call or text us at (914) 391-5233 or reply to this email.

— Doug & Catherine
Second Nature Tree Service
Peekskill, NY · Licensed & Insured · WC-32079 / PC-50644
peekskilltree.com`;

        const custHtml = htmlWrap(
          '#1a3c12',
          `<div style="color:#fff;font-size:22px;font-weight:800;">🌳 Second Nature Tree Service</div>
    <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">Peekskill, NY · (914) 391-5233</div>`,
          `<h2 style="color:#1a3c12;font-size:20px;margin:0 0 12px;">Feedback Received 💬</h2>
    <p style="color:#444;font-size:15px;line-height:1.6;">Hi ${firstName},</p>
    <p style="color:#444;font-size:15px;line-height:1.6;">Thanks for your feedback on <strong>Quote #${qNum}</strong>. We'll review your request and send a revised quote soon.</p>
    <div style="background:#f0f7f0;border-left:3px solid #1a3c12;border-radius:0 8px 8px 0;padding:14px 16px;margin:16px 0;font-size:14px;color:#333;">
      Questions or anything to add? Reply to this email or call/text us:
    </div>
    <a href="tel:9143915233" style="display:inline-block;background:#1a3c12;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-top:4px;">📞 (914) 391-5233</a>
    <p style="color:#444;font-size:14px;margin-top:20px;">You can also visit us at <a href="https://peekskilltree.com" style="color:#1a3c12;">peekskilltree.com</a></p>`
        );

        await sendEmail(clientEmail, firstName, custSubject, custText, custHtml);
      }

    } else {
      return new Response(JSON.stringify({ ok: false, error: 'Unknown event type' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('quote-notify error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
