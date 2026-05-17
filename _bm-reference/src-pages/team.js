/**
 * Branch Manager — Team Management
 * Add/edit team members, assign roles, view hours, ISA cert tracking
 */
var TeamPage = {
  render: function() {
    var members = TeamPage.getMembers();
    var now = new Date();
    var today = now.toISOString().split('T')[0];
    var in30 = new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0];

    var certified = members.filter(function(m) {
      return m.isaCertNumber && m.isaCertExpiry && m.isaCertExpiry >= today;
    });
    var expiringSoon = members.filter(function(m) {
      return m.isaCertNumber && m.isaCertExpiry && m.isaCertExpiry >= today && m.isaCertExpiry <= in30;
    });
    var expired = members.filter(function(m) {
      return m.isaCertNumber && m.isaCertExpiry && m.isaCertExpiry < today;
    });

    var html = '<div class="stat-grid">'
      + UI.statCard('Team Size', members.filter(function(m){return m.active;}).length.toString(), 'Active members', '', '')
      + UI.statCard('Hours This Week', TeamPage.weekHours().toFixed(1), 'All members', '', '')
      + UI.statCard('ISA Certified', certified.length.toString(), 'Valid credentials', certified.length > 0 ? 'up' : '', '')
      + (expiringSoon.length > 0 || expired.length > 0
          ? UI.statCard('⚠️ Cert Alerts', (expiringSoon.length + expired.length).toString(), expiringSoon.length + ' expiring · ' + expired.length + ' expired', 'down', '')
          : UI.statCard('Cert Status', 'All Clear', 'No expirations pending', 'up', ''))
      + '</div>';

    // Expiry alert banner
    if (expired.length > 0) {
      html += '<div style="background:#fde8e8;border:1px solid #f5c6cb;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">'
        + '<span style="font-size:18px;">🚨</span>'
        + '<div><strong style="color:#842029;">ISA Certification Expired</strong><div style="font-size:13px;color:#6b2430;margin-top:2px;">'
        + expired.map(function(m){return m.name + ' (' + TeamPage._certLabel(m.isaCertType) + ' #' + m.isaCertNumber + ', expired ' + UI.dateShort(m.isaCertExpiry) + ')';}).join(' · ')
        + '</div></div></div>';
    }
    if (expiringSoon.length > 0) {
      html += '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">'
        + '<span style="font-size:18px;">⏰</span>'
        + '<div><strong style="color:#664d03;">Certification Expiring Soon</strong><div style="font-size:13px;color:#664d03;margin-top:2px;">'
        + expiringSoon.map(function(m){return m.name + ' — expires ' + UI.dateShort(m.isaCertExpiry);}).join(' · ')
        + '</div></div></div>';
    }

    // Team table
    html += '<div style="background:var(--white);border-radius:12px;border:1px solid var(--border);overflow:hidden;">'
      + '<table class="data-table"><thead><tr>'
      + '<th>Name</th><th>Role</th><th>Certification</th><th>Phone</th><th>Hours (Week)</th><th>Status</th>'
      + '</tr></thead><tbody>';

    if (members.length === 0) {
      html += '<tr><td colspan="6">' + UI.emptyState('👷', 'No team members', 'Add your crew to start tracking time.', '+ Add Member', 'TeamPage.showForm()') + '</td></tr>';
    } else {
      members.forEach(function(m) {
        var weekHrs = TeamPage.memberWeekHours(m.name);
        var certBadge = TeamPage._certBadge(m);
        html += '<tr onclick="TeamPage.showDetail(\'' + m.id + '\')">'
          + '<td><strong>' + m.name + '</strong></td>'
          + '<td>' + UI.statusBadge(m.role) + '</td>'
          + '<td>' + certBadge + '</td>'
          + '<td>' + UI.phone(m.phone) + '</td>'
          + '<td style="font-weight:600;">' + weekHrs.toFixed(1) + ' hrs</td>'
          + '<td>' + (m.active ? '<span style="color:var(--green-dark);">Active</span>' : '<span style="color:var(--text-light);">Inactive</span>') + '</td>'
          + '</tr>';
      });
    }
    html += '</tbody></table></div>';

    return html;
  },

  _certLabel: function(type) {
    var labels = {
      'isa_arborist': 'ISA Certified Arborist',
      'isa_bcma': 'ISA Board Certified Master Arborist',
      'isa_mu': 'ISA Municipal Specialist',
      'isa_uu': 'ISA Utility Specialist',
      'tcia': 'TCIA Accredited',
      'other': 'Certified'
    };
    return labels[type] || type || 'Certified';
  },

  _certBadge: function(m) {
    if (!m.isaCertNumber) {
      return '<span style="font-size:12px;color:var(--text-light);">—</span>';
    }
    var now = new Date().toISOString().split('T')[0];
    var in30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    var isExpired = m.isaCertExpiry && m.isaCertExpiry < now;
    var isExpiringSoon = !isExpired && m.isaCertExpiry && m.isaCertExpiry <= in30;

    var label = TeamPage._certLabel(m.isaCertType);
    var shortLabel = label.replace('ISA ', '').replace('Board Certified ', '');
    if (isExpired) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#fde8e8;color:#842029;border-radius:10px;font-size:11px;font-weight:600;">🚨 ' + shortLabel + ' — Expired</span>';
    } else if (isExpiringSoon) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#fff3cd;color:#664d03;border-radius:10px;font-size:11px;font-weight:600;">⏰ ' + shortLabel + ' — Expiring Soon</span>';
    } else {
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#e6f9f2;color:#00836c;border-radius:10px;font-size:11px;font-weight:600;">✓ ' + shortLabel + '</span>';
    }
  },

  getMembers: function() {
    var stored = JSON.parse(localStorage.getItem('bm-team') || '[]');
    if (stored.length === 0) {
      stored = [
        { id: 'owner', name: BM_CONFIG.ownerName, role: 'owner', phone: BM_CONFIG.phone, email: BM_CONFIG.email, active: true },
        { id: 'ryan', name: 'Ryan Knapp', role: 'crew_lead', phone: '', email: '', active: true },
        { id: 'anthony', name: 'Anthony Turner', role: 'crew_member', phone: '', email: '', active: true },
        { id: 'catherine', name: 'Catherine Conway', role: 'crew_member', phone: '', email: '', active: true }
      ];
      localStorage.setItem('bm-team', JSON.stringify(stored));
    }
    return stored;
  },

  saveMember: function(member) {
    var members = TeamPage.getMembers();
    var idx = members.findIndex(function(m) { return m.id === member.id; });
    if (idx >= 0) {
      members[idx] = member;
    } else {
      member.id = member.id || Date.now().toString(36);
      members.push(member);
    }
    localStorage.setItem('bm-team', JSON.stringify(members));
  },

  removeMember: function(id) {
    var members = TeamPage.getMembers().filter(function(m) { return m.id !== id; });
    localStorage.setItem('bm-team', JSON.stringify(members));
  },

  weekHours: function() {
    var now = new Date();
    var weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    var startStr = weekStart.toISOString().split('T')[0];
    return DB.timeEntries.getAll().filter(function(t) { return t.date >= startStr; })
      .reduce(function(sum, t) { return sum + (t.hours || 0); }, 0);
  },

  memberWeekHours: function(name) {
    var now = new Date();
    var weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    var startStr = weekStart.toISOString().split('T')[0];
    return DB.timeEntries.getAll().filter(function(t) { return (t.user === name || t.userId === name) && t.date >= startStr; })
      .reduce(function(sum, t) { return sum + (t.hours || 0); }, 0);
  },

  showForm: function(id) {
    var m = id ? TeamPage.getMembers().find(function(mem) { return mem.id === id; }) : {};
    if (!m) m = {};
    var title = id ? 'Edit Team Member' : 'Add Team Member';

    var html = '<form id="team-form" onsubmit="TeamPage.save(event, \'' + (id || '') + '\')">'
      + UI.formField('Name *', 'text', 'tm-name', m.name, { required: true, placeholder: 'Full name' })
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + UI.formField('Phone', 'tel', 'tm-phone', m.phone, { placeholder: '(914) 555-0000' })
      + UI.formField('Email', 'email', 'tm-email', m.email, { placeholder: 'email@example.com' })
      + '</div>'
      + UI.formField('Role', 'select', 'tm-role', m.role || 'crew_member', { options: [
          { value: 'owner', label: 'Owner — Full access' },
          { value: 'crew_lead', label: 'Crew Lead — Jobs, schedule, clients' },
          { value: 'crew_member', label: 'Crew Member — Clock in/out, today\'s jobs' }
        ]})

      // ISA Certification section
      + '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">'
      + '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px;">ISA / TCIA Certification</div>'
      + UI.formField('Certification Type', 'select', 'tm-cert-type', m.isaCertType || '', { options: [
          { value: '', label: 'None / Not certified' },
          { value: 'isa_arborist', label: 'ISA Certified Arborist' },
          { value: 'isa_bcma', label: 'ISA Board Certified Master Arborist' },
          { value: 'isa_mu', label: 'ISA Municipal Specialist' },
          { value: 'isa_uu', label: 'ISA Utility Specialist' },
          { value: 'tcia', label: 'TCIA Accredited' },
          { value: 'other', label: 'Other certification' }
        ]})
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + UI.formField('Credential / Badge #', 'text', 'tm-cert-number', m.isaCertNumber, { placeholder: 'e.g. SO-10897TX' })
      + UI.formField('Expiration Date', 'date', 'tm-cert-expiry', m.isaCertExpiry, {})
      + '</div>'
      + '</div>'
      + '</form>';

    UI.showModal(title, html, {
      footer: (id && id !== 'owner' ? '<button class="btn" style="background:var(--red);color:#fff;margin-right:auto;" onclick="TeamPage.remove(\'' + id + '\')">Remove</button>' : '')
        + '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="document.getElementById(\'team-form\').requestSubmit()">Save</button>'
    });
  },

  save: function(e, id) {
    e.preventDefault();
    var data = {
      id: id || Date.now().toString(36),
      name: document.getElementById('tm-name').value.trim(),
      phone: document.getElementById('tm-phone').value.trim(),
      email: document.getElementById('tm-email').value.trim(),
      role: document.getElementById('tm-role').value,
      isaCertType: document.getElementById('tm-cert-type').value,
      isaCertNumber: document.getElementById('tm-cert-number').value.trim(),
      isaCertExpiry: document.getElementById('tm-cert-expiry').value,
      active: true
    };
    if (!data.name) { UI.toast('Name is required', 'error'); return; }
    // Preserve existing active state if editing
    if (id) {
      var existing = TeamPage.getMembers().find(function(m) { return m.id === id; });
      if (existing) data.active = existing.active;
    }
    TeamPage.saveMember(data);
    UI.toast(id ? 'Member updated' : 'Member added');
    UI.closeModal();
    loadPage('team');
  },

  remove: function(id) {
    UI.confirm('Remove this team member?', function() {
      TeamPage.removeMember(id);
      UI.toast('Member removed');
      UI.closeModal();
      loadPage('team');
    });
  },

  showDetail: function(id) {
    var m = TeamPage.getMembers().find(function(mem) { return mem.id === id; });
    if (!m) return;

    var now = new Date().toISOString().split('T')[0];
    var in30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    var certExpired = m.isaCertNumber && m.isaCertExpiry && m.isaCertExpiry < now;
    var certExpiringSoon = m.isaCertNumber && m.isaCertExpiry && !certExpired && m.isaCertExpiry <= in30;

    var html = '<div style="text-align:center;margin-bottom:20px;">'
      + '<div style="font-size:48px;margin-bottom:8px;">👷</div>'
      + '<h2>' + m.name + '</h2>'
      + '<div>' + UI.statusBadge(m.role) + '</div>'
      + '</div>'
      + '<div style="font-size:14px;line-height:2;">'
      + (m.phone ? '<div>📞 ' + UI.phone(m.phone) + '</div>' : '')
      + (m.email ? '<div>✉️ ' + m.email + '</div>' : '')
      + '<div>⏱️ Hours this week: <strong>' + TeamPage.memberWeekHours(m.name).toFixed(1) + '</strong></div>'
      + '</div>';

    // ISA Certification card
    html += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:16px;margin-top:16px;margin-bottom:16px;">'
      + '<div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-light);margin-bottom:12px;">Certification</div>';

    if (!m.isaCertNumber) {
      html += '<div style="font-size:13px;color:var(--text-light);">No certification on file — <a href="#" onclick="UI.closeModal();TeamPage.showForm(\'' + id + '\');return false;" style="color:var(--accent);">Add certification</a></div>';
    } else {
      var certStatusBg = certExpired ? '#fde8e8' : certExpiringSoon ? '#fff3cd' : '#e6f9f2';
      var certStatusColor = certExpired ? '#842029' : certExpiringSoon ? '#664d03' : '#00836c';
      var certStatusLabel = certExpired ? '🚨 EXPIRED' : certExpiringSoon ? '⏰ EXPIRING SOON' : '✓ VALID';

      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
        + '<div><div style="font-size:11px;color:var(--text-light);font-weight:600;text-transform:uppercase;margin-bottom:4px;">Type</div>'
        + '<div style="font-size:14px;font-weight:600;">' + TeamPage._certLabel(m.isaCertType) + '</div></div>'
        + '<div><div style="font-size:11px;color:var(--text-light);font-weight:600;text-transform:uppercase;margin-bottom:4px;">Credential #</div>'
        + '<div style="font-size:14px;font-weight:600;">' + UI.esc(m.isaCertNumber) + '</div></div>'
        + '<div><div style="font-size:11px;color:var(--text-light);font-weight:600;text-transform:uppercase;margin-bottom:4px;">Expires</div>'
        + '<div style="font-size:14px;font-weight:600;">' + (m.isaCertExpiry ? UI.dateShort(m.isaCertExpiry) : '—') + '</div></div>'
        + '<div><div style="font-size:11px;color:var(--text-light);font-weight:600;text-transform:uppercase;margin-bottom:4px;">Status</div>'
        + '<div style="display:inline-block;padding:2px 10px;background:' + certStatusBg + ';color:' + certStatusColor + ';border-radius:10px;font-size:12px;font-weight:700;">' + certStatusLabel + '</div></div>'
        + '</div>';
    }
    html += '</div>';

    // Recent time entries
    var entries = DB.timeEntries.getAll().filter(function(t) { return t.user === m.name || t.userId === m.name; }).slice(0, 10);
    if (entries.length > 0) {
      html += '<h4 style="margin-top:4px;margin-bottom:8px;">Recent Time Entries</h4>';
      entries.forEach(function(t) {
        var job = t.jobId ? DB.jobs.getById(t.jobId) : null;
        html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:13px;">'
          + '<span>' + UI.dateShort(t.date) + ' — ' + (job ? job.clientName : 'General') + '</span>'
          + '<span style="font-weight:600;">' + (t.hours || 0).toFixed(1) + ' hrs</span>'
          + '</div>';
      });
    }

    UI.showModal(m.name, html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Close</button>'
        + ' <button class="btn btn-primary" onclick="UI.closeModal();TeamPage.showForm(\'' + id + '\')">Edit</button>'
    });
  }
};
