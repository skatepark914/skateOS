/**
 * Branch Manager — Team Chat
 * Slack-style internal messaging for crew communication
 * Channels: General, Errands, Maintenance, Jobs
 */
var TeamChat = {
  _channel: 'general',
  _message: '',

  render: function() {
    var channels = [
      { id: 'general', label: 'General', icon: '💬' },
      { id: 'errands', label: 'Errands', icon: '🏃' },
      { id: 'maintenance', label: 'Maintenance', icon: '🔧' },
      { id: 'jobs', label: 'Jobs', icon: '🌳' }
    ];

    var html = '<div style="display:grid;grid-template-columns:200px 1fr;height:calc(100vh - 120px);gap:0;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--white);" class="detail-grid">';

    // Channel sidebar
    html += '<div style="background:var(--bg);border-right:1px solid var(--border);padding:12px;">'
      + '<h3 style="font-size:14px;margin:0 0 12px;color:var(--text-light);">Channels</h3>';
    channels.forEach(function(ch) {
      var isActive = TeamChat._channel === ch.id;
      var unread = TeamChat._getUnread(ch.id);
      html += '<button onclick="TeamChat._channel=\'' + ch.id + '\';loadPage(\'teamchat\')" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px 12px;margin-bottom:4px;border-radius:8px;border:none;cursor:pointer;font-size:14px;font-weight:' + (isActive ? '700' : '500') + ';background:' + (isActive ? 'var(--green-dark)' : 'transparent') + ';color:' + (isActive ? '#fff' : 'var(--text)') + ';">'
        + '<span>' + ch.icon + ' ' + ch.label + '</span>'
        + (unread > 0 ? '<span style="background:#dc3545;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:10px;">' + unread + '</span>' : '')
        + '</button>';
    });

    // Team members online
    var team = TeamChat._getTeam();
    html += '<div style="margin-top:20px;border-top:1px solid var(--border);padding-top:12px;">'
      + '<h4 style="font-size:12px;color:var(--text-light);margin:0 0 8px;">Team</h4>';
    team.forEach(function(m) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;">'
        + '<span style="width:8px;height:8px;border-radius:50%;background:' + (m.online ? '#2e7d32' : '#ccc') + ';flex-shrink:0;"></span>'
        + m.name + '</div>';
    });
    html += '</div></div>';

    // Chat area
    html += '<div style="display:flex;flex-direction:column;height:100%;">';

    // Channel header
    var currentCh = channels.find(function(c) { return c.id === TeamChat._channel; }) || channels[0];
    html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">'
      + '<div><h3 style="font-size:16px;margin:0;">' + currentCh.icon + ' ' + currentCh.label + '</h3>'
      + '<div style="font-size:12px;color:var(--text-light);">Internal team channel</div></div>'
      + '<button onclick="TeamChat._pinMessage()" style="background:none;border:1px solid var(--border);padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;">📌 Pinned</button>'
      + '</div>';

    // Messages
    html += '<div id="chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;">';
    var messages = TeamChat._getMessages(TeamChat._channel);
    if (messages.length === 0) {
      html += '<div style="text-align:center;padding:40px;color:var(--text-light);font-size:14px;">No messages yet. Start the conversation!</div>';
    } else {
      var lastDate = '';
      messages.forEach(function(msg) {
        var msgDate = new Date(msg.timestamp).toLocaleDateString();
        if (msgDate !== lastDate) {
          html += '<div style="text-align:center;font-size:11px;color:var(--text-light);margin:8px 0;">— ' + msgDate + ' —</div>';
          lastDate = msgDate;
        }
        var isMe = msg.author === TeamChat._getCurrentUser();
        html += '<div style="display:flex;gap:10px;' + (isMe ? 'flex-direction:row-reverse;' : '') + '">'
          + '<div style="width:32px;height:32px;border-radius:50%;background:' + (isMe ? 'var(--green-dark)' : 'var(--accent)') + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">'
          + (msg.author || 'U').charAt(0).toUpperCase() + '</div>'
          + '<div style="max-width:70%;' + (isMe ? 'text-align:right;' : '') + '">'
          + '<div style="font-size:11px;color:var(--text-light);margin-bottom:2px;">' + UI.esc(msg.author || 'Unknown') + ' · ' + TeamChat._timeAgo(msg.timestamp) + '</div>'
          + '<div style="background:' + (isMe ? 'var(--green-dark)' : 'var(--bg)') + ';color:' + (isMe ? '#fff' : 'var(--text)') + ';padding:10px 14px;border-radius:' + (isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px') + ';font-size:14px;line-height:1.5;word-break:break-word;">'
          + UI.esc(msg.text).replace(/\n/g, '<br>') + '</div>'
          + (msg.photo ? '<img src="' + msg.photo + '" style="max-width:200px;border-radius:8px;margin-top:4px;cursor:pointer;" onclick="window.open(this.src)">' : '')
          + (msg.task ? '<div style="background:#fff3e0;border:1px solid #ffe082;border-radius:8px;padding:8px 12px;margin-top:4px;font-size:13px;">'
            + '<div style="font-weight:600;color:#e65100;">📋 Task: ' + UI.esc(msg.task) + '</div>'
            + '<button onclick="TeamChat._completeTask(\'' + msg.id + '\')" style="margin-top:4px;background:var(--green-dark);color:#fff;border:none;padding:4px 12px;border-radius:6px;font-size:12px;cursor:pointer;">'
            + (msg.taskComplete ? '✓ Done' : 'Mark Complete') + '</button></div>' : '')
          + '</div></div>';
      });
    }
    html += '</div>';

    // Input area
    html += '<div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:flex-end;">'
      + '<button onclick="TeamChat._addPhoto()" style="background:none;border:1px solid var(--border);width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;flex-shrink:0;">📷</button>'
      + '<button onclick="TeamChat._addTask()" style="background:none;border:1px solid var(--border);width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;flex-shrink:0;">📋</button>'
      + '<textarea id="chat-input" rows="1" placeholder="Message #' + currentCh.label.toLowerCase() + '..." style="flex:1;padding:10px 14px;border:2px solid var(--border);border-radius:10px;font-size:15px;font-family:inherit;resize:none;max-height:100px;" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();TeamChat._send();}">' + UI.esc(TeamChat._message) + '</textarea>'
      + '<button onclick="TeamChat._send()" style="background:var(--green-dark);color:#fff;border:none;width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;flex-shrink:0;">➤</button>'
      + '</div>';

    html += '</div></div>';
    return html;
  },

  _getMessages: function(channel) {
    try {
      return JSON.parse(localStorage.getItem('bm-chat-' + channel) || '[]');
    } catch(e) { return []; }
  },

  _saveMessages: function(channel, messages) {
    localStorage.setItem('bm-chat-' + channel, JSON.stringify(messages));
  },

  _getCurrentUser: function() {
    return (typeof Auth !== 'undefined' && Auth.user) ? Auth.user.name : 'Owner';
  },

  _getTeam: function() {
    var members = [];
    try {
      var team = JSON.parse(localStorage.getItem('bm-team') || '[]');
      team.forEach(function(t) { members.push({ name: t.name || t.email, online: false }); });
    } catch(e) {}
    if (members.length === 0) {
      members = [{ name: TeamChat._getCurrentUser(), online: true }];
    } else {
      members[0].online = true;
    }
    return members;
  },

  _getUnread: function(channel) {
    var lastRead = parseInt(localStorage.getItem('bm-chat-read-' + channel) || '0');
    var messages = TeamChat._getMessages(channel);
    return messages.filter(function(m) { return new Date(m.timestamp).getTime() > lastRead; }).length;
  },

  _send: function() {
    var input = document.getElementById('chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    var messages = TeamChat._getMessages(TeamChat._channel);
    messages.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      author: TeamChat._getCurrentUser(),
      text: text,
      timestamp: new Date().toISOString(),
      channel: TeamChat._channel
    });
    TeamChat._saveMessages(TeamChat._channel, messages);
    TeamChat._message = '';

    // Sync to Supabase if available
    if (typeof SupabaseDB !== 'undefined' && SupabaseDB.client) {
      SupabaseDB.client.from('team_messages').insert({
        channel: TeamChat._channel,
        author: TeamChat._getCurrentUser(),
        text: text,
        timestamp: new Date().toISOString()
      }).then(function() {}).catch(function() {});
    }

    loadPage('teamchat');
    setTimeout(function() {
      var el = document.getElementById('chat-messages');
      if (el) el.scrollTop = el.scrollHeight;
    }, 100);
  },

  _addPhoto: function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        var messages = TeamChat._getMessages(TeamChat._channel);
        messages.push({
          id: Date.now().toString(36),
          author: TeamChat._getCurrentUser(),
          text: '📷 Photo',
          photo: ev.target.result,
          timestamp: new Date().toISOString(),
          channel: TeamChat._channel
        });
        TeamChat._saveMessages(TeamChat._channel, messages);
        loadPage('teamchat');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  },

  _addTask: function() {
    var task = prompt('What needs to be done?');
    if (!task) return;
    var messages = TeamChat._getMessages(TeamChat._channel);
    messages.push({
      id: Date.now().toString(36),
      author: TeamChat._getCurrentUser(),
      text: 'Created a task:',
      task: task,
      taskComplete: false,
      timestamp: new Date().toISOString(),
      channel: TeamChat._channel
    });
    TeamChat._saveMessages(TeamChat._channel, messages);
    loadPage('teamchat');
  },

  _completeTask: function(msgId) {
    var messages = TeamChat._getMessages(TeamChat._channel);
    var msg = messages.find(function(m) { return m.id === msgId; });
    if (msg) {
      msg.taskComplete = !msg.taskComplete;
      TeamChat._saveMessages(TeamChat._channel, messages);
      loadPage('teamchat');
    }
  },

  _pinMessage: function() {
    UI.toast('Pinned messages coming soon');
  },

  _timeAgo: function(ts) {
    var diff = Date.now() - new Date(ts).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }
};
