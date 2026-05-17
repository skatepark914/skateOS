/**
 * Branch Manager — Email Sending
 * Uses Supabase Edge Function to send via SendGrid
 * Falls back to mailto: links when not configured
 *
 * To enable: Set SendGrid API key in Settings
 * Free tier: 100 emails/day
 */
var Email = {
  apiKey: null,

  init: function() {
    Email.apiKey = localStorage.getItem('bm-sendgrid-key') || null;
  },

  isConfigured: function() {
    return !!Email.apiKey;
  },

  // Send email via SendGrid (through Supabase Edge Function or direct)
  send: async function(to, subject, body, options) {
    options = options || {};

    if (!Email.isConfigured()) {
      // Fallback: open mailto
      var mailtoUrl = 'mailto:' + encodeURIComponent(to)
        + '?subject=' + encodeURIComponent(subject)
        + '&body=' + encodeURIComponent(body);
      window.open(mailtoUrl);
      UI.toast('Opening email client (SendGrid not configured)');
      return { success: true, method: 'mailto' };
    }

    try {
      // Send via Supabase Edge Function (avoids CORS) → forwards to SendGrid
      var SUPA_URL = 'https://ltpivkqahvplapyagljt.supabase.co';
      var response = await fetch(SUPA_URL + '/functions/v1/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to,
          subject: subject,
          text: body,
          html: options.htmlBody || Email.htmlWrap(body),
          apiKey: Email.apiKey
        })
      });

      if (response.ok || response.status === 202) {
        UI.toast('Email sent to ' + to);
        return { success: true, method: 'sendgrid' };
      } else {
        var errText = await response.text();
        console.warn('SendGrid error:', errText);
        UI.toast('Email failed — opening mail app instead', 'error');
        // Fallback to mailto
        window.open('mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body));
        return { success: false, method: 'mailto_fallback', error: errText };
      }
    } catch (e) {
      console.warn('Email send error:', e);
      // Fallback
      window.open('mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body));
      return { success: false, method: 'mailto_fallback', error: e.message };
    }
  },

  // Send a template email to a client
  sendTemplate: function(templateKey, clientData) {
    var t = Templates.library[templateKey];
    if (!t) { UI.toast('Template not found', 'error'); return; }
    if (!clientData.email) { UI.toast('No email on file for ' + (clientData.name || 'this client'), 'error'); return; }

    var subject = t.subject ? Templates.fill(t.subject, clientData) : BM_CONFIG.companyName;
    var body = Templates.fill(t.body, clientData);

    Email.send(clientData.email, subject, body);

    // Log the communication
    if (clientData.id && typeof CommsLog !== 'undefined') {
      var key = 'bm-comms-' + clientData.id;
      var all = [];
      try { all = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
      all.unshift({
        id: Date.now().toString(36),
        clientId: clientData.id,
        type: 'email',
        direction: 'outbound',
        notes: 'Sent: ' + (t.name || templateKey) + ' — ' + subject,
        date: new Date().toISOString(),
        user: 'Doug'
      });
      localStorage.setItem(key, JSON.stringify(all));
    }
  },

  // Generate branded HTML email
  htmlWrap: function(bodyText) {
    // Convert plain text to HTML: escape special chars, make URLs clickable, preserve line breaks
    var htmlBody = bodyText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Make URLs clickable (http/https)
      .replace(/(https?:\/\/[^\s\n<]+)/g, '<a href="$1" style="color:#00836c;font-weight:600;">$1</a>')
      // Preserve line breaks
      .replace(/\n\n/g, '</p><p style="margin:0 0 12px;">')
      .replace(/\n/g, '<br>');

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
      + '<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,sans-serif;">'
      + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">'
      + '<tr><td align="center">'
      + '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">'
      // Header
      + '<tr><td style="background:#1a3c12;padding:24px 32px;">'
      + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
      + '<td><div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-.3px;">🌳 ' + BM_CONFIG.companyName + '</div>'
      + '<div style="font-size:12px;color:#a8d5a2;margin-top:3px;">' + BM_CONFIG.tagline + '</div></td>'
      + '</tr></table></td></tr>'
      // Body
      + '<tr><td style="padding:32px;font-size:15px;line-height:1.7;color:#333333;">'
      + '<p style="margin:0 0 12px;">' + htmlBody + '</p>'
      + '</td></tr>'
      // Footer
      + '<tr><td style="background:#f8f8f8;padding:20px 32px;border-top:1px solid #e8e8e8;text-align:center;">'
      + '<div style="font-size:13px;color:#888;line-height:1.6;">'
      + '<strong style="color:#555;">' + BM_CONFIG.companyName + '</strong><br>'
      + '<a href="tel:' + BM_CONFIG.phoneDigits + '" style="color:#00836c;text-decoration:none;">' + BM_CONFIG.phone + '</a> &nbsp;·&nbsp; '
      + '<a href="mailto:' + BM_CONFIG.email + '" style="color:#00836c;text-decoration:none;">' + BM_CONFIG.email + '</a> &nbsp;·&nbsp; '
      + '<a href="' + BM_CONFIG.websiteUrl + '" style="color:#00836c;text-decoration:none;">' + BM_CONFIG.website + '</a>'
      + '</div>'
      + '<div style="font-size:11px;color:#aaa;margin-top:8px;">You received this because you contacted ' + BM_CONFIG.companyName + '.</div>'
      + '</td></tr>'
      + '</table>'
      + '</td></tr></table>'
      + '</body></html>';
  },

  // Settings UI
  renderSettings: function() {
    var configured = Email.isConfigured();
    return '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'
      + '<div style="width:40px;height:40px;background:#1a82e2;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;">SG</div>'
      + '<div><h3 style="margin:0;">SendGrid Email</h3>'
      + '<div style="font-size:12px;color:' + (configured ? 'var(--green-dark)' : 'var(--text-light)') + ';">' + (configured ? '✅ Connected' : '⚪ Not connected — emails open in mail app') + '</div>'
      + '</div></div>'
      + '<p style="font-size:13px;color:var(--text-light);margin-bottom:12px;">Send automated emails directly from Branch Manager. Free: 100 emails/day.</p>'
      + '<div style="margin-bottom:8px;"><input type="text" id="sendgrid-key" value="' + (Email.apiKey || '') + '" placeholder="SG.xxxxxxx..." style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '<div style="display:flex;gap:8px;">'
      + '<button onclick="Email.saveKey()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;">Save Key</button>'
      + (configured ? '<button onclick="Email.testSend()" style="background:#1a82e2;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;">Test Send</button>' : '')
      + '</div>'
      + '<p style="font-size:11px;color:var(--text-light);margin-top:8px;">Get your key at <a href="https://app.sendgrid.com/settings/api_keys" target="_blank" style="color:var(--green-dark);">app.sendgrid.com</a>. Create key with "Mail Send" permission.</p>'
      + '</div>';
  },

  saveKey: function() {
    var key = document.getElementById('sendgrid-key').value.trim();
    if (!key) { UI.toast('Enter a SendGrid API key', 'error'); return; }
    localStorage.setItem('bm-sendgrid-key', key);
    Email.apiKey = key;
    UI.toast('SendGrid connected!');
    loadPage('settings');
  },

  testSend: function() {
    Email.send(BM_CONFIG.email, 'Branch Manager Test Email',
      'This is a test email from Branch Manager.\n\nIf you received this, email sending is working!\n\n— Branch Manager');
  }
};

Email.init();
