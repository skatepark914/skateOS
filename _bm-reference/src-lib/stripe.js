/**
 * Branch Manager — Stripe Integration
 * Payment links, checkout, invoice payment tracking
 *
 * HOW IT WORKS (no backend needed):
 * 1. Create ONE "Base Payment Link" in Stripe Dashboard:
 *    - Product: "Tree Service" — Price: $0.01 per unit
 *    - Enable: "Let customers adjust quantity"
 *    - Copy the link URL (e.g. https://buy.stripe.com/abc123)
 * 2. Paste it in Settings → Stripe → Base Payment Link
 * 3. Every invoice/pay.html auto-appends ?prefilled_quantity=<cents>
 *    so Stripe pre-fills the exact amount. Client just clicks Pay.
 * 4. Tip: customer can increase quantity by the tip amount in cents.
 */
var Stripe = {
  publishableKey: null,
  DEFAULT_PK: 'pk_live_51TDawDBGJHz1j102gKSfimIBsbD7OtFgtKtEG7wRjSEIRM0IEsyV3gBSXs5ESx8eRIK9EXfGYJk3lgKKyB5fFeJP00Zwn4B4ED',

  init: function() {
    Stripe.publishableKey = localStorage.getItem('bm-stripe-pk') || Stripe.DEFAULT_PK;
    if (Stripe.publishableKey && !localStorage.getItem('bm-stripe-pk')) {
      localStorage.setItem('bm-stripe-pk', Stripe.publishableKey);
    }
  },

  isConnected: function() {
    return !!Stripe.publishableKey;
  },

  // Get the base payment link (stored in settings)
  getBaseLink: function() {
    return localStorage.getItem('bm-stripe-base-link') || '';
  },

  // Build a payment URL for a specific dollar amount
  // Uses prefilled_quantity trick: base link product = $0.01/unit, qty = cents
  buildPayUrl: function(amountDollars, invoiceNum) {
    var base = Stripe.getBaseLink();
    if (!base) return '';
    // Convert dollars to cents for quantity pre-fill
    var qty = Math.round(parseFloat(amountDollars) * 100);
    if (qty < 1) qty = 1;
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    var url = base + sep + 'prefilled_quantity=' + qty;
    if (invoiceNum) url += '&client_reference_id=INV-' + invoiceNum;
    return url;
  },

  // Get effective payment link for invoice:
  // 1. If invoice has a specific Stripe URL stored → use it
  // 2. If base link configured → auto-build with prefilled amount
  // 3. Otherwise → null
  getPaymentLink: function(invoiceId) {
    var inv = DB.invoices.getById(invoiceId);
    if (!inv) return null;
    if (inv.stripePaymentUrl) return inv.stripePaymentUrl;
    var base = Stripe.getBaseLink();
    if (base) return Stripe.buildPayUrl(inv.balance || inv.total, inv.invoiceNumber);
    return null;
  },

  // Render payment button for invoice detail
  paymentButton: function(invoiceId) {
    var inv = DB.invoices.getById(invoiceId);
    if (!inv || inv.status === 'paid') return '';

    var link = Stripe.getPaymentLink(invoiceId);

    if (!link && !Stripe.isConnected()) {
      return '<div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text-light);">'
        + '💳 Set up Stripe in Settings to accept online payments'
        + '</div>';
    }

    if (link) {
      return '<div style="margin-top:12px;">'
        + '<a href="' + link + '" target="_blank" class="btn" style="background:#635bff;color:#fff;width:100%;padding:12px;font-size:15px;display:block;text-align:center;text-decoration:none;">'
        + '💳 Open Stripe — ' + UI.money(inv.balance || inv.total)
        + '</a>'
        + '<button class="btn btn-outline" style="width:100%;margin-top:6px;font-size:12px;" onclick="Stripe.sendPaymentLink(\'' + invoiceId + '\')">'
        + '📧 Email Pay Link to Client</button>'
        + '<div style="font-size:11px;color:var(--text-light);text-align:center;margin-top:4px;">Clients can also add a tip on the payment page</div>'
        + '</div>';
    }

    return '<div style="margin-top:12px;">'
      + '<button class="btn" style="background:#635bff;color:#fff;width:100%;padding:12px;font-size:15px;" onclick="Stripe.sendPaymentLink(\'' + invoiceId + '\')">'
      + '💳 Send Payment Link — ' + UI.money(inv.balance || inv.total)
      + '</button>'
      + '</div>';
  },

  // Send payment link email to client
  sendPaymentLink: function(invoiceId) {
    var inv = DB.invoices.getById(invoiceId);
    if (!inv) return;
    var client = inv.clientId ? DB.clients.getById(inv.clientId) : null;
    var email = inv.clientEmail || (client && client.email) || '';
    if (!email) { UI.toast('No email on file for this client', 'error'); return; }

    // Use InvoicesPage send flow which builds full HTML email
    if (typeof InvoicesPage !== 'undefined' && InvoicesPage._sendInvoiceEmail) {
      InvoicesPage._sendInvoiceEmail(invoiceId);
    } else {
      UI.toast('Invoice email sent to ' + email);
      DB.invoices.update(invoiceId, { paymentLinkSent: new Date().toISOString(), paymentLinkEmail: email });
    }
  },

  // Render Stripe settings section
  renderSettings: function() {
    var connected = Stripe.isConnected();
    var pk = localStorage.getItem('bm-stripe-pk') || '';
    var baseLink = Stripe.getBaseLink();

    return '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'
      + '<div style="width:40px;height:40px;background:#635bff;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px;">S</div>'
      + '<div><h3 style="margin:0;">Stripe Payments</h3>'
      + '<div style="font-size:12px;color:' + (connected ? 'var(--green-dark)' : 'var(--text-light)') + ';">' + (connected ? '✅ Connected' : '⚪ Not connected') + '</div>'
      + '</div></div>'
      + '<p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">Clients pay invoices online with a card. Funds deposit to your bank in 2 business days. Optional tip selection built in.</p>'
      // Fee table
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;font-size:12px;text-align:center;">'
      + '<div style="padding:10px;background:var(--bg);border-radius:8px;"><strong style="font-size:16px;">2.9%</strong><br><span style="color:var(--text-light);">+ $0.30 card</span></div>'
      + '<div style="padding:10px;background:var(--bg);border-radius:8px;"><strong style="font-size:16px;">0.8%</strong><br><span style="color:var(--text-light);">ACH transfer</span></div>'
      + '<div style="padding:10px;background:var(--bg);border-radius:8px;"><strong style="font-size:16px;">2 days</strong><br><span style="color:var(--text-light);">to your bank</span></div>'
      + '</div>'
      // Publishable key
      + UI.formField('Stripe Publishable Key', 'text', 'stripe-pk', pk, { placeholder: 'pk_live_...' })
      // Base payment link — THE KEY FEATURE
      + '<div style="background:#f3f0ff;border:1px solid #d6cbff;border-radius:8px;padding:12px 14px;margin-bottom:12px;">'
      + '<div style="font-size:13px;font-weight:700;color:#4c1d95;margin-bottom:6px;">⚡ Base Payment Link (one-time setup)</div>'
      + '<div style="font-size:12px;color:#6d28d9;margin-bottom:10px;">Create ONE Stripe Payment Link → Product: any service, Price: <strong>$0.01/unit</strong>, enable <strong>"Let customers adjust quantity"</strong>. Paste it below and every invoice auto-generates the correct amount.</div>'
      + UI.formField('Base Payment Link URL', 'text', 'stripe-base-link', baseLink, { placeholder: 'https://buy.stripe.com/...' })
      + (baseLink ? '<div style="font-size:11px;color:#059669;margin-top:-8px;">✅ Configured — all invoices will use this link with pre-filled amounts</div>' : '')
      + '</div>'
      // Webhook auto-mark-paid section
      + '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;margin-bottom:12px;">'
      + '<div style="font-size:13px;font-weight:700;color:#14532d;margin-bottom:6px;">🔔 Auto-Mark Paid (Webhook)</div>'
      + '<div style="font-size:12px;color:#166534;margin-bottom:8px;">When a client pays, the invoice automatically flips to <strong>Paid</strong> and you get an email — no manual work.</div>'
      + '<div style="background:#fff;border-radius:6px;padding:8px 10px;font-size:11px;color:#374151;margin-bottom:8px;font-family:monospace;word-break:break-all;">'
      + '📡 Webhook URL:<br>'
      + '<strong>https://ltpivkqahvplapyagljt.supabase.co/functions/v1/stripe-webhook</strong>'
      + '</div>'
      + '<div style="font-size:11px;color:#166534;margin-bottom:6px;"><strong>One-time setup steps:</strong></div>'
      + '<ol style="font-size:11px;color:#166534;margin:0 0 8px 16px;line-height:1.7;">'
      + '<li><a href="https://dashboard.stripe.com/webhooks/create" target="_blank" style="color:#059669;">Stripe → Developers → Webhooks → Add endpoint</a></li>'
      + '<li>Paste the URL above → Events: <code>checkout.session.completed</code></li>'
      + '<li>Copy the "Signing secret" (whsec_...) — paste in terminal:<br>'
      + '<code style="background:#dcfce7;padding:2px 4px;border-radius:3px;">supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...</code></li>'
      + '<li>Set Payment Link success URL → <code>https://peekskilltree.com/branchmanager/paid.html</code></li>'
      + '</ol>'
      + '<div style="font-size:11px;color:#6b7280;">Also deploy the Edge Function: <code>supabase functions deploy stripe-webhook --no-verify-jwt</code></div>'
      + '</div>'
      // Action buttons
      + '<div style="display:flex;gap:8px;">'
      + '<button class="btn btn-primary" onclick="Stripe.saveSettings()">Save Settings</button>'
      + '<a href="https://dashboard.stripe.com/payment-links/create" target="_blank" class="btn btn-outline">Create Payment Link →</a>'
      + (connected ? '<button class="btn btn-outline" onclick="Stripe.disconnect()">Disconnect</button>' : '')
      + '</div>'
      + '<p style="font-size:11px;color:var(--text-light);margin-top:8px;">Publishable key from <a href="https://dashboard.stripe.com/apikeys" target="_blank" style="color:var(--green-dark);">dashboard.stripe.com/apikeys</a></p>'
      + '</div>';
  },

  saveSettings: function() {
    var pk = document.getElementById('stripe-pk') ? document.getElementById('stripe-pk').value.trim() : '';
    var baseLink = document.getElementById('stripe-base-link') ? document.getElementById('stripe-base-link').value.trim() : '';

    if (pk && !pk.startsWith('pk_')) { UI.toast('Key should start with pk_live_ or pk_test_', 'error'); return; }
    if (baseLink && !baseLink.startsWith('https://')) { UI.toast('Payment link must start with https://', 'error'); return; }

    if (pk) { localStorage.setItem('bm-stripe-pk', pk); Stripe.publishableKey = pk; }
    if (baseLink !== undefined) {
      if (baseLink) localStorage.setItem('bm-stripe-base-link', baseLink);
      else localStorage.removeItem('bm-stripe-base-link');
    }

    UI.toast('Stripe settings saved ✓');
    loadPage('settings');
  },

  saveKey: function() { Stripe.saveSettings(); },

  disconnect: function() {
    localStorage.removeItem('bm-stripe-pk');
    localStorage.removeItem('bm-stripe-base-link');
    Stripe.publishableKey = null;
    UI.toast('Stripe disconnected');
    loadPage('settings');
  },

  calcFees: function(amount) {
    var cardFee = Math.round((amount * 0.029 + 0.30) * 100) / 100;
    var achFee = Math.round((Math.min(amount * 0.008, 5)) * 100) / 100;
    return { card: cardFee, ach: achFee, cardNet: amount - cardFee, achNet: amount - achFee };
  }
};

Stripe.init();
