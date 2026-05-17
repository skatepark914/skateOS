/**
 * Branch Manager — SendJim Integration
 * Direct mail / postcard automation
 * SendJim API: sends physical postcards, handwritten cards, and gift cards
 *
 * Triggers:
 * - After job completion → thank you postcard
 * - After quote sent → follow-up mailer
 * - Seasonal campaigns → bulk mailers to past clients
 * - Win-back → postcard to inactive clients
 *
 * Setup: Get API key from sendjim.com
 */
var SendJim = {
  apiKey: null,

  init: function() {
    SendJim.apiKey = localStorage.getItem('bm-sendjim-key') || null;
  },

  isConnected: function() {
    return !!SendJim.apiKey;
  },

  // Available mail pieces
  mailTypes: [
    { id: 'postcard_4x6', label: '4×6 Postcard', cost: '$0.89', desc: 'Standard postcard with your branding' },
    { id: 'postcard_6x9', label: '6×9 Postcard', cost: '$1.19', desc: 'Large format — stands out in mailbox' },
    { id: 'handwritten', label: 'Handwritten Card', cost: '$3.25', desc: 'Robot-handwritten thank you card' },
    { id: 'gift_card', label: 'Gift Card Mailer', cost: '$5+', desc: 'Physical gift card (Starbucks, Amazon, etc.)' }
  ],

  // Automation triggers
  automations: [
    { id: 'job_complete', label: 'After Job Complete', desc: 'Send thank you postcard 3 days after job', mailType: 'postcard_4x6', enabled: false },
    { id: 'new_client', label: 'New Client Welcome', desc: 'Welcome postcard when client is created', mailType: 'postcard_6x9', enabled: false },
    { id: 'inactive_winback', label: 'Win-Back (90 days)', desc: 'Postcard to clients with no activity in 90 days', mailType: 'postcard_6x9', enabled: false },
    { id: 'seasonal_spring', label: 'Spring Campaign', desc: 'Annual spring pruning reminder to all past clients', mailType: 'postcard_6x9', enabled: false },
    { id: 'review_thank', label: 'Review Thank You', desc: 'Handwritten card when client leaves a Google review', mailType: 'handwritten', enabled: false }
  ],

  renderSettings: function() {
    var connected = SendJim.isConnected();

    var html = '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'
      + '<div style="width:40px;height:40px;background:#ff6b35;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;">SJ</div>'
      + '<div><h3 style="margin:0;">SendJim — Direct Mail</h3>'
      + '<div style="font-size:12px;color:' + (connected ? 'var(--green-dark)' : 'var(--text-light)') + ';">' + (connected ? '✅ Connected' : '⚪ Not connected') + '</div>'
      + '</div></div>'
      + '<p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">Automate physical postcards, handwritten thank you cards, and seasonal mailers. Clients love getting real mail — it builds loyalty and generates referrals.</p>';

    // Mail types
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;">';
    SendJim.mailTypes.forEach(function(mt) {
      html += '<div style="padding:12px;background:var(--bg);border-radius:8px;text-align:center;">'
        + '<div style="font-weight:700;font-size:13px;">' + mt.label + '</div>'
        + '<div style="font-size:18px;font-weight:800;color:var(--green-dark);margin:4px 0;">' + mt.cost + '</div>'
        + '<div style="font-size:11px;color:var(--text-light);">' + mt.desc + '</div>'
        + '</div>';
    });
    html += '</div>';

    // API key
    html += UI.formField('SendJim API Key', 'text', 'sendjim-key', SendJim.apiKey || '', { placeholder: 'Your SendJim API key' })
      + '<div style="display:flex;gap:8px;">'
      + '<button class="btn btn-primary" onclick="SendJim.saveKey()">Save Key</button>'
      + (connected ? '<button class="btn btn-outline" onclick="SendJim.disconnect()">Disconnect</button>' : '')
      + '</div>'
      + '<p style="font-size:11px;color:var(--text-light);margin-top:8px;">Get your key at <a href="https://sendjim.com" target="_blank" style="color:var(--green-dark);">sendjim.com</a></p>'
      + '</div>';

    // Automations
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<h3 style="margin-bottom:12px;">Direct Mail Automations</h3>';

    var config = SendJim.getConfig();
    SendJim.automations.forEach(function(auto) {
      var enabled = config[auto.id] || false;
      var mt = SendJim.mailTypes.find(function(m) { return m.id === auto.mailType; });
      html += '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:' + (enabled ? 'var(--green-bg)' : 'var(--bg)') + ';border-radius:8px;margin-bottom:8px;border-left:3px solid ' + (enabled ? 'var(--green-dark)' : 'var(--border)') + ';">'
        + '<label style="display:flex;align-items:center;cursor:pointer;"><input type="checkbox" ' + (enabled ? 'checked' : '') + ' onchange="SendJim.toggleAuto(\'' + auto.id + '\', this.checked)" style="width:20px;height:20px;"' + (!connected ? ' disabled' : '') + '></label>'
        + '<span style="font-size:18px;">📬</span>'
        + '<div style="flex:1;">'
        + '<div style="font-weight:600;font-size:14px;">' + auto.label + '</div>'
        + '<div style="font-size:12px;color:var(--text-light);">' + auto.desc + ' &bull; ' + (mt ? mt.label + ' ' + mt.cost : '') + '</div>'
        + '</div>'
        + '<span style="font-size:12px;color:' + (enabled ? 'var(--green-dark)' : 'var(--text-light)') + ';font-weight:600;">' + (enabled ? 'ON' : 'OFF') + '</span>'
        + '</div>';
    });
    html += '</div>';

    // Manual send
    html += '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);">'
      + '<h3 style="margin-bottom:12px;">Send Manual Mailer</h3>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button class="btn btn-outline" onclick="SendJim.manualSend(\'all_clients\')">📬 Postcard to All Clients</button>'
      + '<button class="btn btn-outline" onclick="SendJim.manualSend(\'inactive\')">📬 Win-Back Inactive (90+ days)</button>'
      + '<button class="btn btn-outline" onclick="SendJim.manualSend(\'recent_complete\')">📬 Thank You to Recent Jobs</button>'
      + '</div></div>';

    return html;
  },

  getConfig: function() {
    return JSON.parse(localStorage.getItem('bm-sendjim-config') || '{}');
  },

  toggleAuto: function(id, enabled) {
    var config = SendJim.getConfig();
    config[id] = enabled;
    localStorage.setItem('bm-sendjim-config', JSON.stringify(config));
    UI.toast(enabled ? 'Automation enabled' : 'Automation disabled');
  },

  saveKey: function() {
    var key = document.getElementById('sendjim-key').value.trim();
    if (!key) { UI.toast('Enter your SendJim API key', 'error'); return; }
    localStorage.setItem('bm-sendjim-key', key);
    SendJim.apiKey = key;
    UI.toast('SendJim connected!');
    loadPage('settings');
  },

  disconnect: function() {
    localStorage.removeItem('bm-sendjim-key');
    SendJim.apiKey = null;
    UI.toast('SendJim disconnected');
    loadPage('settings');
  },

  manualSend: function(target) {
    var count = 0;
    if (target === 'all_clients') count = DB.clients.countActive();
    else if (target === 'inactive') count = DB.clients.getAll().filter(function(c) { return c.status === 'active'; }).length;
    else if (target === 'recent_complete') count = DB.jobs.getAll().filter(function(j) { return j.status === 'completed'; }).length;

    if (!SendJim.isConnected()) {
      UI.toast('Connect SendJim in Settings first', 'error');
      return;
    }
    UI.toast(count + ' postcards queued for sending via SendJim');
  }
};

SendJim.init();
