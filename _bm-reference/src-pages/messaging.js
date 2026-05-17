/**
 * Branch Manager — Messaging Center
 * Send/view SMS and email conversations per client
 * Ready for Dialpad API when SMS is registered
 */
var MessagingPage = {
  _selected: null,
  _msgType: 'text',

  _co: function() {
    return {
      name: localStorage.getItem('bm-co-name') || BM_CONFIG.companyName,
      phone: localStorage.getItem('bm-co-phone') || BM_CONFIG.phone,
      email: localStorage.getItem('bm-co-email') || BM_CONFIG.email,
      website: localStorage.getItem('bm-co-website') || BM_CONFIG.website
    };
  },

  render: function() {
    var clients = DB.clients.getAll().filter(function(c) { return c.phone || c.email; }).slice(0, 50);
    var selectedId = MessagingPage._selected || null;

    // Read unread counts
    var unread = {};
    try { unread = JSON.parse(localStorage.getItem('bm-msg-unread') || '{}'); } catch(e) {}

    // Stats bar
    var allClients = DB.clients.getAll();
    var weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    var msgsThisWeek = 0;
    var openConvos = 0;
    allClients.forEach(function(c) {
      var comms = CommsLog ? CommsLog.getAll(c.id) : [];
      var recent = comms.filter(function(m) { return new Date(m.date) >= weekAgo; });
      if (recent.length) {
        msgsThisWeek += recent.length;
        openConvos++;
      }
    });

    var html = '<div style="background:var(--white);border-radius:10px;border:1px solid var(--border);padding:10px 16px;margin-bottom:12px;display:flex;gap:24px;align-items:center;">'
      + '<div style="font-size:13px;"><span style="font-weight:700;color:var(--green-dark);">' + allClients.length + '</span> <span style="color:var(--text-light);">Total Clients</span></div>'
      + '<div style="font-size:13px;"><span style="font-weight:700;color:var(--green-dark);">' + msgsThisWeek + '</span> <span style="color:var(--text-light);">Messages This Week</span></div>'
      + '<div style="font-size:13px;"><span style="font-weight:700;color:var(--green-dark);">' + openConvos + '</span> <span style="color:var(--text-light);">Active Conversations</span></div>'
      + '</div>';

    html += '<div style="display:grid;grid-template-columns:280px 1fr;gap:0;height:calc(100vh - 200px);background:var(--white);border-radius:12px;border:1px solid var(--border);overflow:hidden;">';

    // Left: Contact list
    html += '<div style="border-right:1px solid var(--border);overflow-y:auto;display:flex;flex-direction:column;">'
      + '<div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:center;">'
      + '<input type="text" placeholder="Search contacts..." oninput="MessagingPage.filterContacts(this.value)" style="flex:1;padding:8px 10px;border:2px solid var(--border);border-radius:8px;font-size:13px;">'
      + '<button onclick="MessagingPage.newMessage()" style="background:var(--green-dark);color:#fff;border:none;padding:8px 10px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">+ New</button>'
      + '</div><div id="msg-contacts" style="flex:1;overflow-y:auto;">';

    clients.forEach(function(c) {
      var isActive = c.id === selectedId;
      var lastComm = CommsLog ? CommsLog.getAll(c.id)[0] : null;
      var preview = lastComm ? lastComm.notes.substring(0, 40) + '...' : 'No messages';
      var time = lastComm ? UI.dateRelative(lastComm.date) : '';
      var unreadCount = unread[c.id] || 0;

      html += '<div onclick="MessagingPage.selectClient(\'' + c.id + '\')" style="padding:12px;border-bottom:1px solid #f0f0f0;cursor:pointer;background:' + (isActive ? 'var(--green-bg)' : 'var(--white)') + ';transition:background .1s;" onmouseover="this.style.background=\'' + (isActive ? 'var(--green-bg)' : '#fafafa') + '\'" onmouseout="this.style.background=\'' + (isActive ? 'var(--green-bg)' : 'var(--white)') + '\'">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;">'
        + '<strong style="font-size:13px;">' + c.name + '</strong>'
        + '<div style="display:flex;gap:5px;align-items:center;">'
        + (unreadCount > 0 ? '<span style="background:var(--red);color:#fff;border-radius:10px;font-size:10px;padding:2px 6px;font-weight:700;">' + unreadCount + '</span>' : '')
        + '<span style="font-size:10px;color:var(--text-light);">' + time + '</span>'
        + '</div></div>'
        + '<div style="font-size:12px;color:var(--text-light);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + preview + '</div>'
        + '</div>';
    });
    html += '</div></div>';

    // Right: Conversation
    html += '<div style="display:flex;flex-direction:column;">';
    if (selectedId) {
      var client = DB.clients.getById(selectedId);
      var comms = CommsLog ? CommsLog.getAll(selectedId) : [];

      // Header
      html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">'
        + '<div><strong style="font-size:15px;">' + (client ? client.name : '') + '</strong>'
        + '<div style="font-size:12px;color:var(--text-light);">' + (client ? client.phone || client.email || '' : '') + '</div></div>'
        + '<div style="display:flex;gap:6px;">'
        + '<button onclick="Dialpad.call(\'' + (client ? (client.phone || '') : '') + '\',\'' + selectedId + '\',\'' + (client ? (client.name || '').replace(/'/g, "\\'") : '') + '\')" style="background:var(--green-bg);border:1px solid #c8e6c9;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;font-weight:600;color:var(--green-dark);">📞 Call</button>'
        + '<button onclick="Dialpad.showTextModal(\'' + selectedId + '\',\'' + (client ? (client.name || '').replace(/'/g, "\\'") : '') + '\',\'' + (client ? (client.phone || '') : '') + '\')" style="background:#e8f5e9;border:1px solid #c8e6c9;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;font-weight:600;color:var(--green-dark);">💬 Text</button>'
        + '<button onclick="MessagingPage.showTemplates(\'' + selectedId + '\')" style="background:#e3f2fd;border:1px solid #bbdefb;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;font-weight:600;color:#1565c0;">📋 Templates</button>'
        + '</div></div>';

      // Messages
      html += '<div id="msg-thread" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;">';
      if (comms.length) {
        comms.slice().reverse().forEach(function(m) {
          var isOutbound = m.direction === 'outbound';
          var icons = { call: '📞', text: '💬', email: '📧', note: '📌', visit: '🏠', voicemail: '📱' };
          html += '<div style="display:flex;justify-content:' + (isOutbound ? 'flex-end' : 'flex-start') + ';">'
            + '<div style="max-width:75%;padding:10px 14px;border-radius:' + (isOutbound ? '16px 16px 4px 16px' : '16px 16px 16px 4px') + ';background:' + (isOutbound ? 'var(--green-dark)' : 'var(--bg)') + ';color:' + (isOutbound ? '#fff' : 'var(--text)') + ';font-size:14px;">'
            + '<div>' + (icons[m.type] || '') + ' ' + (m.notes || '') + '</div>'
            + '<div style="font-size:10px;opacity:.6;margin-top:4px;text-align:right;">' + UI.dateRelative(m.date) + ' · ' + m.type + '</div>'
            + '</div></div>';
        });
      } else {
        html += '<div style="text-align:center;padding:40px;color:var(--text-light);font-size:13px;">No messages yet. Send the first one below.</div>';
      }
      html += '</div>';

      // Compose — pill type selector
      var msgType = MessagingPage._msgType || 'text';
      var pills = [
        { val: 'text', label: '💬 Text' },
        { val: 'email', label: '📧 Email' },
        { val: 'call', label: '📞 Call Note' },
        { val: 'note', label: '📌 Note' }
      ];
      var pillHtml = pills.map(function(p) {
        var active = msgType === p.val;
        return '<button onclick="MessagingPage._msgType=\'' + p.val + '\';MessagingPage._refreshCompose();" style="padding:6px 10px;border-radius:20px;border:1px solid ' + (active ? 'var(--green-dark)' : 'var(--border)') + ';background:' + (active ? 'var(--green-dark)' : 'var(--white)') + ';color:' + (active ? '#fff' : 'var(--text)') + ';font-size:12px;font-weight:' + (active ? '700' : '500') + ';cursor:pointer;white-space:nowrap;">' + p.label + '</button>';
      }).join('');

      html += '<div style="padding:10px 12px;border-top:1px solid var(--border);">'
        + '<div id="msg-type-pills" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">' + pillHtml + '</div>'
        + '<div style="display:flex;gap:8px;">'
        + '<input type="text" id="msg-input" placeholder="Type a message..." style="flex:1;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;" onkeydown="if(event.key===\'Enter\')MessagingPage.send(\'' + selectedId + '\')">'
        + '<button onclick="MessagingPage.send(\'' + selectedId + '\')" style="background:var(--green-dark);color:#fff;border:none;padding:10px 16px;border-radius:8px;font-weight:700;cursor:pointer;">Send</button>'
        + '</div></div>';
    } else {
      html += '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-light);">'
        + '<div style="text-align:center;"><div style="font-size:48px;margin-bottom:8px;">💬</div>'
        + '<h3 style="font-size:16px;color:var(--text);">Messages</h3>'
        + '<p style="font-size:13px;">Select a contact or click <strong>+ New</strong> to start a conversation</p></div></div>';
    }
    html += '</div></div>';

    return html;
  },

  selectClient: function(clientId) {
    // Clear unread count for this client
    var unread = {};
    try { unread = JSON.parse(localStorage.getItem('bm-msg-unread') || '{}'); } catch(e) {}
    delete unread[clientId];
    localStorage.setItem('bm-msg-unread', JSON.stringify(unread));

    MessagingPage._selected = clientId;
    loadPage('messaging');
    setTimeout(function() {
      var thread = document.getElementById('msg-thread');
      if (thread) thread.scrollTop = thread.scrollHeight;
    }, 100);
  },

  send: function(clientId) {
    var input = document.getElementById('msg-input');
    if (!input || !input.value.trim()) return;

    var type = MessagingPage._msgType || 'text';
    var notes = input.value.trim();
    var client = DB.clients.getById(clientId);

    if (type === 'text' && typeof Dialpad !== 'undefined') {
      var phone = client ? client.phone : '';
      Dialpad.sendSMS(phone, notes, clientId);
    } else if (type === 'email' && typeof Email !== 'undefined' && client && client.email) {
      Email.send(client.email, 'Message from ' + MessagingPage._co().name, notes);
      Dialpad._logComm(clientId, 'email', 'outbound', notes);
    } else {
      var key = 'bm-comms-' + clientId;
      var all = [];
      try { all = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
      all.unshift({
        id: Date.now().toString(36),
        clientId: clientId,
        type: type,
        direction: 'outbound',
        notes: notes,
        date: new Date().toISOString(),
        user: 'Doug'
      });
      localStorage.setItem(key, JSON.stringify(all));
      UI.toast(type === 'call' ? 'Call note saved' : 'Note saved');
    }

    input.value = '';
    MessagingPage.selectClient(clientId);
  },

  newMessage: function() {
    var clients = DB.clients.getAll().filter(function(c) { return c.phone || c.email; });
    var options = clients.map(function(c) {
      return '<div onclick="MessagingPage.selectClient(\'' + c.id + '\');UI.closeModal();" style="padding:10px;cursor:pointer;border-bottom:1px solid var(--border);font-size:14px;" onmouseover="this.style.background=\'var(--green-bg)\'" onmouseout="this.style.background=\'\'">'
        + '<strong>' + c.name + '</strong><span style="color:var(--text-light);font-size:12px;margin-left:8px;">' + (c.phone || c.email) + '</span></div>';
    }).join('');
    UI.showModal('New Message', '<div style="max-height:400px;overflow-y:auto;">' + options + '</div>');
  },

  showTemplates: function(clientId) {
    var client = DB.clients.getById(clientId);
    if (!client || !Templates) return;

    var html = '<div style="display:grid;gap:8px;">';
    var quickTemplates = ['request_received_sms', 'quote_sent_sms', 'booking_confirm_sms', 'visit_reminder_sms', 'review_request_sms'];
    quickTemplates.forEach(function(key) {
      var t = Templates.library[key];
      if (!t) return;
      var filled = Templates.fill(t.body, { name: client.name, address: client.address });
      html += '<div onclick="document.getElementById(\'msg-input\').value=\'' + filled.replace(/'/g, "\\'").replace(/\n/g, ' ') + '\';UI.closeModal();" style="padding:10px;background:var(--bg);border-radius:8px;cursor:pointer;font-size:13px;border:1px solid var(--border);transition:background .1s;" onmouseover="this.style.background=\'var(--green-bg)\'" onmouseout="this.style.background=\'var(--bg)\'">'
        + '<strong style="font-size:12px;color:var(--green-dark);">' + t.name + '</strong>'
        + '<div style="color:var(--text-light);margin-top:2px;">' + filled.substring(0, 80) + '...</div>'
        + '</div>';
    });
    html += '</div>';
    UI.showModal('Quick Templates', html);
  },

  filterContacts: function(query) {
    var q = query.toLowerCase();
    var contacts = document.getElementById('msg-contacts');
    if (!contacts) return;
    Array.from(contacts.children).forEach(function(el) {
      var name = el.innerText.toLowerCase();
      el.style.display = name.includes(q) ? '' : 'none';
    });
  },

  // Re-render just the pill buttons when type changes (avoids full page reload)
  _refreshCompose: function() {
    var msgType = MessagingPage._msgType || 'text';
    var pills = [
      { val: 'text', label: '💬 Text' },
      { val: 'email', label: '📧 Email' },
      { val: 'call', label: '📞 Call Note' },
      { val: 'note', label: '📌 Note' }
    ];
    var container = document.getElementById('msg-type-pills');
    if (!container) return;
    container.innerHTML = pills.map(function(p) {
      var active = msgType === p.val;
      return '<button onclick="MessagingPage._msgType=\'' + p.val + '\';MessagingPage._refreshCompose();" style="padding:6px 10px;border-radius:20px;border:1px solid ' + (active ? 'var(--green-dark)' : 'var(--border)') + ';background:' + (active ? 'var(--green-dark)' : 'var(--white)') + ';color:' + (active ? '#fff' : 'var(--text)') + ';font-size:12px;font-weight:' + (active ? '700' : '500') + ';cursor:pointer;white-space:nowrap;">' + p.label + '</button>';
    }).join('');
  }
};
