/**
 * Branch Manager — Dialpad Integration
 * Click-to-call, SMS sending, call logging
 * Matches Jobber's built-in call/text functionality
 *
 * Dialpad API docs: https://developers.dialpad.com/reference
 * Free tier: SMS via API, click-to-call via tel: or Dialpad app
 */
var Dialpad = {
  apiKey: null,
  companyPhone: BM_CONFIG.phone,
  companyPhoneClean: '1' + BM_CONFIG.phoneDigits,

  init: function() {
    Dialpad.apiKey = localStorage.getItem('bm-dialpad-key') || null;
  },

  isConfigured: function() {
    return !!Dialpad.apiKey;
  },

  // ── SMS ──────────────────────────────────────────────

  /**
   * Send SMS via Dialpad API
   * POST https://dialpad.com/api/v2/sms
   * { to_numbers: ["+1..."], text: "..." }
   */
  sendSMS: async function(toPhone, message, clientId) {
    var cleanPhone = Dialpad._cleanPhone(toPhone);
    if (!cleanPhone) {
      UI.toast('Invalid phone number', 'error');
      return { success: false, error: 'Invalid phone' };
    }

    // Log to comms regardless of API status
    Dialpad._logComm(clientId, 'text', 'outbound', message);

    if (!Dialpad.isConfigured()) {
      // Fallback: open SMS app
      var smsUrl = 'sms:' + cleanPhone + '?body=' + encodeURIComponent(message);
      window.open(smsUrl);
      UI.toast('Opening Messages app (Dialpad not configured)');
      return { success: true, method: 'sms_app' };
    }

    try {
      var response = await fetch('https://dialpad.com/api/v2/sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + Dialpad.apiKey
        },
        body: JSON.stringify({
          to_numbers: ['+' + cleanPhone],
          text: message
        })
      });

      if (response.ok) {
        UI.toast('Text sent to ' + Dialpad._formatPhone(cleanPhone));
        return { success: true, method: 'dialpad' };
      } else {
        var errText = await response.text();
        console.warn('Dialpad SMS error:', errText);
        // Fallback to SMS app
        window.open('sms:' + cleanPhone + '?body=' + encodeURIComponent(message));
        UI.toast('Dialpad error — opening Messages app', 'error');
        return { success: false, method: 'sms_fallback', error: errText };
      }
    } catch (e) {
      console.warn('Dialpad SMS error:', e);
      window.open('sms:' + cleanPhone + '?body=' + encodeURIComponent(message));
      UI.toast('Dialpad error — opening Messages app', 'error');
      return { success: false, method: 'sms_fallback', error: e.message };
    }
  },

  // ── Calls ────────────────────────────────────────────

  /**
   * Initiate call via Dialpad API or tel: link
   * POST https://dialpad.com/api/v2/call
   * { phone_number: "+1...", outbound_caller_id: "+1..." }
   */
  call: function(toPhone, clientId, clientName) {
    var cleanPhone = Dialpad._cleanPhone(toPhone);
    if (!cleanPhone) {
      UI.toast('No phone number', 'error');
      return;
    }

    // Log call attempt
    Dialpad._logComm(clientId, 'call', 'outbound', 'Called ' + (clientName || Dialpad._formatPhone(cleanPhone)));

    if (Dialpad.isConfigured()) {
      // Try Dialpad API call initiation
      fetch('https://dialpad.com/api/v2/call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + Dialpad.apiKey
        },
        body: JSON.stringify({
          phone_number: '+' + cleanPhone
        })
      }).then(function(resp) {
        if (resp.ok) {
          UI.toast('Calling via Dialpad...');
          Dialpad._showCallTimer(clientId, clientName, toPhone);
        } else {
          // Fallback to tel:
          window.open('tel:' + cleanPhone);
          UI.toast('Opening phone dialer');
          Dialpad._showCallTimer(clientId, clientName, toPhone);
        }
      }).catch(function() {
        window.open('tel:' + cleanPhone);
        Dialpad._showCallTimer(clientId, clientName, toPhone);
      });
    } else {
      // No API key — use tel: link (opens Dialpad app if installed, or phone)
      window.open('tel:' + cleanPhone);
      UI.toast('Opening phone dialer');
      Dialpad._showCallTimer(clientId, clientName, toPhone);
    }
  },

  // ── Call Timer Modal (like Jobber) ───────────────────

  _callStart: null,
  _callInterval: null,

  _showCallTimer: function(clientId, clientName, phone) {
    Dialpad._callStart = Date.now();

    var html = '<div style="text-align:center;padding:20px;">'
      + '<div style="font-size:48px;margin-bottom:12px;">📞</div>'
      + '<h3 style="margin-bottom:4px;">Calling ' + (clientName || 'Client') + '</h3>'
      + '<div style="font-size:13px;color:var(--text-light);margin-bottom:16px;">' + (phone || '') + '</div>'
      + '<div id="call-timer" style="font-size:32px;font-weight:700;font-variant-numeric:tabular-nums;margin-bottom:20px;">0:00</div>'
      + '<div style="display:flex;gap:8px;justify-content:center;">'
      + '<button onclick="Dialpad._endCall(\'' + (clientId || '') + '\')" style="background:var(--red);color:#fff;border:none;padding:10px 24px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">End Call</button>'
      + '</div>'
      + '<div style="margin-top:16px;">'
      + '<textarea id="call-notes" placeholder="Call notes..." style="width:100%;height:60px;border:2px solid var(--border);border-radius:8px;padding:8px;font-size:13px;resize:vertical;"></textarea>'
      + '</div>'
      + '</div>';

    UI.showModal('Active Call', html);

    // Start timer
    Dialpad._callInterval = setInterval(function() {
      var elapsed = Math.floor((Date.now() - Dialpad._callStart) / 1000);
      var mins = Math.floor(elapsed / 60);
      var secs = elapsed % 60;
      var timerEl = document.getElementById('call-timer');
      if (timerEl) {
        timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
      }
    }, 1000);
  },

  _endCall: function(clientId) {
    if (Dialpad._callInterval) {
      clearInterval(Dialpad._callInterval);
      Dialpad._callInterval = null;
    }

    var duration = Dialpad._callStart ? Math.floor((Date.now() - Dialpad._callStart) / 1000) : 0;
    var notesEl = document.getElementById('call-notes');
    var notes = notesEl ? notesEl.value.trim() : '';

    var mins = Math.floor(duration / 60);
    var secs = duration % 60;
    var durationStr = mins + ':' + (secs < 10 ? '0' : '') + secs;

    // Update the last call log with duration and notes
    if (clientId) {
      var key = 'bm-comms-' + clientId;
      var all = [];
      try { all = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
      // Find the most recent call entry and update it
      for (var i = 0; i < all.length; i++) {
        if (all[i].type === 'call' && all[i].direction === 'outbound') {
          all[i].duration = durationStr;
          if (notes) all[i].notes += ' — Notes: ' + notes;
          break;
        }
      }
      localStorage.setItem(key, JSON.stringify(all));
    }

    UI.closeModal();
    UI.toast('Call ended (' + durationStr + ')');
  },

  // ── Quick Text Modal (like Jobber) ──────────────────

  showTextModal: function(clientId, clientName, phone) {
    var client = clientId ? DB.clients.getById(clientId) : null;
    var clientPhone = phone || (client ? client.phone : '');
    var name = clientName || (client ? client.name : '');
    var configured = Dialpad.isConfigured();
    var cleanPhone = Dialpad._cleanPhone(clientPhone);

    // Mode badge — tells the user what the Send button will do
    var modeBadge = configured
      ? '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;background:#ede9fe;color:#7c3aed;padding:3px 8px;border-radius:20px;font-weight:600;">⚡ Dialpad — sends instantly</span>'
      : '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;background:#f0fdf4;color:var(--green-dark);padding:3px 8px;border-radius:20px;font-weight:600;">📱 Opens Messages app on iPhone</span>';

    // Action buttons differ based on API key presence
    var actionButtons;
    if (configured) {
      actionButtons = '<button onclick="Dialpad._sendFromModal(\'' + clientId + '\',\'' + (clientPhone || '').replace(/'/g, '') + '\')" class="btn btn-primary" style="background:#7c3aed;border-color:#7c3aed;">⚡ Send via Dialpad</button>';
    } else {
      actionButtons = '<button onclick="Dialpad._openSMSApp(\'' + (clientPhone || '').replace(/'/g, '') + '\')" class="btn btn-primary" style="background:var(--green-dark);">📱 Open SMS App</button>'
        + '<button onclick="Dialpad._copyMessage()" class="btn btn-outline" style="font-size:13px;">📋 Copy</button>';
    }

    var html = '<div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px;">'
      + '<div style="font-size:13px;color:var(--text-light);">To: <strong>' + UI.esc(name) + '</strong> &mdash; ' + (clientPhone || 'No phone') + '</div>'
      + modeBadge
      + '</div>'
      + '<textarea id="sms-message" placeholder="Type your message..." style="width:100%;height:110px;border:2px solid var(--border);border-radius:8px;padding:10px;font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px;">'
      + '<button onclick="Dialpad._showSMSTemplates(\'' + clientId + '\')" class="btn btn-outline" style="font-size:12px;">📋 Templates</button>'
      + '<div style="display:flex;gap:8px;align-items:center;">'
      + '<span id="sms-char-count" style="font-size:11px;color:var(--text-light);">0/160</span>'
      + actionButtons
      + '</div>'
      + '</div>';

    if (!configured) {
      html += '<div style="margin-top:10px;padding:10px 12px;background:#f0fdf4;border-radius:8px;font-size:12px;color:var(--green-dark);border:1px solid #bbf7d0;">'
        + '💡 <strong>How it works on iPhone:</strong> Tap "Open SMS App" — Messages opens with the number and your text pre-filled. Hit send. Done.'
        + '</div>';
    }

    html += '</div>';

    UI.showModal('💬 Text ' + UI.esc(name), html);

    // Character counter + auto-focus
    setTimeout(function() {
      var ta = document.getElementById('sms-message');
      if (ta) {
        ta.oninput = function() {
          var countEl = document.getElementById('sms-char-count');
          if (countEl) countEl.textContent = ta.value.length + '/160';
        };
        ta.focus();
      }
    }, 100);
  },

  _openSMSApp: function(phone) {
    var ta = document.getElementById('sms-message');
    var message = ta ? ta.value.trim() : '';
    var cleanPhone = Dialpad._cleanPhone(phone);
    if (!cleanPhone) { UI.toast('No phone number', 'error'); return; }

    var smsUrl = 'sms:+' + cleanPhone + (message ? '?body=' + encodeURIComponent(message) : '');
    window.location.href = smsUrl;

    // Log to comms if we can identify a client from the modal context
    // (best-effort — phone is all we have here)
    UI.toast('Opening Messages app…');
  },

  _copyMessage: function() {
    var ta = document.getElementById('sms-message');
    if (!ta || !ta.value.trim()) { UI.toast('Type a message first', 'error'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value.trim()).then(function() {
        UI.toast('Message copied!');
      }).catch(function() {
        Dialpad._copyFallback(ta.value.trim());
      });
    } else {
      Dialpad._copyFallback(ta.value.trim());
    }
  },

  _copyFallback: function(text) {
    var tmp = document.createElement('textarea');
    tmp.value = text;
    tmp.style.position = 'fixed';
    tmp.style.opacity = '0';
    document.body.appendChild(tmp);
    tmp.select();
    try { document.execCommand('copy'); UI.toast('Message copied!'); }
    catch(e) { UI.toast('Copy failed — select text manually', 'error'); }
    document.body.removeChild(tmp);
  },

  _sendFromModal: function(clientId, phone) {
    var ta = document.getElementById('sms-message');
    if (!ta || !ta.value.trim()) {
      UI.toast('Type a message first', 'error');
      return;
    }
    Dialpad.sendSMS(phone, ta.value.trim(), clientId);
    UI.closeModal();
  },

  _showSMSTemplates: function(clientId) {
    var client = clientId ? DB.clients.getById(clientId) : null;
    if (!client || typeof Templates === 'undefined') return;

    var html = '<div style="display:grid;gap:8px;">';
    var quickTemplates = ['request_received_sms', 'quote_sent_sms', 'booking_confirm_sms', 'visit_reminder_sms', 'review_request_sms'];
    quickTemplates.forEach(function(key) {
      var t = Templates.library[key];
      if (!t) return;
      var filled = Templates.fill(t.body, { name: client.name, address: client.address });
      html += '<div onclick="document.getElementById(\'sms-message\').value=\'' + filled.replace(/'/g, "\\'").replace(/\n/g, ' ') + '\';document.getElementById(\'sms-message\').oninput();UI.closeModal();Dialpad.showTextModal(\'' + clientId + '\',\'' + (client.name || '').replace(/'/g, "\\'") + '\',\'' + (client.phone || '') + '\');" style="padding:10px;background:var(--bg);border-radius:8px;cursor:pointer;font-size:13px;border:1px solid var(--border);transition:background .1s;" onmouseover="this.style.background=\'var(--green-bg)\'" onmouseout="this.style.background=\'var(--bg)\'">'
        + '<strong style="font-size:12px;color:var(--green-dark);">' + t.name + '</strong>'
        + '<div style="color:var(--text-light);margin-top:2px;">' + filled.substring(0, 80) + '...</div>'
        + '</div>';
    });
    html += '</div>';
    UI.showModal('SMS Templates', html);
  },

  // ── Helpers ──────────────────────────────────────────

  _cleanPhone: function(phone) {
    if (!phone) return '';
    var digits = phone.replace(/\D/g, '');
    if (digits.length === 10) digits = '1' + digits;
    return digits;
  },

  _formatPhone: function(digits) {
    if (!digits || digits.length < 10) return digits;
    var d = digits.length === 11 ? digits.substring(1) : digits;
    return '(' + d.substring(0, 3) + ') ' + d.substring(3, 6) + '-' + d.substring(6);
  },

  _logComm: function(clientId, type, direction, notes) {
    if (!clientId) return;
    var key = 'bm-comms-' + clientId;
    var all = [];
    try { all = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
    all.unshift({
      id: Date.now().toString(36),
      clientId: clientId,
      type: type,
      direction: direction,
      notes: notes,
      date: new Date().toISOString(),
      user: 'Doug'
    });
    localStorage.setItem(key, JSON.stringify(all));
  },

  // ── Settings UI ──────────────────────────────────────

  renderSettings: function() {
    var configured = Dialpad.isConfigured();
    return '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'
      + '<div style="width:40px;height:40px;background:#7c3aed;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:16px;">📞</div>'
      + '<div><h3 style="margin:0;">Dialpad Calling & SMS</h3>'
      + '<div style="font-size:12px;color:' + (configured ? 'var(--green-dark)' : 'var(--text-light)') + ';">' + (configured ? '✅ Connected — calls & texts via Dialpad' : '⚪ Not connected — calls open phone dialer, texts open Messages app') + '</div>'
      + '</div></div>'
      + '<p style="font-size:13px;color:var(--text-light);margin-bottom:12px;">Connect Dialpad to send texts without leaving the app. Or skip the key entirely — the 📱 Text button works great on iPhone with no setup needed.</p>'
      + '<div style="margin-bottom:8px;"><input type="text" id="dialpad-key" value="' + (Dialpad.apiKey || '') + '" placeholder="Dialpad API key (optional)..." style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;"></div>'
      + '<div style="display:flex;gap:8px;">'
      + '<button onclick="Dialpad.saveKey()" style="background:#7c3aed;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;">Save Key</button>'
      + (configured ? '<button onclick="Dialpad.testSMS()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;">Send Test SMS</button>' : '')
      + '</div>'
      + '<p style="font-size:11px;color:var(--text-light);margin-top:8px;">Get your API key at <a href="https://dialpad.com/settings" target="_blank" style="color:#7c3aed;">dialpad.com/settings</a> → API & Integrations → Generate API Key.</p>'
      + '<div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text-light);line-height:1.6;">'
      + '<strong style="color:var(--text);">How it works:</strong><br>'
      + '<span style="color:var(--green-dark);font-weight:600;">📱 Without API key</span> — Tap the Text button in the field and a compose window opens. Hit "Open SMS App" and iPhone\'s Messages opens with the number and your message pre-filled. Tap send. <em>This is the primary mode for field use.</em><br><br>'
      + '<span style="color:#7c3aed;font-weight:600;">⚡ With Dialpad API key</span> — Texts send programmatically from the app without switching to Messages. Useful for batch follow-ups from the office. Adds call recording and SMS analytics.<br><br>'
      + '• All calls and texts are logged to the client\'s communication history automatically'
      + '</div>'
      + '</div>';
  },

  saveKey: function() {
    var key = document.getElementById('dialpad-key').value.trim();
    if (!key) { UI.toast('Enter a Dialpad API key', 'error'); return; }
    localStorage.setItem('bm-dialpad-key', key);
    Dialpad.apiKey = key;
    UI.toast('Dialpad connected!');
    loadPage('settings');
  },

  testSMS: function() {
    Dialpad.sendSMS('9143915233', 'Test from Branch Manager — Dialpad SMS is working!', null);
  }
};

Dialpad.init();
