// ============================================================
// Receipts — routes mobile sale-complete receipts through the
// existing `send-email` (Resend) and `send-sms` (Twilio) Edge
// Functions. Mirrors what admin/index.html does so a receipt
// emailed from the iPad lands in the same Resend dashboard with
// the same biz-from address.
//
// Falls back to device handlers (`mailto:` / `sms:`) when the
// Edge Function isn't reachable so cashiers can still get a
// receipt out even if Resend/Twilio is down.
// ============================================================
import { Linking } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

const extra = Constants.expoConfig?.extra ?? {};
const SUPABASE_URL = (extra.supabaseUrl as string) || '';

export type ReceiptPayload = {
  saleId:        string;
  receiptNumber?: string | null;
  total:         number;
  subtotal?:     number;
  tax?:          number;
  discount?:     number;
  tip?:          number;
  cart?:         Array<{ name: string; qty: number; price: number }>;
  customerName?: string | null;
  bizName:       string;
  bizPhone?:     string;
  bizAddr?:      string;
};

function money(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Helper: pull the access token so the Edge Function trusts us ───
async function edgeAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token ?? ''}`,
  };
}

// ─── Build HTML body for the email receipt ───
function buildEmailHtml(ctx: ReceiptPayload): string {
  const lines = (ctx.cart ?? [])
    .map(l =>
      `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(l.name)}</td>` +
      `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${l.qty}</td>` +
      `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${money(l.price * l.qty)}</td></tr>`
    )
    .join('');

  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:24px;background:#fafafa;color:#0a0a0a;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
    <div style="background:#e11d48;color:#fff;padding:20px 24px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:2px;opacity:.85;">RECEIPT</div>
      <div style="font-size:22px;font-weight:900;margin-top:4px;">${escapeHtml(ctx.bizName)}</div>
      ${ctx.receiptNumber ? `<div style="font-size:13px;opacity:.85;margin-top:2px;">#${escapeHtml(String(ctx.receiptNumber))}</div>` : ''}
    </div>
    <div style="padding:20px 24px;">
      <div style="color:#6b7280;font-size:13px;margin-bottom:14px;">${new Date().toLocaleString()}</div>
      ${ctx.customerName ? `<div style="font-size:14px;margin-bottom:14px;"><strong>${escapeHtml(ctx.customerName)}</strong></div>` : ''}
      ${lines ? `<table style="width:100%;border-collapse:collapse;font-size:14px;"><tbody>${lines}</tbody></table>` : ''}
      <div style="margin-top:16px;border-top:2px solid #0a0a0a;padding-top:12px;">
        ${ctx.subtotal != null ? row('Subtotal', money(ctx.subtotal)) : ''}
        ${ctx.discount && ctx.discount > 0 ? row('Discount', '-' + money(ctx.discount)) : ''}
        ${ctx.tax != null ? row('Tax', money(ctx.tax)) : ''}
        ${ctx.tip && ctx.tip > 0 ? row('Tip', money(ctx.tip)) : ''}
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-top:1px solid #e5e5e5;margin-top:6px;">
          <div style="font-weight:800;font-size:16px;">TOTAL</div>
          <div style="font-weight:900;font-size:22px;color:#e11d48;">${money(ctx.total)}</div>
        </div>
      </div>
      <div style="margin-top:18px;color:#6b7280;font-size:12px;line-height:1.5;">
        ${ctx.bizPhone ? escapeHtml(ctx.bizPhone) + ' · ' : ''}${ctx.bizAddr ? escapeHtml(ctx.bizAddr) : ''}
      </div>
      <div style="margin-top:14px;color:#9ca3af;font-size:11px;">Thanks for stopping by — see you next session.</div>
    </div>
  </div>
</body></html>`;
}

function row(label: string, val: string) {
  return `<div style="display:flex;justify-content:space-between;padding:3px 0;color:#404040;font-size:14px;"><span>${label}</span><span>${val}</span></div>`;
}

function escapeHtml(s: string | number) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as any)[c] ?? c);
}

// ─── EMAIL receipt — Resend via `send-email` Edge Function ───
// Returns { ok, fallback } — when ok=false and fallback=true the
// caller should open the device's mail composer as a backup.
export async function emailReceipt(toEmail: string, ctx: ReceiptPayload): Promise<{ ok: boolean; fallback: boolean; error?: string }> {
  const subject = `Your receipt — ${ctx.bizName}${ctx.receiptNumber ? ` · #${ctx.receiptNumber}` : ''}`;
  const html = buildEmailHtml(ctx);
  const text = buildSmsBody(ctx); // short fallback for non-HTML mail clients

  if (!SUPABASE_URL) {
    return await fallbackMailto(toEmail, subject, text);
  }

  try {
    const headers = await edgeAuthHeaders();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: toEmail,
        subject,
        html,
        text,
        tags: [{ name: 'type', value: 'receipt' }, { name: 'source', value: 'mobile' }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return await fallbackMailto(toEmail, subject, text, `Edge Function ${res.status}: ${body.slice(0, 200)}`);
    }
    return { ok: true, fallback: false };
  } catch (e: any) {
    return await fallbackMailto(toEmail, subject, text, e?.message ?? String(e));
  }
}

async function fallbackMailto(to: string, subject: string, body: string, why?: string): Promise<{ ok: boolean; fallback: boolean; error?: string }> {
  try {
    const url = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    await Linking.openURL(url);
    return { ok: true, fallback: true, error: why };
  } catch (e: any) {
    return { ok: false, fallback: true, error: e?.message ?? String(e) };
  }
}

// ─── SMS receipt — Twilio via `send-sms` Edge Function ───
function buildSmsBody(ctx: ReceiptPayload): string {
  const lines: string[] = [];
  lines.push(`${ctx.bizName}${ctx.receiptNumber ? ` #${ctx.receiptNumber}` : ''}`);
  lines.push(`Total: ${money(ctx.total)}`);
  if (ctx.customerName) lines.push(ctx.customerName);
  lines.push('Thanks for stopping by!');
  return lines.join(' · ');
}

export async function smsReceipt(toPhone: string, ctx: ReceiptPayload): Promise<{ ok: boolean; fallback: boolean; error?: string }> {
  const body = buildSmsBody(ctx);
  // E.164-normalize (US default — strips non-digits, adds +1 if missing)
  const digits = toPhone.replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+') ? digits : (digits.length === 10 ? `+1${digits}` : `+${digits}`);

  if (!SUPABASE_URL) return await fallbackSms(toPhone, body);

  try {
    const headers = await edgeAuthHeaders();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: e164, body }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return await fallbackSms(toPhone, body, `Edge Function ${res.status}: ${txt.slice(0, 200)}`);
    }
    return { ok: true, fallback: false };
  } catch (e: any) {
    return await fallbackSms(toPhone, body, e?.message ?? String(e));
  }
}

async function fallbackSms(to: string, body: string, why?: string): Promise<{ ok: boolean; fallback: boolean; error?: string }> {
  try {
    const url = `sms:${to}&body=${encodeURIComponent(body)}`;
    await Linking.openURL(url);
    return { ok: true, fallback: true, error: why };
  } catch (e: any) {
    return { ok: false, fallback: true, error: e?.message ?? String(e) };
  }
}
