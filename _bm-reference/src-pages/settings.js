/**
 * Branch Manager — Settings Page
 * Company info, Supabase config, previous system CSV import, data management
 */
var SettingsPage = {
  render: function() {
    var stats = DB.dashboard.getStats();

    var html = '<div style="max-width:700px;">';

    // === ONE-TIME SETUP CHECKLIST ===
    var sgOk2 = (localStorage.getItem('bm-sendgrid-key') || '').length > 10;
    var stripeOk = !!(localStorage.getItem('bm-stripe-base-link'));
    var supabaseOk = (typeof SupabaseDB !== 'undefined' && SupabaseDB.ready) || stats.totalClients > 100;
    var allDone = sgOk2 && stripeOk && supabaseOk;
    if (!allDone) {
      html += '<div style="background:linear-gradient(135deg,#1a3c12 0%,#00836c 100%);border-radius:12px;padding:20px;margin-bottom:16px;color:#fff;">'
        + '<div style="font-size:16px;font-weight:800;margin-bottom:12px;">🚀 Quick Setup</div>'
        + '<div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">'
        + '<div style="display:flex;align-items:center;gap:10px;"><span style="font-size:16px;">' + (supabaseOk ? '✅' : '⬜') + '</span><span' + (supabaseOk ? ' style="text-decoration:line-through;opacity:.7;"' : '') + '>Supabase connected — your data is live</span></div>'
        + '<div style="display:flex;align-items:center;gap:10px;"><span style="font-size:16px;">' + (sgOk2 ? '✅' : '⬜') + '</span><span' + (sgOk2 ? ' style="text-decoration:line-through;opacity:.7;"' : '') + '>SendGrid key — enables automated emails</span></div>'
        + '<div style="display:flex;align-items:center;gap:10px;"><span style="font-size:16px;">' + (stripeOk ? '✅' : '⬜') + '</span><span' + (stripeOk ? ' style="text-decoration:line-through;opacity:.7;"' : '') + '>Stripe payment link — accept online payments</span></div>'
        + '<div style="display:flex;align-items:center;gap:10px;"><span style="font-size:16px;">⬜</span><span>Deploy Edge Functions (one-time terminal commands):</span></div>'
        + '<div style="background:rgba(0,0,0,.3);border-radius:8px;padding:10px 12px;font-family:monospace;font-size:11px;line-height:1.8;margin-left:26px;">'
        + 'supabase functions deploy stripe-webhook --no-verify-jwt<br>'
        + 'supabase functions deploy request-notify --no-verify-jwt<br>'
        + 'supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...<br>'
        + 'supabase secrets set SENDGRID_API_KEY=SG...<br>'
        + 'supabase secrets set SUPABASE_SERVICE_ROLE_KEY=ey...'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:10px;"><span style="font-size:16px;">⬜</span><span><a href="https://dashboard.stripe.com/webhooks/create" target="_blank" style="color:#a5f3e8;">Stripe → Webhooks → Add endpoint</a> → <code style="background:rgba(0,0,0,.3);padding:1px 6px;border-radius:4px;">https://ltpivkqahvplapyagljt.supabase.co/functions/v1/stripe-webhook</code></span></div>'
        + '<div style="display:flex;align-items:center;gap:10px;"><span style="font-size:16px;">⬜</span><span>Stripe → Payment Link → After payment → Redirect to <code style="background:rgba(0,0,0,.3);padding:1px 6px;border-radius:4px;">https://peekskilltree.com/branchmanager/paid.html</code></span></div>'
        + '</div>'
        + '</div>';
    }

    // Company Info — editable, saved to localStorage
    var co = {
      name: localStorage.getItem('bm-co-name') || BM_CONFIG.companyName,
      phone: localStorage.getItem('bm-co-phone') || BM_CONFIG.phone,
      email: localStorage.getItem('bm-co-email') || BM_CONFIG.email,
      address: localStorage.getItem('bm-co-address') || (typeof BM_CONFIG !== 'undefined' ? BM_CONFIG.address : ''),
      licenses: localStorage.getItem('bm-co-licenses') || 'WC-32079, PC-50644',
      website: localStorage.getItem('bm-co-website') || BM_CONFIG.website,
      taxRate: localStorage.getItem('bm-tax-rate') || '8.375'
    };
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<h3 style="margin:0;">Company Info</h3>'
      + '<button onclick="SettingsPage.saveCompany()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 18px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">Save</button>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Company Name</label><input id="co-name" value="' + UI.esc(co.name) + '" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Phone</label><input id="co-phone" value="' + UI.esc(co.phone) + '" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Email</label><input id="co-email" type="email" value="' + UI.esc(co.email) + '" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Website</label><input id="co-website" value="' + UI.esc(co.website) + '" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div style="grid-column:1/-1;"><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Address</label><input id="co-address" value="' + UI.esc(co.address) + '" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Licenses</label><input id="co-licenses" value="' + UI.esc(co.licenses) + '" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Default Tax Rate (%)</label>'
      + '<input id="co-tax-rate" type="number" value="' + co.taxRate + '" step="0.001" min="0" max="100" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;box-sizing:border-box;">'
      + '<div style="font-size:11px;color:var(--text-light);margin-top:3px;">Applied to new quotes & invoices (e.g. 8.375 for NYS)</div>'
      + '</div>'
      + '</div></div>';

    // ── Work Settings ──
    var ws = {
      defaultStart: localStorage.getItem('bm-work-start') || '07:00',
      defaultEnd: localStorage.getItem('bm-work-end') || '15:30',
      overtimeThreshold: localStorage.getItem('bm-ot-threshold') || '40',
      payPeriod: localStorage.getItem('bm-pay-period') || 'biweekly',
      arrivalWindows: localStorage.getItem('bm-arrival-windows') || 'morning,afternoon,all-day',
      minJobDuration: localStorage.getItem('bm-min-job-hrs') || '2',
      crewSeeClientInfo: localStorage.getItem('bm-crew-see-client') !== 'false'
    };
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<h3 style="margin:0;">Work Settings</h3>'
      + '<button onclick="SettingsPage._saveWorkSettings()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 18px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">Save</button>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Default Start Time</label>'
      + '<input type="time" id="ws-start" value="' + ws.defaultStart + '" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Default End Time</label>'
      + '<input type="time" id="ws-end" value="' + ws.defaultEnd + '" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Overtime After (hrs/week)</label>'
      + '<input type="number" id="ws-ot" value="' + ws.overtimeThreshold + '" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Pay Period</label>'
      + '<select id="ws-pay" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;">'
      + '<option value="weekly"' + (ws.payPeriod === 'weekly' ? ' selected' : '') + '>Weekly</option>'
      + '<option value="biweekly"' + (ws.payPeriod === 'biweekly' ? ' selected' : '') + '>Bi-weekly</option>'
      + '<option value="semimonthly"' + (ws.payPeriod === 'semimonthly' ? ' selected' : '') + '>Semi-monthly</option>'
      + '<option value="monthly"' + (ws.payPeriod === 'monthly' ? ' selected' : '') + '>Monthly</option>'
      + '</select></div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Min Job Duration (hrs)</label>'
      + '<input type="number" id="ws-min-job" value="' + ws.minJobDuration + '" step="0.5" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '<div style="display:flex;align-items:center;gap:8px;padding-top:20px;">'
      + '<input type="checkbox" id="ws-crew-client" style="width:18px;height:18px;"' + (ws.crewSeeClientInfo ? ' checked' : '') + '>'
      + '<label style="font-size:13px;">Crew can see client phone/email</label>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<div style="margin-top:12px;"><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:8px;">Business Hours</label>';
    var bhDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var bhDefaults = {Sunday:'9:00 AM – 1:00 PM',Monday:'8:00 AM – 6:00 PM',Tuesday:'8:00 AM – 6:00 PM',Wednesday:'8:00 AM – 6:00 PM',Thursday:'8:00 AM – 6:00 PM',Friday:'8:00 AM – 6:00 PM',Saturday:'9:00 AM – 3:00 PM'};
    bhDays.forEach(function(day) {
      var stored = localStorage.getItem('bm-bh-' + day.toLowerCase()) || bhDefaults[day];
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f5f5f5;">'
        + '<span style="font-size:13px;font-weight:600;width:90px;">' + day + '</span>'
        + '<input type="text" id="bh-' + day.toLowerCase() + '" value="' + UI.esc(stored) + '" style="flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px;text-align:center;" placeholder="Closed">'
        + '</div>';
    });
    html += '<div style="font-size:11px;color:var(--text-light);margin-top:6px;">Displayed on booking form and client communications. Type "Closed" for days off.</div>'
      + '</div>'
      + '</div>';

    // ── Location Services ──
    var locTrack = localStorage.getItem('bm-gps-tracking') !== 'false';
    var locWorkOnly = localStorage.getItem('bm-gps-work-only') !== 'false';
    var locGeofence = localStorage.getItem('bm-geofence') === 'true';
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<h3 style="margin:0;">Location Services</h3>'
      + '<button onclick="SettingsPage._saveLocationSettings()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 18px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">Save</button>'
      + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:12px;">'
      + '<label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;">'
      + '<input type="checkbox" id="loc-tracking" style="width:18px;height:18px;"' + (locTrack ? ' checked' : '') + '>'
      + '<div><strong>GPS Tracking</strong><div style="font-size:12px;color:var(--text-light);">Track crew locations on the dispatch map</div></div></label>'
      + '<label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;">'
      + '<input type="checkbox" id="loc-work-only" style="width:18px;height:18px;"' + (locWorkOnly ? ' checked' : '') + '>'
      + '<div><strong>Work Hours Only</strong><div style="font-size:12px;color:var(--text-light);">Only track during scheduled work hours (privacy)</div></div></label>'
      + '<label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;">'
      + '<input type="checkbox" id="loc-geofence" style="width:18px;height:18px;"' + (locGeofence ? ' checked' : '') + '>'
      + '<div><strong>Geofence Auto Clock-In</strong><div style="font-size:12px;color:var(--text-light);">Automatically clock crew in when they arrive at a job site</div></div></label>'
      + '</div>'
      + '</div>';

    // ── Notification Preferences ──
    var notif = {
      quoteApproved: localStorage.getItem('bm-notif-quote-approved') !== 'false',
      paymentReceived: localStorage.getItem('bm-notif-payment') !== 'false',
      newRequest: localStorage.getItem('bm-notif-new-request') !== 'false',
      overdueInvoice: localStorage.getItem('bm-notif-overdue') !== 'false',
      dailySummary: localStorage.getItem('bm-notif-daily-summary') === 'true',
      jobCompleted: localStorage.getItem('bm-notif-job-completed') !== 'false'
    };
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<h3 style="margin:0;">Notifications</h3>'
      + '<button onclick="SettingsPage._saveNotifSettings()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 18px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">Save</button>'
      + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:10px;">';
    [
      ['notif-quote-approved', notif.quoteApproved, 'Quote Approved', 'Email when a client approves a quote'],
      ['notif-payment', notif.paymentReceived, 'Payment Received', 'Email when a client pays an invoice'],
      ['notif-new-request', notif.newRequest, 'New Request', 'Email when a new booking request comes in'],
      ['notif-overdue', notif.overdueInvoice, 'Overdue Invoice', 'Email when an invoice becomes overdue'],
      ['notif-job-completed', notif.jobCompleted, 'Job Completed', 'Email when crew marks a job complete'],
      ['notif-daily-summary', notif.dailySummary, 'Daily Summary', 'Morning email with today\'s schedule + action items']
    ].forEach(function(n) {
      html += '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">'
        + '<input type="checkbox" id="' + n[0] + '" style="width:18px;height:18px;"' + (n[1] ? ' checked' : '') + '>'
        + '<div><strong style="font-size:13px;">' + n[2] + '</strong><div style="font-size:11px;color:var(--text-light);">' + n[3] + '</div></div></label>';
    });
    html += '</div></div>';

    // ── Default Quote & Invoice Settings ──
    var qd = {
      paymentTerms: localStorage.getItem('bm-payment-terms') || 'net30',
      defaultDeposit: localStorage.getItem('bm-default-deposit') || '50',
      quoteValidity: localStorage.getItem('bm-quote-validity') || '30',
      showLineItemPrices: localStorage.getItem('bm-show-line-prices') !== 'false',
      companyLogo: localStorage.getItem('bm-company-logo') || ''
    };
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<h3 style="margin:0;">Quote & Invoice Defaults</h3>'
      + '<button onclick="SettingsPage._saveQuoteDefaults()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 18px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">Save</button>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Payment Terms</label>'
      + '<select id="qd-terms" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;">'
      + '<option value="due-on-completion"' + (qd.paymentTerms === 'due-on-completion' ? ' selected' : '') + '>Due on completion</option>'
      + '<option value="net15"' + (qd.paymentTerms === 'net15' ? ' selected' : '') + '>Net 15</option>'
      + '<option value="net30"' + (qd.paymentTerms === 'net30' ? ' selected' : '') + '>Net 30</option>'
      + '<option value="net60"' + (qd.paymentTerms === 'net60' ? ' selected' : '') + '>Net 60</option>'
      + '</select></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Default Deposit %</label>'
      + '<input type="number" id="qd-deposit" value="' + qd.defaultDeposit + '" min="0" max="100" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Quote Valid (days)</label>'
      + '<input type="number" id="qd-validity" value="' + qd.quoteValidity + '" min="1" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '<div style="display:flex;align-items:center;gap:8px;padding-top:20px;">'
      + '<input type="checkbox" id="qd-show-prices" style="width:18px;height:18px;"' + (qd.showLineItemPrices ? ' checked' : '') + '>'
      + '<label style="font-size:13px;">Show line item prices to client</label>'
      + '</div>'
      + '</div>'
      + '</div>';

    // ── Booking Form Settings ──
    var bf = {
      enabled: localStorage.getItem('bm-booking-enabled') !== 'false',
      autoResponse: localStorage.getItem('bm-booking-auto-response') !== 'false',
      requirePhone: localStorage.getItem('bm-booking-require-phone') !== 'false',
      requireAddress: localStorage.getItem('bm-booking-require-address') !== 'false',
      showServices: localStorage.getItem('bm-booking-show-services') !== 'false'
    };
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<h3 style="margin:0;">Online Booking</h3>'
      + '<button onclick="SettingsPage._saveBookingSettings()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 18px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">Save</button>'
      + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:10px;">'
      + '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">'
      + '<input type="checkbox" id="bf-enabled" style="width:18px;height:18px;"' + (bf.enabled ? ' checked' : '') + '>'
      + '<div><strong style="font-size:13px;">Online Booking Enabled</strong><div style="font-size:11px;color:var(--text-light);">Show booking form at peekskilltree.com/branchmanager/book.html</div></div></label>'
      + '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">'
      + '<input type="checkbox" id="bf-auto-response" style="width:18px;height:18px;"' + (bf.autoResponse ? ' checked' : '') + '>'
      + '<div><strong style="font-size:13px;">Auto-Response Email</strong><div style="font-size:11px;color:var(--text-light);">Send confirmation email when request is received</div></div></label>'
      + '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">'
      + '<input type="checkbox" id="bf-require-phone" style="width:18px;height:18px;"' + (bf.requirePhone ? ' checked' : '') + '>'
      + '<div><strong style="font-size:13px;">Require Phone Number</strong></div></label>'
      + '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">'
      + '<input type="checkbox" id="bf-require-address" style="width:18px;height:18px;"' + (bf.requireAddress ? ' checked' : '') + '>'
      + '<div><strong style="font-size:13px;">Require Property Address</strong></div></label>'
      + '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">'
      + '<input type="checkbox" id="bf-show-services" style="width:18px;height:18px;"' + (bf.showServices ? ' checked' : '') + '>'
      + '<div><strong style="font-size:13px;">Show Service Picker</strong><div style="font-size:11px;color:var(--text-light);">Let clients select the type of service they need</div></div></label>'
      + '</div></div>';

    // ── Review Settings ──
    var rev = {
      googleUrl: localStorage.getItem('bm-review-google-url') || 'https://g.page/r/CfY_something/review',
      sendAfter: localStorage.getItem('bm-review-send-after') || 'completion',
      delayDays: localStorage.getItem('bm-review-delay') || '1',
      autoSend: localStorage.getItem('bm-review-auto') === 'true'
    };
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<h3 style="margin:0;">Review Requests</h3>'
      + '<button onclick="SettingsPage._saveReviewSettings()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 18px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">Save</button>'
      + '</div>'
      + '<div style="margin-bottom:12px;"><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Google Review Link</label>'
      + '<input type="url" id="rev-google-url" value="' + UI.esc(rev.googleUrl) + '" placeholder="https://g.page/r/your-business/review" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;box-sizing:border-box;">'
      + '<div style="font-size:11px;color:var(--text-light);margin-top:2px;">Get this from Google Business Profile → Share review link</div></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Send After</label>'
      + '<select id="rev-send-after" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;">'
      + '<option value="completion"' + (rev.sendAfter === 'completion' ? ' selected' : '') + '>Job Completed</option>'
      + '<option value="payment"' + (rev.sendAfter === 'payment' ? ' selected' : '') + '>Payment Received</option>'
      + '</select></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Delay (days)</label>'
      + '<input type="number" id="rev-delay" value="' + rev.delayDays + '" min="0" max="14" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '</div>'
      + '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">'
      + '<input type="checkbox" id="rev-auto" style="width:18px;height:18px;"' + (rev.autoSend ? ' checked' : '') + '>'
      + '<div><strong style="font-size:13px;">Auto-Send Review Requests</strong><div style="font-size:11px;color:var(--text-light);">Automatically email clients after job/payment (requires SendGrid)</div></div></label>'
      + '</div>';

    // ── Regional Settings ──
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<h3 style="margin:0 0 16px;">Regional Settings</h3>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Country</label>'
      + '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;font-size:14px;">United States</div></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Timezone</label>'
      + '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;font-size:14px;">(GMT-05:00) America/New_York</div></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Date Format</label>'
      + '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;font-size:14px;">Jan 31, 2026</div></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Time Format</label>'
      + '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;font-size:14px;">12 Hour (1:30 PM)</div></div>'
      + '</div></div>';

    // ── Connected Apps ──
    var connectedApps = [
      { name: 'SendGrid', status: !!(localStorage.getItem('bm-sendgrid-key')), desc: 'Email delivery' },
      { name: 'Stripe', status: !!(localStorage.getItem('bm-stripe-key') || (typeof Stripe !== 'undefined')), desc: 'Payment processing' },
      { name: 'Gusto', status: !!(localStorage.getItem('bm-gusto-api-key')), desc: 'Payroll' },
      { name: 'AI Assistant', status: !!(localStorage.getItem('bm-claude-key')), desc: 'AI pricing & emails' },
      { name: 'Dialpad', status: !!(localStorage.getItem('bm-dialpad-key')), desc: 'Phone system' },
      { name: 'SendJim', status: !!(localStorage.getItem('bm-sendjim-key')), desc: 'Direct mail' }
    ];
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<h3 style="margin:0 0 16px;">Connected Apps</h3>';
    connectedApps.forEach(function(app) {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f5f5;">'
        + '<div style="display:flex;align-items:center;gap:10px;">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:' + (app.status ? 'var(--green-dark)' : '#ccc') + ';"></div>'
        + '<div><strong style="font-size:13px;">' + app.name + '</strong>'
        + '<div style="font-size:11px;color:var(--text-light);">' + app.desc + '</div></div>'
        + '</div>'
        + '<span style="font-size:12px;font-weight:600;color:' + (app.status ? 'var(--green-dark)' : 'var(--text-light)') + ';">' + (app.status ? 'Connected' : 'Not connected') + '</span>'
        + '</div>';
    });
    html += '</div>';

    // Products & Services Catalog
    var allServices = DB.services.getAll();
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<div><h3 style="margin:0;">Products &amp; Services</h3>'
      + '<div style="font-size:12px;color:var(--text-light);margin-top:2px;">' + allServices.length + ' items — used in quotes and invoices</div>'
      + '</div>'
      + '<button onclick="SettingsPage.addService()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">+ Add Item</button>'
      + '</div>'
      + '<div id="services-list">';
    allServices.forEach(function(svc) {
      html += '<div style="display:grid;grid-template-columns:2fr 3fr 80px 80px 36px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">'
        + '<div style="font-size:13px;font-weight:600;">' + UI.esc(svc.name) + '</div>'
        + '<div style="font-size:12px;color:var(--text-light);">' + UI.esc(svc.description || '') + '</div>'
        + '<div style="font-size:12px;color:var(--text-light);">' + (svc.type || 'service') + '</div>'
        + '<div style="font-size:13px;font-weight:600;">' + (svc.price ? UI.money(svc.price) : '—') + '</div>'
        + '<button onclick="SettingsPage.editService(\'' + svc.id + '\')" style="background:none;border:1px solid var(--border);padding:4px 8px;border-radius:4px;font-size:12px;cursor:pointer;">Edit</button>'
        + '</div>';
    });
    html += '</div></div>';

    // Data Summary
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<h3 style="margin-bottom:16px;">Data Summary</h3>'
      + '<div class="stat-grid" style="margin-bottom:0;">'
      + '<div class="stat-card"><div class="stat-label">Clients</div><div class="stat-value">' + stats.totalClients + '</div></div>'
      + '<div class="stat-card"><div class="stat-label">Jobs</div><div class="stat-value">' + DB.jobs.count() + '</div></div>'
      + '<div class="stat-card"><div class="stat-label">Invoices</div><div class="stat-value">' + DB.invoices.count() + '</div></div>'
      + '<div class="stat-card"><div class="stat-label">Quotes</div><div class="stat-value">' + DB.quotes.count() + '</div></div>'
      + '</div></div>';

    // Email (SendGrid) — inline, always first integration shown
    var sgKey = localStorage.getItem('bm-sendgrid-key') || '';
    var sgOk = sgKey.length > 10;
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:2px solid ' + (sgOk ? 'var(--green-light)' : 'var(--border)') + ';margin-bottom:16px;">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'
      + '<div style="width:40px;height:40px;background:#1a82e2;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;">SG</div>'
      + '<div><h3 style="margin:0;">SendGrid Email</h3>'
      + '<div style="font-size:12px;color:' + (sgOk ? 'var(--green-dark)' : '#e07c24') + ';font-weight:600;">' + (sgOk ? '✅ Connected — automated emails active' : '⚠️ Not connected — paste your key below') + '</div>'
      + '</div></div>'
      + '<div style="margin-bottom:8px;"><input type="password" id="sendgrid-key" value="' + sgKey + '" placeholder="SG.xxxxxxxxxxxxxxx..." style="width:100%;padding:10px;border:2px solid ' + (sgOk ? 'var(--green-light)' : 'var(--border)') + ';border-radius:8px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button onclick="var k=document.getElementById(\'sendgrid-key\').value.trim();if(!k){UI.toast(\'Paste your key first\',\'error\');return;}localStorage.setItem(\'bm-sendgrid-key\',k);if(typeof Email!==\'undefined\'){Email.apiKey=k;}UI.toast(\'SendGrid connected! ✅\');loadPage(\'settings\');" style="background:var(--green-dark);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer;">Save Key</button>'
      + (sgOk ? '<button onclick="if(typeof Email!==\'undefined\'){Email.send(\'info@peekskilltree.com\',\'Branch Manager Test\',\'SendGrid is connected and working!\').then(function(){UI.toast(\'Test sent! Check info@peekskilltree.com\');}).catch(function(e){UI.toast(\'Failed: \'+e.message,\'error\');});}else{UI.toast(\'Email module not loaded\',\'error\');}" style="background:#1a82e2;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer;">Send Test Email</button>' : '')
      + (sgOk ? '<button onclick="SettingsPage._removeKey(\'bm-sendgrid-key\',\'SendGrid\')" style="background:none;border:1px solid var(--border);padding:10px 20px;border-radius:6px;font-size:13px;cursor:pointer;">Remove</button>' : '')
      + '</div>'
      + '<p style="font-size:11px;color:var(--text-light);margin-top:8px;">Enables: automated quote follow-ups, invoice reminders, visit reminders, review requests. Free: 100 emails/day.</p>'
      + '</div>';

    // AI Assistant
    var aiKey = localStorage.getItem('bm-claude-key') || '';
    var aiOk = aiKey.length > 10;
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:2px solid ' + (aiOk ? 'var(--green-light)' : 'var(--border)') + ';margin-bottom:16px;">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'
      + '<div style="width:40px;height:40px;background:linear-gradient(135deg,#D4A574,#C4956A);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;">🤖</div>'
      + '<div><h3 style="margin:0;">AI Assistant</h3>'
      + '<div style="font-size:12px;color:' + (aiOk ? 'var(--green-dark)' : '#e07c24') + ';font-weight:600;">' + (aiOk ? '✅ Connected — AI estimates & emails active' : '⚠️ Not connected — paste your AI API key') + '</div>'
      + '</div></div>'
      + '<div style="margin-bottom:8px;"><input type="password" id="claude-ai-key" value="' + aiKey + '" placeholder="sk-ant-api03-..." style="width:100%;padding:10px;border:2px solid ' + (aiOk ? 'var(--green-light)' : 'var(--border)') + ';border-radius:8px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button onclick="var k=document.getElementById(\'claude-ai-key\').value.trim();if(!k){UI.toast(\'Paste your key first\',\'error\');return;}localStorage.setItem(\'bm-claude-key\',k);if(typeof AI!==\'undefined\'){AI._apiKey=k;}UI.toast(\'AI Assistant connected! ✅\');loadPage(\'settings\');" style="background:var(--green-dark);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer;">Save Key</button>'
      + (aiOk ? '<button onclick="SettingsPage._removeKey(\'bm-claude-key\',\'AI Assistant\')" style="background:none;border:1px solid var(--border);padding:10px 20px;border-radius:6px;font-size:13px;cursor:pointer;">Remove</button>' : '')
      + '</div>'
      + '<p style="font-size:11px;color:var(--text-light);margin-top:8px;">Get your key at <a href="https://console.anthropic.com" target="_blank" style="color:var(--accent);">console.anthropic.com</a> → API Keys → Create Key (free tier available)</p>'
      + '</div>';

    // ── Stripe Payment Link ──
    var stripeLink = localStorage.getItem('bm-stripe-base-link') || '';
    var stripeOkNow = stripeLink.length > 20;
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:2px solid ' + (stripeOkNow ? 'var(--green-light)' : 'var(--border)') + ';margin-bottom:16px;">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'
      + '<div style="width:40px;height:40px;background:#635BFF;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;">💳</div>'
      + '<div><h3 style="margin:0;">Stripe Payments</h3>'
      + '<div style="font-size:12px;color:' + (stripeOkNow ? 'var(--green-dark)' : '#e07c24') + ';font-weight:600;">' + (stripeOkNow ? '✅ Connected — clients can pay invoices online' : '⚠️ Not connected — paste your Stripe payment link') + '</div>'
      + '</div></div>'
      + '<div style="margin-bottom:8px;"><input type="text" id="stripe-link" value="' + stripeLink + '" placeholder="https://buy.stripe.com/xxxxxxxxxx" style="width:100%;padding:10px;border:2px solid ' + (stripeOkNow ? 'var(--green-light)' : 'var(--border)') + ';border-radius:8px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button onclick="var k=document.getElementById(\'stripe-link\').value.trim();if(!k){UI.toast(\'Paste your Stripe link first\',\'error\');return;}if(!/^https:\\/\\/buy\\.stripe\\.com\\//.test(k)){UI.toast(\'Must be a buy.stripe.com link\',\'error\');return;}localStorage.setItem(\'bm-stripe-base-link\',k);UI.toast(\'Stripe connected! ✅\');loadPage(\'settings\');" style="background:var(--green-dark);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer;">Save Link</button>'
      + (stripeOkNow ? '<button onclick="SettingsPage._removeKey(\'bm-stripe-base-link\',\'Stripe\')" style="background:none;border:1px solid var(--border);padding:10px 20px;border-radius:6px;font-size:13px;cursor:pointer;">Remove</button>' : '')
      + '</div>'
      + '<p style="font-size:11px;color:var(--text-light);margin-top:8px;">Create at <a href="https://dashboard.stripe.com/payment-links/create" target="_blank" style="color:var(--accent);">Stripe → Payment Links → New</a>. Set "Customer pays what they want" with a reasonable default. Redirect after payment to <code style="background:var(--bg);padding:1px 5px;border-radius:3px;font-size:10px;">https://peekskilltree.com/branchmanager/paid.html</code></p>'
      + '</div>';

    // ── Dialpad ──
    var dialpadKey = localStorage.getItem('bm-dialpad-key') || '';
    var dialpadOk = dialpadKey.length > 10;
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:2px solid ' + (dialpadOk ? 'var(--green-light)' : 'var(--border)') + ';margin-bottom:16px;">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'
      + '<div style="width:40px;height:40px;background:#7A49D6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;">📞</div>'
      + '<div><h3 style="margin:0;">Dialpad Phone / SMS</h3>'
      + '<div style="font-size:12px;color:' + (dialpadOk ? 'var(--green-dark)' : '#e07c24') + ';font-weight:600;">' + (dialpadOk ? '✅ Connected — calls & texts log automatically' : '⚠️ Not connected — paste your Dialpad API token') + '</div>'
      + '</div></div>'
      + '<div style="margin-bottom:8px;"><input type="password" id="dialpad-key" value="' + dialpadKey + '" placeholder="dp_api_xxxxxxxxxxxx" style="width:100%;padding:10px;border:2px solid ' + (dialpadOk ? 'var(--green-light)' : 'var(--border)') + ';border-radius:8px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button onclick="var k=document.getElementById(\'dialpad-key\').value.trim();if(!k){UI.toast(\'Paste your token first\',\'error\');return;}localStorage.setItem(\'bm-dialpad-key\',k);localStorage.setItem(\'bm-receptionist-settings\',JSON.stringify({connected:true}));if(typeof Dialpad!==\'undefined\'){Dialpad.apiKey=k;}UI.toast(\'Dialpad connected! ✅\');loadPage(\'settings\');" style="background:var(--green-dark);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer;">Save Token</button>'
      + '<button onclick="SettingsPage._testDialpad()" style="background:#fff;color:var(--text);border:1px solid var(--border);padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;cursor:pointer;">🔌 Test Connection</button>'
      + (dialpadOk ? '<button onclick="SettingsPage._removeKey(\'bm-dialpad-key\',\'Dialpad\')" style="background:none;border:1px solid var(--border);padding:10px 20px;border-radius:6px;font-size:13px;cursor:pointer;">Remove</button>' : '')
      + '</div>'
      + '<div id="dialpad-test-result" style="margin-top:10px;font-size:13px;"></div>'
      + '<p style="font-size:11px;color:var(--text-light);margin-top:8px;">Get token at <a href="https://dialpad.com/accounts/api/keys" target="_blank" style="color:var(--accent);">dialpad.com → API Keys</a>. Also register a 10DLC number for SMS compliance.</p>'
      + '</div>';

    // ── Gusto ──
    var gustoKey = localStorage.getItem('bm-gusto-api-key') || '';
    var gustoOk = gustoKey.length > 10;
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:2px solid ' + (gustoOk ? 'var(--green-light)' : 'var(--border)') + ';margin-bottom:16px;">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'
      + '<div style="width:40px;height:40px;background:#F45D22;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;">💼</div>'
      + '<div><h3 style="margin:0;">Gusto Payroll</h3>'
      + '<div style="font-size:12px;color:' + (gustoOk ? 'var(--green-dark)' : '#e07c24') + ';font-weight:600;">' + (gustoOk ? '✅ Connected — payroll export enabled' : '⚠️ Not connected — API token optional, CSV export works without it') + '</div>'
      + '</div></div>'
      + '<div style="margin-bottom:8px;"><input type="password" id="gusto-key" value="' + gustoKey + '" placeholder="gst_access_token_xxxxxxx (optional)" style="width:100%;padding:10px;border:2px solid ' + (gustoOk ? 'var(--green-light)' : 'var(--border)') + ';border-radius:8px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button onclick="var k=document.getElementById(\'gusto-key\').value.trim();if(!k){UI.toast(\'Paste your token first\',\'error\');return;}localStorage.setItem(\'bm-gusto-api-key\',k);UI.toast(\'Gusto connected! ✅\');loadPage(\'settings\');" style="background:var(--green-dark);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer;">Save Token</button>'
      + '<button onclick="loadPage(\'payroll\');" style="background:none;border:1px solid var(--border);padding:10px 20px;border-radius:6px;font-size:13px;cursor:pointer;">Open Payroll</button>'
      + (gustoOk ? '<button onclick="SettingsPage._removeKey(\'bm-gusto-api-key\',\'Gusto\')" style="background:none;border:1px solid var(--border);padding:10px 20px;border-radius:6px;font-size:13px;cursor:pointer;">Remove</button>' : '')
      + '</div>'
      + '<p style="font-size:11px;color:var(--text-light);margin-top:8px;">Sign up at <a href="https://gusto.com" target="_blank" style="color:var(--accent);">gusto.com</a> ($40/mo + $6/employee). API token is optional — BM Payroll page exports CSV you upload to Gusto manually each pay period. Get token from Gusto Dev Portal.</p>'
      + '</div>';

    // Photo Storage info
    html += '<div style="background:#f0f7ff;border-radius:12px;padding:14px 18px;border:1px solid #b3d4f5;margin-bottom:16px;display:flex;align-items:center;gap:12px;">'
      + '<span style="font-size:22px;">📸</span>'
      + '<div style="font-size:13px;color:#1a5276;">'
      + '<strong>Photo Storage</strong> — Uses Supabase Storage bucket <code style="background:#d6eaf8;padding:1px 5px;border-radius:4px;">job-photos</code>. Run the RLS SQL below (Database Connection section) to create the bucket and enable photo uploads on jobs.'
      + '</div></div>';

    // Stripe Payments
    if (typeof Stripe !== 'undefined' && Stripe.renderSettings) {
      html += Stripe.renderSettings();
    } else {
      html += '<div style="padding:12px;color:var(--text-light);font-size:13px;">Stripe integration not loaded.</div>';
    }

    // Dialpad Calling & SMS
    if (typeof Dialpad !== 'undefined' && Dialpad.renderSettings) {
      html += Dialpad.renderSettings();
    } else {
      html += '<div style="padding:12px;color:var(--text-light);font-size:13px;">Dialpad integration not loaded.</div>';
    }

    // SendJim Direct Mail
    if (typeof SendJim !== 'undefined' && SendJim.renderSettings) {
      html += SendJim.renderSettings();
    } else {
      html += '<div style="padding:12px;color:var(--text-light);font-size:13px;">SendJim integration not loaded.</div>';
    }

    // Custom Fields
    if (typeof CustomFields !== 'undefined') {
      html += CustomFields.renderSettings();
    }

    // Checklist Templates
    if (typeof Checklists !== 'undefined') {
      html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
        + Checklists.renderTemplateManager()
        + '</div>';
    }

    // Email Templates
    if (typeof EmailTemplates !== 'undefined') {
      html += EmailTemplates.renderSettings();
    }

    // Crew Performance link
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;">'
      + '<div><h3 style="margin-bottom:4px;">Crew Performance</h3>'
      + '<p style="font-size:13px;color:var(--text-light);margin:0;">View crew metrics, leaderboards, and productivity stats</p></div>'
      + '<button class="btn btn-outline" onclick="loadPage(\'crewperformance\')">View Dashboard →</button>'
      + '</div></div>';

    // Sync from Cloud
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;">'
      + '<div><h3 style="margin-bottom:4px;">Cloud Sync</h3>'
      + '<p style="font-size:13px;color:var(--text-light);margin:0;">Pull latest data from Supabase to this device</p></div>'
      + '<button class="btn btn-primary" onclick="SettingsPage.syncNow(this)">Sync Now</button>'
      + '</div></div>';

    // Supabase Connection
    var isConnected = (typeof SupabaseDB !== 'undefined' && SupabaseDB.ready) || stats.totalClients > 100;
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<h3 style="margin-bottom:8px;">Database Connection</h3>';
    if (isConnected) {
      html += '<div style="display:inline-block;padding:6px 12px;background:#e8f5e9;border-radius:8px;font-size:13px;font-weight:600;color:#2e7d32;margin-bottom:12px;">Connected to Supabase</div>'
        + '<p style="font-size:13px;color:var(--text-light);margin-bottom:12px;">Project: ltpivkqahvplapyagljt (West US Oregon)</p>'
        + '<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--green-dark);margin-bottom:8px;">🔒 Client-facing RLS Policies (required for approve.html &amp; pay.html)</summary>'
        + '<p style="font-size:12px;color:var(--text-light);margin-bottom:8px;">Run this SQL once in your <a href="https://supabase.com/dashboard/project/ltpivkqahvplapyagljt/sql" target="_blank" style="color:var(--green-dark);">Supabase SQL Editor</a> to allow clients to view &amp; approve quotes and pay invoices:</p>'
        + '<pre style="background:#1e2128;color:#a8d8a8;padding:14px;border-radius:8px;font-size:11px;overflow:auto;white-space:pre;line-height:1.6;">'
        + '-- Safe to re-run: drops existing policies first\n'
        + 'DROP POLICY IF EXISTS "Anon read quotes" ON quotes;\n'
        + 'DROP POLICY IF EXISTS "Anon update quote status" ON quotes;\n'
        + 'DROP POLICY IF EXISTS "Anon read invoices" ON invoices;\n'
        + 'DROP POLICY IF EXISTS "Anon read clients" ON clients;\n'
        + 'DROP POLICY IF EXISTS "Anon insert requests" ON requests;\n\n'
        + '-- Allow anonymous clients to read non-draft quotes (for approve.html)\n'
        + 'CREATE POLICY "Anon read quotes"\n'
        + '  ON quotes FOR SELECT TO anon\n'
        + '  USING (status &lt;&gt; \'draft\');\n\n'
        + '-- Allow anonymous clients to approve/request changes on sent quotes\n'
        + 'CREATE POLICY "Anon update quote status"\n'
        + '  ON quotes FOR UPDATE TO anon\n'
        + '  USING (status IN (\'sent\', \'awaiting\'))\n'
        + '  WITH CHECK (status IN (\'approved\', \'awaiting\'));\n\n'
        + '-- Allow anonymous clients to read non-draft invoices (for pay.html)\n'
        + 'CREATE POLICY "Anon read invoices"\n'
        + '  ON invoices FOR SELECT TO anon\n'
        + '  USING (status &lt;&gt; \'draft\');\n\n'
        + '-- Allow anonymous clients to read client portal data (for client.html)\n'
        + 'CREATE POLICY "Anon read clients"\n'
        + '  ON clients FOR SELECT TO anon\n'
        + '  USING (true);\n\n'
        + '-- Allow anonymous form submissions (for book.html)\n'
        + 'CREATE POLICY "Anon insert requests"\n'
        + '  ON requests FOR INSERT TO anon\n'
        + '  WITH CHECK (true);\n\n'
        + '-- Storage bucket for job photos\n'
        + 'INSERT INTO storage.buckets (id, name, public)\n'
        + 'VALUES (\'job-photos\', \'job-photos\', true)\n'
        + 'ON CONFLICT (id) DO NOTHING;\n\n'
        + '-- Allow public read of job photos\n'
        + 'DROP POLICY IF EXISTS "Public read job photos" ON storage.objects;\n'
        + 'CREATE POLICY "Public read job photos" ON storage.objects\n'
        + '  FOR SELECT USING (bucket_id = \'job-photos\');\n\n'
        + '-- Allow authenticated/anon insert to job-photos\n'
        + 'DROP POLICY IF EXISTS "Anon upload job photos" ON storage.objects;\n'
        + 'CREATE POLICY "Anon upload job photos" ON storage.objects\n'
        + '  FOR INSERT WITH CHECK (bucket_id = \'job-photos\');\n\n'
        + '-- Allow delete own photos\n'
        + 'DROP POLICY IF EXISTS "Anon delete job photos" ON storage.objects;\n'
        + 'CREATE POLICY "Anon delete job photos" ON storage.objects\n'
        + '  FOR DELETE USING (bucket_id = \'job-photos\');</pre>'
        + '<button onclick="SettingsPage._copyRlsSql()" style="margin-top:8px;padding:6px 14px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Copy SQL</button>'
        + '</details>'
        + '<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--green-dark);margin-bottom:8px;">🗄️ Add Missing Columns (run once on live DB)</summary>'
        + '<p style="font-size:12px;color:var(--text-light);margin-bottom:8px;">If your Supabase tables were created before these columns were added, run this SQL to add them (safe — IF NOT EXISTS means it won\'t fail if already present):</p>'
        + '<pre style="background:#1e2128;color:#a8d8a8;padding:14px;border-radius:8px;font-size:11px;overflow:auto;white-space:pre;line-height:1.6;">'
        + '-- Invoices\n'
        + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_email TEXT;\n'
        + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_phone TEXT;\n'
        + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) DEFAULT 0;\n'
        + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_date DATE;\n'
        + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_payment_url TEXT;\n'
        + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link_sent TIMESTAMPTZ;\n'
        + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link_email TEXT;\n'
        + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;\n\n'
        + '-- Jobs\n'
        + 'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_email TEXT;\n'
        + 'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_phone TEXT;\n'
        + 'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoice_id TEXT;\n'
        + 'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_date DATE;\n\n'
        + '-- Quotes\n'
        + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS client_email TEXT;\n'
        + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS client_phone TEXT;\n'
        + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS expires_at DATE;\n'
        + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN DEFAULT false;\n'
        + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_due DECIMAL(10,2) DEFAULT 0;\n'
        + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_paid BOOLEAN DEFAULT false;\n'
        + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;\n'
        + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS client_changes TEXT;</pre>'
        + '<button onclick="SettingsPage._copyColumnSql()" style="margin-top:8px;padding:6px 14px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Copy SQL</button>'
        + '</details>'
        + '<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--green-dark);margin-bottom:8px;">💸 Create Expenses Table (run once)</summary>'
        + '<p style="font-size:12px;color:var(--text-light);margin-bottom:8px;">If you haven\'t run the full schema yet, run this to create the expenses table and enable cloud sync for expenses:</p>'
        + '<pre id="expenses-sql-block" style="background:#1e2128;color:#a8d8a8;padding:14px;border-radius:8px;font-size:11px;overflow:auto;white-space:pre;line-height:1.6;">'
        + 'CREATE TABLE IF NOT EXISTS expenses (\n'
        + '  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,\n'
        + '  date TIMESTAMPTZ DEFAULT now(),\n'
        + '  amount NUMERIC(10,2) DEFAULT 0,\n'
        + '  category TEXT,\n'
        + '  description TEXT,\n'
        + '  vendor TEXT,\n'
        + '  job TEXT,\n'
        + '  job_id TEXT,\n'
        + '  receipt_url TEXT,\n'
        + '  notes TEXT,\n'
        + '  employee TEXT,\n'
        + '  created_at TIMESTAMPTZ DEFAULT now(),\n'
        + '  updated_at TIMESTAMPTZ DEFAULT now()\n'
        + ');\n\n'
        + 'ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;\n\n'
        + 'DROP POLICY IF EXISTS "Allow all for authenticated" ON expenses;\n'
        + 'CREATE POLICY "Allow all for authenticated"\n'
        + '  ON expenses FOR ALL\n'
        + '  USING (true);\n\n'
        + 'CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);\n'
        + 'CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);</pre>'
        + '<button onclick="SettingsPage._copyExpensesSql()" style="margin-top:8px;padding:6px 14px;background:var(--green-dark);color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Copy SQL</button>'
        + '</details>';
    } else {
      html += '<p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">Connect to Supabase for cloud sync, multi-device access, and team features.</p>'
        + '<div style="display:inline-block;padding:6px 12px;background:#fff3e0;border-radius:8px;font-size:13px;font-weight:600;color:#e65100;margin-bottom:12px;">Local Storage Mode — data lives on this device only</div>'
        + UI.formField('Supabase URL', 'text', 'sb-url', '', { placeholder: 'https://your-project.supabase.co' })
        + UI.formField('Supabase Anon Key', 'text', 'sb-key', '', { placeholder: 'eyJhbGciOiJIUzI1NiIs...' })
        + '<button class="btn btn-primary" onclick="SettingsPage.connectSupabase()">Connect to Supabase</button>';
    }
    html += '</div>';

    // Import from previous system
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<h3 style="margin-bottom:8px;">Import from previous system</h3>'
      + '<p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">Export CSVs from previous system (Clients → More Actions → Export) and import them here.</p>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + '<div>'
      + '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">Clients CSV</label>'
      + '<input type="file" id="import-clients" accept=".csv" onchange="SettingsPage.importFile(\'clients\', this)">'
      + '</div>'
      + '<div>'
      + '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">Jobs CSV</label>'
      + '<input type="file" id="import-jobs" accept=".csv" onchange="SettingsPage.importFile(\'jobs\', this)">'
      + '</div>'
      + '<div>'
      + '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">Invoices CSV</label>'
      + '<input type="file" id="import-invoices" accept=".csv" onchange="SettingsPage.importFile(\'invoices\', this)">'
      + '</div>'
      + '<div>'
      + '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">Quotes CSV</label>'
      + '<input type="file" id="import-quotes" accept=".csv" onchange="SettingsPage.importFile(\'quotes\', this)">'
      + '</div>'
      + '</div>'
      + '<div id="import-status" style="margin-top:12px;font-size:13px;color:var(--green-dark);"></div>'
      + '</div>';

    // Data Management
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid #ffcdd2;margin-bottom:16px;">'
      + '<h3 style="color:var(--red);margin-bottom:8px;">Data Management</h3>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">'
      + '<button class="btn btn-outline" onclick="SettingsPage.deduplicateTags()">Fix Duplicate Tags</button>'
      + '<button class="btn btn-outline" onclick="SettingsPage.resetDemo()">Reset to Demo Data</button>'
      + '<button class="btn" style="background:var(--red);color:#fff;" onclick="SettingsPage.clearAll()">Clear All Data</button>'
      + '</div>'
      + '<div style="font-size:12px;color:var(--text-light);">"Fix Duplicate Tags" removes duplicate tags from imported client records (e.g., [VIP, VIP] → [VIP]).</div>'
      + '</div>';

    // Security
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<h3 style="margin-bottom:12px;">🔒 Security</h3>'
      + '<div style="display:grid;gap:12px;">'
      // Session timeout
      + '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg);border-radius:8px;">'
      + '<div><div style="font-weight:600;font-size:13px;">Session Timeout</div>'
      + '<div style="font-size:12px;color:var(--text-light);">Auto-logout after 30 minutes of inactivity</div></div>'
      + '<span style="color:var(--green-dark);font-weight:700;font-size:13px;">✓ Active</span></div>'
      // Audit logging
      + '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg);border-radius:8px;">'
      + '<div><div style="font-weight:600;font-size:13px;">Audit Logging</div>'
      + '<div style="font-size:12px;color:var(--text-light);">All data changes are logged with user, timestamp, and action</div></div>'
      + '<button class="btn btn-outline" style="font-size:12px;" onclick="SettingsPage.showAuditLog()">View Log</button></div>'
      // Secure logout
      + '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg);border-radius:8px;">'
      + '<div><div style="font-weight:600;font-size:13px;">Secure Logout</div>'
      + '<div style="font-size:12px;color:var(--text-light);">Clears cached data and service worker on logout</div></div>'
      + '<span style="color:var(--green-dark);font-weight:700;font-size:13px;">✓ Active</span></div>'
      // Change password
      + '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg);border-radius:8px;">'
      + '<div><div style="font-weight:600;font-size:13px;">Change Password</div>'
      + '<div style="font-size:12px;color:var(--text-light);">Update login password for local auth</div></div>'
      + '<button class="btn btn-outline" style="font-size:12px;" onclick="SettingsPage.changePassword()">Change</button></div>'
      // RLS status
      + '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#fff3e0;border-radius:8px;border:1px solid #ffe0b2;">'
      + '<div><div style="font-weight:600;font-size:13px;color:#e65100;">⚠️ Database RLS Policies</div>'
      + '<div style="font-size:12px;color:#bf360c;">Run <code>migrate-rls.sql</code> in Supabase SQL Editor to restrict anon key access</div></div>'
      + '<a href="https://supabase.com/dashboard" target="_blank" class="btn btn-outline" style="font-size:12px;">Open Supabase</a></div>'
      // 2FA
      + '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#fff3e0;border-radius:8px;border:1px solid #ffe0b2;">'
      + '<div><div style="font-weight:600;font-size:13px;color:#e65100;">⚠️ Two-Factor Authentication</div>'
      + '<div style="font-size:12px;color:#bf360c;">Enable 2FA in Supabase Auth settings for extra protection</div></div>'
      + '<a href="https://supabase.com/dashboard" target="_blank" class="btn btn-outline" style="font-size:12px;">Enable</a></div>'
      + '</div></div>';

    // Admin Tools
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<h3 style="margin-bottom:14px;">Admin Tools</h3>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      + '<button onclick="loadPage(\'permissions\')" style="display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--bg);border:1px solid var(--border);border-radius:10px;cursor:pointer;text-align:left;font-size:13px;font-weight:600;color:var(--text);"><span style="font-size:18px;">🛡</span><div>Permissions & Roles<div style="font-size:11px;font-weight:400;color:var(--text-light);margin-top:2px;">RBAC roles, 25 permissions</div></div></button>'
      + '<button onclick="loadPage(\'customfields\')" style="display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--bg);border:1px solid var(--border);border-radius:10px;cursor:pointer;text-align:left;font-size:13px;font-weight:600;color:var(--text);"><span style="font-size:18px;">🔧</span><div>Custom Fields<div style="font-size:11px;font-weight:400;color:var(--text-light);margin-top:2px;">Add fields to clients, jobs, quotes</div></div></button>'
      + '<button onclick="loadPage(\'backup\')" style="display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--bg);border:1px solid var(--border);border-radius:10px;cursor:pointer;text-align:left;font-size:13px;font-weight:600;color:var(--text);"><span style="font-size:18px;">💾</span><div>Backup & Restore<div style="font-size:11px;font-weight:400;color:var(--text-light);margin-top:2px;">Export/import all data</div></div></button>'
      + '<button onclick="loadPage(\'import\')" style="display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--bg);border:1px solid var(--border);border-radius:10px;cursor:pointer;text-align:left;font-size:13px;font-weight:600;color:var(--text);"><span style="font-size:18px;">📥</span><div>Import Data<div style="font-size:11px;font-weight:400;color:var(--text-light);margin-top:2px;">CSV, Jobber, bulk import</div></div></button>'
      + '</div></div>';

    // About
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<h3 style="margin-bottom:12px;">About Branch Manager</h3>'
      + '<div style="font-size:13px;color:var(--text-light);line-height:1.8;">'
      + '<div><strong>Version:</strong> 2.0.0</div>'
      + '<div><strong>Pages:</strong> 50 modules</div>'
      + '<div><strong>Stack:</strong> Vanilla JS + Supabase + Stripe + MapLibre</div>'
      + '<div><strong>Storage:</strong> localStorage + Supabase cloud sync</div>'
      + '<div><strong>PWA:</strong> Installable, offline capable</div>'
      + '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:12px;">Built for ' + BM_CONFIG.companyName + '. Replaces previous system ($50-130/mo) with a $0/mo custom solution.</div>'
      + '</div></div>';

    html += '</div>';
    return html;
  },

  connectSupabase: function() {
    var url = document.getElementById('sb-url').value.trim();
    var key = document.getElementById('sb-key').value.trim();
    if (!url || !key) { UI.toast('Enter both Supabase URL and Key', 'error'); return; }
    // Save config
    localStorage.setItem('bm-supabase-url', url);
    localStorage.setItem('bm-supabase-key', key);
    UI.toast('Supabase config saved. Reload to connect.');
  },

  importFile: function(type, input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    var reader = new FileReader();
    reader.onload = function(e) {
      var csv = e.target.result;
      var count = 0;
      var statusEl = document.getElementById('import-status');

      if (type === 'clients') {
        count = DB.importCSV(DB.KEYS.clients, csv, function(row) {
          return {
            name: (row['First name'] || row['Name'] || '') + (row['Last name'] ? ' ' + row['Last name'] : ''),
            company: row['Company name'] || row['Company'] || '',
            phone: row['Phone number'] || row['Phone'] || '',
            email: row['Email'] || row['Email address'] || '',
            address: [row['Street 1'] || row['Street'] || '', row['City'] || '', row['State'] || row['Province'] || '', row['Zip code'] || row['Postal code'] || ''].filter(Boolean).join(', '),
            status: (row['Status'] || 'active').toLowerCase(),
            tags: row['Tags'] ? row['Tags'].split(',').map(function(t){return t.trim();}) : []
          };
        });
      } else if (type === 'jobs') {
        count = DB.importCSV(DB.KEYS.jobs, csv, function(row) {
          return {
            clientName: row['Client name'] || row['Client'] || '',
            jobNumber: parseInt(row['Job number'] || row['#'] || 0),
            property: row['Property'] || row['Address'] || '',
            description: row['Title'] || row['Description'] || '',
            scheduledDate: row['Start date'] || row['Schedule'] || '',
            status: (row['Status'] || 'scheduled').toLowerCase(),
            total: parseFloat(row['Total'] || 0)
          };
        });
      } else if (type === 'invoices') {
        count = DB.importCSV(DB.KEYS.invoices, csv, function(row) {
          return {
            clientName: row['Client name'] || row['Client'] || '',
            invoiceNumber: parseInt(row['Invoice number'] || row['#'] || 0),
            subject: row['Subject'] || 'For Services Rendered',
            dueDate: row['Due date'] || '',
            status: (row['Status'] || 'draft').toLowerCase(),
            total: parseFloat(row['Total'] || 0),
            balance: parseFloat(row['Balance'] || row['Amount owing'] || 0)
          };
        });
      } else if (type === 'quotes') {
        count = DB.importCSV(DB.KEYS.quotes, csv, function(row) {
          return {
            clientName: row['Client name'] || row['Client'] || '',
            quoteNumber: parseInt(row['Quote number'] || row['#'] || 0),
            property: row['Property'] || row['Address'] || '',
            status: (row['Status'] || 'draft').toLowerCase(),
            total: parseFloat(row['Total'] || 0)
          };
        });
      }

      if (statusEl) statusEl.textContent = 'Imported ' + count + ' ' + type + ' from CSV.';
      UI.toast(count + ' ' + type + ' imported');
      loadPage('settings');
    };
    reader.readAsText(file);
  },

  resetDemo: function() {
    UI.confirm('Reset all data to demo? This will erase current data.', function() {
      Object.values(DB.KEYS).forEach(function(k) { localStorage.removeItem(k); });
      DB.seedDemo();
      UI.toast('Demo data restored');
      loadPage('settings');
    });
  },

  clearAll: function() {
    UI.confirm('Delete ALL data? This cannot be undone.', function() {
      Object.values(DB.KEYS).forEach(function(k) { localStorage.removeItem(k); });
      UI.toast('All data cleared');
      loadPage('settings');
    });
  },

  syncNow: function(btn) {
    if (btn) { btn.textContent = 'Syncing...'; btn.disabled = true; }
    function done() {
      if (btn) { btn.textContent = 'Sync Now'; btn.disabled = false; }
      loadPage('settings');
    }
    if (typeof DashboardPage !== 'undefined' && DashboardPage.syncNow) {
      try {
        var result = DashboardPage.syncNow();
        if (result && typeof result.then === 'function') { result.then(done).catch(done); } else { done(); }
      } catch(e) { done(); }
    } else if (typeof SupabaseDB !== 'undefined' && SupabaseDB.resync) {
      try {
        var r = SupabaseDB.resync();
        if (r && typeof r.then === 'function') { r.then(done).catch(done); } else { done(); }
      } catch(e) { done(); }
    } else {
      // Direct fetch fallback — sequential table sync
      var url = 'https://ltpivkqahvplapyagljt.supabase.co';
      var key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0cGl2a3FhaHZwbGFweWFnbGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTgxNzIsImV4cCI6MjA4OTY3NDE3Mn0.bQ-wAx4Uu-FyA2ZwsTVfFoU2ZPbeWCmupqV-6ZR9uFI';
      var tables = [
        {local:'bm-clients',remote:'clients'},{local:'bm-jobs',remote:'jobs'},
        {local:'bm-invoices',remote:'invoices'},{local:'bm-quotes',remote:'quotes'},
        {local:'bm-services',remote:'services'},{local:'bm-team',remote:'team_members'}
      ];
      var total = 0;
      var idx = 0;
      function fetchNext() {
        if (idx >= tables.length) {
          if (typeof UI !== 'undefined') UI.toast(total + ' records synced from cloud!');
          done();
          return;
        }
        var t = tables[idx++];
        fetch(url + '/rest/v1/' + t.remote + '?select=*&limit=5000&order=created_at.desc', {
          headers: {'apikey': key, 'Authorization': 'Bearer ' + key}
        }).then(function(resp) {
          return resp.json();
        }).then(function(data) {
          if (data && data.length) {
            var conv = data.map(function(row) {
              var n = {};
              Object.keys(row).forEach(function(k) {
                n[k.replace(/_([a-z])/g, function(m, p) { return p.toUpperCase(); })] = row[k];
              });
              return n;
            });
            localStorage.setItem(t.local, JSON.stringify(conv));
            total += conv.length;
          }
          fetchNext();
        }).catch(function() { fetchNext(); });
      }
      fetchNext();
    }
  },

  deduplicateTags: function() {
    var clients = JSON.parse(localStorage.getItem('bm-clients') || '[]');
    var fixed = 0;
    clients.forEach(function(c) {
      if (!c.tags || !c.tags.length) return;
      var seen = {};
      var uniq = c.tags.filter(function(t) {
        var k = (t || '').toLowerCase();
        return k && (seen[k] ? false : (seen[k] = true));
      });
      if (uniq.length < c.tags.length) { c.tags = uniq; fixed++; }
    });
    localStorage.setItem('bm-clients', JSON.stringify(clients));
    UI.toast('Fixed ' + fixed + ' client' + (fixed !== 1 ? 's' : '') + ' with duplicate tags');
    loadPage('settings');
  },

  _copyRlsSql: function() {
    var sql = '-- Safe to re-run: drops existing policies first\n'
      + 'DROP POLICY IF EXISTS "Anon read quotes" ON quotes;\n'
      + 'DROP POLICY IF EXISTS "Anon update quote status" ON quotes;\n'
      + 'DROP POLICY IF EXISTS "Anon read invoices" ON invoices;\n'
      + 'DROP POLICY IF EXISTS "Anon read clients" ON clients;\n'
      + 'DROP POLICY IF EXISTS "Anon insert requests" ON requests;\n\n'
      + 'CREATE POLICY "Anon read quotes" ON quotes FOR SELECT TO anon USING (status <> \'draft\');\n\n'
      + 'CREATE POLICY "Anon update quote status" ON quotes FOR UPDATE TO anon USING (status IN (\'sent\', \'awaiting\')) WITH CHECK (status IN (\'approved\', \'awaiting\'));\n\n'
      + 'CREATE POLICY "Anon read invoices" ON invoices FOR SELECT TO anon USING (status <> \'draft\');\n\n'
      + 'CREATE POLICY "Anon read clients" ON clients FOR SELECT TO anon USING (true);\n\n'
      + 'CREATE POLICY "Anon insert requests" ON requests FOR INSERT TO anon WITH CHECK (true);\n\n'
      + '-- Storage bucket for job photos\n'
      + 'INSERT INTO storage.buckets (id, name, public)\n'
      + 'VALUES (\'job-photos\', \'job-photos\', true)\n'
      + 'ON CONFLICT (id) DO NOTHING;\n\n'
      + '-- Allow public read of job photos\n'
      + 'DROP POLICY IF EXISTS "Public read job photos" ON storage.objects;\n'
      + 'CREATE POLICY "Public read job photos" ON storage.objects\n'
      + '  FOR SELECT USING (bucket_id = \'job-photos\');\n\n'
      + '-- Allow authenticated/anon insert to job-photos\n'
      + 'DROP POLICY IF EXISTS "Anon upload job photos" ON storage.objects;\n'
      + 'CREATE POLICY "Anon upload job photos" ON storage.objects\n'
      + '  FOR INSERT WITH CHECK (bucket_id = \'job-photos\');\n\n'
      + '-- Allow delete own photos\n'
      + 'DROP POLICY IF EXISTS "Anon delete job photos" ON storage.objects;\n'
      + 'CREATE POLICY "Anon delete job photos" ON storage.objects\n'
      + '  FOR DELETE USING (bucket_id = \'job-photos\');';
    navigator.clipboard.writeText(sql).then(function() { UI.toast('RLS SQL copied!'); });
  },

  _copyColumnSql: function() {
    var sql = 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_email TEXT;\n'
      + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_phone TEXT;\n'
      + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) DEFAULT 0;\n'
      + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_date DATE;\n'
      + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_payment_url TEXT;\n'
      + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link_sent TIMESTAMPTZ;\n'
      + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link_email TEXT;\n'
      + 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;\n'
      + 'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_email TEXT;\n'
      + 'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_phone TEXT;\n'
      + 'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoice_id TEXT;\n'
      + 'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_date DATE;\n'
      + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS client_email TEXT;\n'
      + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS client_phone TEXT;\n'
      + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS expires_at DATE;\n'
      + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN DEFAULT false;\n'
      + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_due DECIMAL(10,2) DEFAULT 0;\n'
      + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_paid BOOLEAN DEFAULT false;\n'
      + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;\n'
      + 'ALTER TABLE quotes ADD COLUMN IF NOT EXISTS client_changes TEXT;';
    navigator.clipboard.writeText(sql).then(function() { UI.toast('Column SQL copied!'); });
  },

  _copyExpensesSql: function() {
    var el = document.getElementById('expenses-sql-block');
    var sql = el ? el.textContent : '';
    navigator.clipboard.writeText(sql).then(function() { UI.toast('Expenses SQL copied — paste into Supabase SQL Editor!'); });
  },

  _testDialpad: function() {
    var key = (document.getElementById('dialpad-key') || {}).value;
    if (!key) key = localStorage.getItem('bm-dialpad-key') || '';
    key = (key || '').trim();
    var out = document.getElementById('dialpad-test-result');
    if (!key) {
      if (out) out.innerHTML = '<span style="color:#e07c24;">⚠️ Paste your Dialpad API token first.</span>';
      return;
    }
    if (out) out.innerHTML = '<span style="color:var(--text-light);">Pinging Dialpad…</span>';
    // Dialpad API: GET /api/v2/users/me — lightweight auth check
    fetch('https://dialpad.com/api/v2/users/me', {
      headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' }
    }).then(function(r) {
      if (r.status === 401 || r.status === 403) {
        if (out) out.innerHTML = '<span style="color:#c0392b;">❌ Invalid token (401/403). Regenerate at dialpad.com → API Keys.</span>';
        return null;
      }
      if (!r.ok) {
        if (out) out.innerHTML = '<span style="color:#c0392b;">❌ Dialpad returned ' + r.status + '. Check token + account status.</span>';
        return null;
      }
      return r.json();
    }).then(function(data) {
      if (!data) return;
      var name = (data.display_name || data.email || 'Dialpad user');
      if (out) out.innerHTML = '<span style="color:var(--green-dark);font-weight:600;">✅ Connected as ' + UI.esc(name) + '</span>';
    }).catch(function(e) {
      // Most common failure: CORS — Dialpad API doesn't allow browser calls from arbitrary origins.
      if (out) out.innerHTML = '<span style="color:#c0392b;">❌ ' + (e.message || 'Network error') + '<br><span style="font-size:11px;color:var(--text-light);">If this says "CORS" or "Failed to fetch", the call is blocked by Dialpad\'s browser policy. The token can still work from our server-side webhook — click Save Token and continue.</span></span>';
    });
  },

  _removeKey: function(storageKey, label) {
    var existing = localStorage.getItem(storageKey);
    if (!existing) {
      UI.toast(label + ' key was not set', 'error');
      return;
    }
    if (!confirm('Remove your ' + label + ' API key?\n\nYou can re-add it anytime.')) return;
    localStorage.removeItem(storageKey);
    // Also clear in-memory reference on the module
    if (storageKey === 'bm-sendgrid-key' && typeof Email !== 'undefined') Email.apiKey = null;
    if (storageKey === 'bm-claude-key' && typeof AI !== 'undefined') AI._apiKey = null;
    UI.toast(label + ' key removed ✓');
    loadPage('settings');
  },

  saveCompany: function() {
    var fields = ['name','phone','email','address','licenses','website'];
    fields.forEach(function(f) {
      var el = document.getElementById('co-' + f);
      if (el) localStorage.setItem('bm-co-' + f, el.value.trim());
    });
    var taxEl = document.getElementById('co-tax-rate');
    if (taxEl) localStorage.setItem('bm-tax-rate', parseFloat(taxEl.value) || 0);
    UI.toast('Company info saved ✅');
  },

  addService: function() {
    UI.showModal('Add Service / Product', '<form id="svc-form" onsubmit="SettingsPage._saveService(event, null)">'
      + UI.formField('Name *', 'text', 'svc-name', '', { placeholder: 'e.g. Tree Removal' })
      + UI.formField('Description', 'textarea', 'svc-desc', '', { placeholder: 'Short description shown on quotes' })
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Type</label>'
      + '<select id="svc-type" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;">'
      + '<option value="service">Service</option><option value="product">Product</option></select></div>'
      + UI.formField('Default Price ($)', 'number', 'svc-price', '', { placeholder: '0.00' })
      + '</div></form>', {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="SettingsPage._saveService(null, null)">Add</button>'
    });
  },

  editService: function(id) {
    var svc = DB.services.getAll().find(function(s) { return s.id === id; });
    if (!svc) return;
    UI.showModal('Edit Service', '<form id="svc-form">'
      + UI.formField('Name *', 'text', 'svc-name', svc.name)
      + UI.formField('Description', 'textarea', 'svc-desc', svc.description || '')
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Type</label>'
      + '<select id="svc-type" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;">'
      + '<option value="service"' + (svc.type !== 'product' ? ' selected' : '') + '>Service</option>'
      + '<option value="product"' + (svc.type === 'product' ? ' selected' : '') + '>Product</option></select></div>'
      + UI.formField('Default Price ($)', 'number', 'svc-price', svc.price || '')
      + '</div></form>', {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn" style="background:var(--red);color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;" onclick="DB.services.remove(\'' + id + '\');UI.closeModal();loadPage(\'settings\');">Delete</button>'
        + ' <button class="btn btn-primary" onclick="SettingsPage._saveService(null, \'' + id + '\')">Save</button>'
    });
  },

  _saveService: function(e, id) {
    if (e) e.preventDefault();
    var name = (document.getElementById('svc-name') || {}).value;
    if (!name || !name.trim()) { UI.toast('Name is required', 'error'); return; }
    var data = {
      name: name.trim(),
      description: ((document.getElementById('svc-desc') || {}).value || '').trim(),
      type: ((document.getElementById('svc-type') || {}).value) || 'service',
      price: parseFloat(((document.getElementById('svc-price') || {}).value) || 0) || 0
    };
    if (id) { DB.services.update(id, data); UI.toast('Service updated'); }
    else { DB.services.create(data); UI.toast('Service added'); }
    UI.closeModal();
    loadPage('settings');
  },

  showAuditLog: function() {
    var logs = DB.auditLog ? DB.auditLog.getRecent(50) : [];
    var html = '';
    if (logs.length === 0) {
      html = '<div style="text-align:center;padding:20px;color:var(--text-light);">No audit entries yet. Changes will be logged as you use the app.</div>';
    } else {
      html = '<div style="max-height:400px;overflow-y:auto;">'
        + '<table class="data-table" style="width:100%;font-size:12px;"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Table</th><th>Details</th></tr></thead><tbody>';
      logs.forEach(function(l) {
        var actionColor = l.action === 'create' ? '#16a34a' : l.action === 'delete' ? '#dc3545' : '#2563eb';
        html += '<tr>'
          + '<td style="white-space:nowrap;">' + new Date(l.ts).toLocaleString() + '</td>'
          + '<td>' + UI.esc(l.user || '—') + '</td>'
          + '<td><span style="color:' + actionColor + ';font-weight:600;">' + l.action + '</span></td>'
          + '<td>' + UI.esc(l.table || '') + '</td>'
          + '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">' + UI.esc(l.details || '') + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';
    }
    UI.showModal('Audit Log (last 50)', html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Close</button>'
        + (logs.length > 0 ? ' <button class="btn" style="background:var(--red);color:#fff;" onclick="if(confirm(\'Clear audit log?\')){DB.auditLog.clear();UI.closeModal();UI.toast(\'Audit log cleared\');}">Clear Log</button>' : '')
    });
  },

  changePassword: function() {
    var html = UI.field('Current Password', '<input type="password" id="pw-current" placeholder="Enter current password">')
      + UI.field('New Password', '<input type="password" id="pw-new" placeholder="Enter new password (8+ characters)">')
      + UI.field('Confirm New Password', '<input type="password" id="pw-confirm" placeholder="Confirm new password">');
    UI.showModal('Change Password', html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="SettingsPage._savePassword()">Update Password</button>'
    });
  },

  _savePassword: function() {
    var current = document.getElementById('pw-current').value;
    var newPw = document.getElementById('pw-new').value;
    var confirmPw = document.getElementById('pw-confirm').value;
    if (!current) { UI.toast('Enter your current password', 'error'); return; }
    if (newPw.length < 8) { UI.toast('Password must be at least 8 characters', 'error'); return; }
    if (newPw !== confirmPw) { UI.toast('Passwords do not match', 'error'); return; }

    // Verify current password
    var email = Auth.user ? Auth.user.email : '';
    var hashes = {};
    try { hashes = JSON.parse(localStorage.getItem('bm-auth-hashes') || '{}'); } catch(e) {}
    var storedHash = hashes[email.toLowerCase()];
    // Default users are a first-install fallback only; real accounts use hashes stored in localStorage.
    var defaultUsers = {};
    if (typeof BM_CONFIG !== 'undefined' && BM_CONFIG.email) {
      defaultUsers[BM_CONFIG.email.toLowerCase()] = '28006cfd';
    }
    var expectedHash = storedHash || defaultUsers[email.toLowerCase()];
    if (expectedHash && Auth._hash(current) !== expectedHash) {
      UI.toast('Current password is incorrect', 'error');
      return;
    }

    hashes[email.toLowerCase()] = Auth._hash(newPw);
    localStorage.setItem('bm-auth-hashes', JSON.stringify(hashes));
    UI.closeModal();
    UI.toast('Password updated!');
  },

  _saveWorkSettings: function() {
    localStorage.setItem('bm-work-start', document.getElementById('ws-start').value);
    localStorage.setItem('bm-work-end', document.getElementById('ws-end').value);
    localStorage.setItem('bm-ot-threshold', document.getElementById('ws-ot').value);
    localStorage.setItem('bm-pay-period', document.getElementById('ws-pay').value);
    localStorage.setItem('bm-min-job-hrs', document.getElementById('ws-min-job').value);
    localStorage.setItem('bm-crew-see-client', document.getElementById('ws-crew-client').checked ? 'true' : 'false');
    // Save per-day business hours
    ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].forEach(function(day) {
      var el = document.getElementById('bh-' + day);
      if (el) localStorage.setItem('bm-bh-' + day, el.value.trim());
    });
    UI.toast('Work settings saved');
  },

  _saveNotifSettings: function() {
    ['notif-quote-approved','notif-payment','notif-new-request','notif-overdue','notif-job-completed','notif-daily-summary'].forEach(function(id) {
      localStorage.setItem('bm-' + id, document.getElementById(id).checked ? 'true' : 'false');
    });
    UI.toast('Notification preferences saved');
  },

  _saveQuoteDefaults: function() {
    localStorage.setItem('bm-payment-terms', document.getElementById('qd-terms').value);
    localStorage.setItem('bm-default-deposit', document.getElementById('qd-deposit').value);
    localStorage.setItem('bm-quote-validity', document.getElementById('qd-validity').value);
    localStorage.setItem('bm-show-line-prices', document.getElementById('qd-show-prices').checked ? 'true' : 'false');
    UI.toast('Quote & invoice defaults saved');
  },

  _saveBookingSettings: function() {
    ['bf-enabled','bf-auto-response','bf-require-phone','bf-require-address','bf-show-services'].forEach(function(id) {
      localStorage.setItem('bm-booking-' + id.replace('bf-',''), document.getElementById(id).checked ? 'true' : 'false');
    });
    UI.toast('Booking settings saved');
  },

  _saveReviewSettings: function() {
    localStorage.setItem('bm-review-google-url', document.getElementById('rev-google-url').value.trim());
    localStorage.setItem('bm-review-send-after', document.getElementById('rev-send-after').value);
    localStorage.setItem('bm-review-delay', document.getElementById('rev-delay').value);
    localStorage.setItem('bm-review-auto', document.getElementById('rev-auto').checked ? 'true' : 'false');
    UI.toast('Review settings saved');
  },

  _saveLocationSettings: function() {
    localStorage.setItem('bm-gps-tracking', document.getElementById('loc-tracking').checked ? 'true' : 'false');
    localStorage.setItem('bm-gps-work-only', document.getElementById('loc-work-only').checked ? 'true' : 'false');
    localStorage.setItem('bm-geofence', document.getElementById('loc-geofence').checked ? 'true' : 'false');
    UI.toast('Location settings saved');
  }
};
