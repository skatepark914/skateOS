// ============================================================
// Helcim mobile bridge — calls the same Edge Functions the web
// admin uses. Returns hostedPaymentUrl from helcim-invoice; the
// caller decides how to share (SMS / email / copy).
//
// Native HelcimPay.js iframe (true in-person card capture) ships
// in v1.5 — needs `react-native-webview` added to package.json
// + a modal screen that listens to postMessage events through
// `injectedJavaScript`. For v1, we use the hosted-invoice path
// and let the customer pay on their phone or via the cashier's
// browser.
// ============================================================
import { supabase } from './supabase';
import Constants from 'expo-constants';

const SUPABASE_URL = Constants.expoConfig?.extra?.supabaseUrl as string;
const SUPABASE_KEY = Constants.expoConfig?.extra?.supabaseKey as string;

export type HelcimLineItem = {
  sku?: string;
  description: string;
  quantity: number;
  price: number;
};

export type HelcimInvoiceArgs = {
  lineItems: HelcimLineItem[];
  currency?: string;
  customer?: { code?: string; email?: string; name?: string };
  notes?: string;
  dueDate?: string;
  skateosInvoiceId?: string;
};

export type HelcimInvoiceResult = {
  ok: boolean;
  hostedPaymentUrl?: string;
  helcimInvoiceNumber?: string | number;
  pdfUrl?: string;
  error?: string;
};

/** POSTs to the helcim-invoice Edge Function — returns the hosted-payment URL. */
export async function createHelcimInvoice(args: HelcimInvoiceArgs): Promise<HelcimInvoiceResult> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token ?? SUPABASE_KEY;

  const body: any = {
    currency: args.currency ?? 'USD',
    lineItems: args.lineItems,
  };
  if (args.customer)         body.customer = args.customer;
  if (args.notes)            body.notes = args.notes;
  if (args.dueDate)          body.dueDate = args.dueDate;
  if (args.skateosInvoiceId) body.skateos_invoice_id = args.skateosInvoiceId;

  let resp: Response;
  try {
    resp = await fetch(SUPABASE_URL + '/functions/v1/helcim-invoice', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    return { ok: false, error: 'Network error: ' + (e?.message ?? String(e)) };
  }

  const data = await resp.json().catch(() => ({} as any));
  if (!resp.ok || !data.ok) {
    let err = data?.error || ('HTTP ' + resp.status);
    if (resp.status === 401 || data?.helcimStatus === 401) {
      err = 'Helcim 401 — replace HELCIM_API_TOKEN placeholder with a real token.';
    }
    return { ok: false, error: typeof err === 'string' ? err : JSON.stringify(err) };
  }

  return {
    ok: true,
    hostedPaymentUrl: data.hostedPaymentUrl,
    helcimInvoiceNumber: data.helcimInvoiceNumber,
    pdfUrl: data.pdfUrl,
  };
}
