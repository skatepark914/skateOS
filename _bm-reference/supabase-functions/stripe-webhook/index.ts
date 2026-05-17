/**
 * Branch Manager — Stripe Webhook Handler
 * Supabase Edge Function
 *
 * Deploy:
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 *
 * Set secrets:
 *   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
 *   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
 *
 * Stripe webhook endpoint:
 *   https://ltpivkqahvplapyagljt.supabase.co/functions/v1/stripe-webhook
 *
 * Events to enable in Stripe:
 *   - payment_intent.succeeded
 *   - checkout.session.completed
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://ltpivkqahvplapyagljt.supabase.co';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const body = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';

  // Verify webhook signature
  let event: any;
  try {
    // Simple HMAC verification (Stripe uses SHA-256)
    const encoder = new TextEncoder();
    const parts = signature.split(',');
    const timestamp = parts.find((p: string) => p.startsWith('t='))?.split('=')[1] ?? '';
    const sigHex = parts.find((p: string) => p.startsWith('v1='))?.split('=')[1] ?? '';

    const signedPayload = `${timestamp}.${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(STRIPE_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const computedSig = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (computedSig !== sigHex) {
      console.error('Webhook signature mismatch');
      return new Response('Signature mismatch', { status: 401 });
    }

    event = JSON.parse(body);
  } catch (err) {
    console.error('Webhook parse error:', err);
    return new Response('Bad request', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Handle relevant events
  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const session = event.data.object;
    const amountPaid = session.amount_total ?? session.amount_received ?? 0; // cents
    const clientRef = session.client_reference_id ?? ''; // e.g. "INV-377"
    const paymentIntentId = session.payment_intent ?? session.id ?? '';
    const customerEmail = session.customer_details?.email ?? session.receipt_email ?? '';

    console.log(`Payment received: ${clientRef} — $${(amountPaid/100).toFixed(2)}`);

    if (clientRef && clientRef.startsWith('INV-')) {
      // Find invoice by invoice number
      const invoiceNumber = parseInt(clientRef.replace('INV-', ''));

      const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, balance, total, status, client_name')
        .eq('invoice_number', invoiceNumber)
        .limit(1);

      if (error) {
        console.error('Supabase query error:', error);
        return new Response('DB error', { status: 500 });
      }

      if (invoices && invoices.length > 0) {
        const inv = invoices[0];
        const amountDollars = amountPaid / 100;

        // Update invoice as paid
        const { error: updateErr } = await supabase
          .from('invoices')
          .update({
            status: 'paid',
            balance: 0,
            paid_date: new Date().toISOString(),
            amount_paid: amountDollars,
            payment_method: 'stripe',
            stripe_payment_id: paymentIntentId,
            updated_at: new Date().toISOString()
          })
          .eq('id', inv.id);

        if (updateErr) {
          console.error('Invoice update error:', updateErr);
          return new Response('Update error', { status: 500 });
        }

        console.log(`✅ Invoice #${invoiceNumber} for ${inv.client_name} marked PAID — $${amountDollars.toFixed(2)}`);

        // Send notification email to Doug via SendGrid
        const sendgridKey = Deno.env.get('SENDGRID_API_KEY') ?? '';
        if (sendgridKey) {
          await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${sendgridKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: 'info@peekskilltree.com', name: 'Team' }] }],
              from: { email: 'info@peekskilltree.com', name: 'Second Nature Tree Service' },
              subject: `💳 Payment received — Invoice #${invoiceNumber} — $${amountDollars.toFixed(2)}`,
              content: [{
                type: 'text/plain',
                value: `Invoice #${invoiceNumber} for ${inv.client_name} was just paid online.\n\nAmount: $${amountDollars.toFixed(2)}\nMethod: Stripe / Credit Card\nEmail: ${customerEmail}\n\nThe invoice has been automatically marked as paid in Branch Manager.\n\nhttps://peekskilltree.com/branchmanager/`
              }]
            })
          });
        }
      } else {
        console.warn(`Invoice not found for ref: ${clientRef}`);
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
