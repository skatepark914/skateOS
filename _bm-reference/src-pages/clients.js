/**
 * Branch Manager — Clients Page
 * Full client list, detail view, add/edit forms
 * v12
 */
var ClientsPage = {
  _page: 0,
  _perPage: 50,
  _filter: 'all',
  _search: '',
  _sort: 'updatedAt',
  _sortDir: -1,
  _tagFilter: '',

  _co: function() {
    return {
      name: localStorage.getItem('bm-co-name') || BM_CONFIG.companyName,
      phone: localStorage.getItem('bm-co-phone') || BM_CONFIG.phone,
      email: localStorage.getItem('bm-co-email') || BM_CONFIG.email,
      website: localStorage.getItem('bm-co-website') || BM_CONFIG.website
    };
  },

  _pendingDetail: null,

  render: function() {
    var self = ClientsPage;
    // Check if we need to show a detail immediately
    if (self._pendingDetail) {
      var _pid = self._pendingDetail;
      self._pendingDetail = null;
      setTimeout(function() { ClientsPage.showDetail(_pid); }, 50);
    }
    // Click handler with scroll detection — only fires on real taps, not scroll gestures
    setTimeout(function() {
      var cards = document.querySelectorAll('[data-cid]');
      cards.forEach(function(card) {
        if (card._bmHandled) return;
        card._bmHandled = true;
        var startX = 0, startY = 0, moved = false;
        card.addEventListener('touchstart', function(e) {
          var t = e.touches[0];
          startX = t.clientX; startY = t.clientY; moved = false;
        }, { passive: true });
        card.addEventListener('touchmove', function(e) {
          var t = e.touches[0];
          if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) moved = true;
        }, { passive: true });
        card.addEventListener('click', function() {
          if (moved) return; // scroll, not tap
          var cid = this.getAttribute('data-cid');
          if (cid) ClientsPage.showDetail(cid);
        });
      });
    }, 100);
    var stats = DB.dashboard.getStats();
    var clients = self._getFiltered();

    // previous system-style stat cards row
    var now = new Date();
    var ago30 = new Date(); ago30.setDate(ago30.getDate()-30);
    var allClients = DB.clients.getAll();
    var newLeads30 = allClients.filter(function(c){ return c.status==='lead' && new Date(c.createdAt)>=ago30; }).length;
    var newClients30 = allClients.filter(function(c){ return c.status==='active' && new Date(c.createdAt)>=ago30; }).length;
    var ytdClients = allClients.filter(function(c){ return new Date(c.createdAt).getFullYear()===now.getFullYear(); }).length;

    var html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;background:var(--white);" class="stat-row">'
      // New leads
      + '<div onclick="ClientsPage.setFilter(\'lead\')" style="padding:14px 16px;border-right:1px solid var(--border);cursor:pointer;">'
      + '<div style="font-size:14px;font-weight:700;">New leads</div>'
      + '<div style="font-size:12px;color:var(--text-light);">Past 30 days</div>'
      + '<div style="font-size:28px;font-weight:700;margin-top:4px;">' + newLeads30 + '</div>'
      + '</div>'
      // New clients
      + '<div onclick="ClientsPage.setFilter(\'active\')" style="padding:14px 16px;border-right:1px solid var(--border);cursor:pointer;">'
      + '<div style="font-size:14px;font-weight:700;">New clients</div>'
      + '<div style="font-size:12px;color:var(--text-light);">Past 30 days</div>'
      + '<div style="font-size:28px;font-weight:700;margin-top:4px;">' + newClients30 + '</div>'
      + '</div>'
      // Total new clients YTD
      + '<div onclick="ClientsPage.setFilter(\'all\')" style="padding:14px 16px;cursor:pointer;">'
      + '<div style="font-size:14px;font-weight:700;">Total new clients</div>'
      + '<div style="font-size:12px;color:var(--text-light);">Year to date</div>'
      + '<div style="font-size:28px;font-weight:700;margin-top:4px;">' + ytdClients + '</div>'
      + '</div>'
      + '</div>';

    // previous system-style header + filter/search
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '<h3 style="font-size:16px;font-weight:700;margin:0;">Clients</h3>'
      + '<span style="font-size:13px;color:var(--text-light);">(' + clients.length + ' results)</span>'
      + '<button class="filter-btn' + (self._filter==='all'?' active':'') + '" onclick="ClientsPage.setFilter(\'all\')" style="font-size:12px;padding:5px 12px;">All</button>'
      + '<button class="filter-btn' + (self._filter==='active'?' active':'') + '" onclick="ClientsPage.setFilter(\'active\')" style="font-size:12px;padding:5px 12px;">Active</button>'
      + '<button class="filter-btn' + (self._filter==='lead'?' active':'') + '" onclick="ClientsPage.setFilter(\'lead\')" style="font-size:12px;padding:5px 12px;">Lead</button>'
      + '<button class="filter-btn' + (self._filter==='archived'?' active':'') + '" onclick="ClientsPage.setFilter(\'archived\')" style="font-size:12px;padding:5px 12px;">Archived</button>'
      + '<button class="filter-btn' + (self._filter==='no-email'?' active':'') + '" onclick="ClientsPage.setFilter(\'no-email\')" style="font-size:12px;padding:5px 12px;" title="Clients missing email">📧 Missing email</button>'
      + (self._tagFilter ? '<button class="filter-btn active" onclick="ClientsPage._tagFilter=\'\';ClientsPage._page=0;loadPage(\'clients\')" style="font-size:12px;padding:5px 12px;">Tag: ' + UI.esc(self._tagFilter) + ' ✕</button>' : '<button class="filter-btn" onclick="ClientsPage.showTagFilter()" style="font-size:12px;padding:5px 12px;">Filter by tag +</button>')
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<div class="search-box" style="min-width:200px;max-width:260px;">'
      + '<span style="color:var(--text-light);">🔍</span>'
      + '<input type="text" id="client-search" placeholder="Search clients..." value="' + UI.esc(self._search) + '" oninput="ClientsPage.setSearch(this.value)">'
      + '</div>'
      + '<button onclick="loadPage(\'clientmap\')" style="background:none;border:1px solid var(--border);padding:7px 12px;border-radius:6px;font-size:12px;cursor:pointer;color:var(--accent);white-space:nowrap;" title="View client map">📍 Map</button>'
      + '<button class="btn btn-primary" onclick="ClientsPage.showForm()" style="font-size:13px;white-space:nowrap;">+ New Client</button>'
      + '</div></div>';

    // Active tag filter banner
    if (self._tagFilter) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:#e8f5e9;border:1px solid #c8e6c9;border-radius:8px;margin-bottom:12px;font-size:13px;">'
        + '<span style="color:var(--green-dark);font-weight:600;">Showing clients tagged:</span>'
        + '<span style="background:var(--green-dark);color:#fff;padding:3px 12px;border-radius:12px;font-weight:700;font-size:12px;">' + UI.esc(self._tagFilter) + '</span>'
        + '<button onclick="ClientsPage._tagFilter=\'\';ClientsPage._page=0;loadPage(\'clients\')" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:13px;color:var(--green-dark);font-weight:600;">Clear ✕</button>'
        + '</div>';
    }

    // Paginated slice
    var pageClients = clients.slice(self._page * self._perPage, (self._page + 1) * self._perPage);

    // Card-style list (iOS/Airbnb vibe) — each client is a rounded card with spacing
    if (pageClients.length === 0) {
      html += self._search
        ? '<div style="text-align:center;padding:40px 20px;color:var(--text-light);background:var(--white);border-radius:12px;border:1px solid var(--border);">No clients match "' + UI.esc(self._search) + '"</div>'
        : UI.emptyState('👥', 'No clients yet', 'Add your first client or import.', '+ Add Client', 'ClientsPage.showForm()');
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:10px;">';
      pageClients.forEach(function(c) {
        var _lastAct = c.updatedAt || c.createdAt || '';
        var _lastActLabel = _lastAct ? (function() {
          var d = new Date(_lastAct); var now = new Date();
          var days = Math.floor((now - d) / 86400000);
          if (days === 0) return 'Today';
          if (days === 1) return 'Yesterday';
          if (days < 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
          return UI.dateShort(_lastAct);
        })() : '';
        var initials = (c.name || '')
          .split(/\s+/).filter(Boolean).slice(0, 2)
          .map(function(w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
        var statusColor = c.status === 'active' ? '#2e7d32' : c.status === 'lead' ? '#e07c24' : '#9e9e9e';
        html += '<div class="client-card" data-status="' + c.status + '" data-cid="' + c.id + '" '
          + 'style="background:var(--white);border:1px solid var(--border);border-radius:14px;padding:14px 16px;cursor:pointer;'
          + 'box-shadow:0 1px 3px rgba(0,0,0,0.04);transition:box-shadow .15s,transform .1s;display:flex;align-items:center;gap:14px;-webkit-tap-highlight-color:transparent;">'
          // Avatar circle
          + '<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,' + statusColor + '22,' + statusColor + '44);color:' + statusColor + ';display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0;">' + initials + '</div>'
          // Main content
          + '<div style="flex:1;min-width:0;">'
          + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;flex-wrap:wrap;">'
          + '<strong style="font-size:15px;color:var(--text);">' + UI.esc(c.name || 'Unnamed') + '</strong>'
          + UI.statusBadge(c.status)
          + '</div>'
          + (c.company ? '<div style="font-size:12px;color:var(--text-light);">' + UI.esc(c.company) + '</div>' : '')
          + (c.address ? '<div style="font-size:13px;color:var(--text-light);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📍 ' + UI.esc(c.address) + '</div>' : '')
          + (c.tags && c.tags.length ? '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">' + c.tags.slice(0, 3).map(function(t) {
              return '<span style="padding:1px 7px;background:var(--green-bg);border-radius:8px;font-size:10px;font-weight:600;color:var(--green-dark);">' + UI.esc(t) + '</span>';
            }).join('') + (c.tags.length > 3 ? '<span style="font-size:10px;color:var(--text-light);">+' + (c.tags.length - 3) + '</span>' : '') + '</div>' : '')
          + '</div>'
          // Right-side metadata
          + '<div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;gap:2px;">'
          + (_lastActLabel ? '<div style="font-size:11px;color:var(--text-light);">' + _lastActLabel + '</div>' : '')
          + '<div style="font-size:18px;color:var(--text-light);">›</div>'
          + '</div>'
          + '</div>';
      });
      html += '</div>';
    }

    // Pagination
    var totalPages = Math.ceil(clients.length / self._perPage);
    if (totalPages > 1) {
      html += '<div style="display:flex;justify-content:center;gap:4px;margin-top:12px;">';
      html += '<button class="btn btn-outline" onclick="ClientsPage.goPage(0)" style="font-size:12px;padding:5px 10px;"' + (self._page === 0 ? ' disabled' : '') + '>«</button>';
      html += '<button class="btn btn-outline" onclick="ClientsPage.goPage(' + (self._page - 1) + ')" style="font-size:12px;padding:5px 10px;"' + (self._page === 0 ? ' disabled' : '') + '>‹</button>';
      // Show max 5 page buttons
      var startP = Math.max(0, self._page - 2);
      var endP = Math.min(totalPages - 1, startP + 4);
      for (var p = startP; p <= endP; p++) {
        html += '<button class="btn ' + (p === self._page ? 'btn-primary' : 'btn-outline') + '" onclick="ClientsPage.goPage(' + p + ')" style="font-size:12px;padding:5px 10px;min-width:32px;">' + (p + 1) + '</button>';
      }
      html += '<button class="btn btn-outline" onclick="ClientsPage.goPage(' + (self._page + 1) + ')" style="font-size:12px;padding:5px 10px;"' + (self._page >= totalPages - 1 ? ' disabled' : '') + '>›</button>';
      html += '<button class="btn btn-outline" onclick="ClientsPage.goPage(' + (totalPages - 1) + ')" style="font-size:12px;padding:5px 10px;"' + (self._page >= totalPages - 1 ? ' disabled' : '') + '>»</button>';
      html += '</div>';
    }

    return html;
  },

  _sortHeader: function(label, field) {
    var arrow = ClientsPage._sort === field ? (ClientsPage._sortDir === 1 ? ' ▲' : ' ▼') : '';
    return '<th onclick="ClientsPage.setSort(\'' + field + '\')" style="cursor:pointer;user-select:none;">' + label + '<span style="font-size:10px;color:var(--text-light);">' + arrow + '</span></th>';
  },

  _getFiltered: function() {
    var self = ClientsPage;
    var clients = DB.clients.getAll();

    // Filter by status (or special filters)
    if (self._filter === 'no-email') {
      clients = clients.filter(function(c) { return !c.email; });
    } else if (self._filter !== 'all') {
      clients = clients.filter(function(c) { return c.status === self._filter; });
    }

    // Filter by tag
    if (self._tagFilter) {
      var tagQ = self._tagFilter.toLowerCase();
      clients = clients.filter(function(c) {
        return c.tags && c.tags.some(function(t) { return t.toLowerCase() === tagQ; });
      });
    }

    // Search
    if (self._search && self._search.length >= 2) {
      var q = self._search.toLowerCase();
      clients = clients.filter(function(c) {
        return (c.name || '').toLowerCase().indexOf(q) >= 0
          || (c.address || '').toLowerCase().indexOf(q) >= 0
          || (c.phone || '').replace(/\D/g, '').indexOf(q.replace(/\D/g, '')) >= 0
          || (c.email || '').toLowerCase().indexOf(q) >= 0
          || (c.company || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    // Sort
    clients.sort(function(a, b) {
      var va = (a[self._sort] || '').toString().toLowerCase();
      var vb = (b[self._sort] || '').toString().toLowerCase();
      return va < vb ? -self._sortDir : va > vb ? self._sortDir : 0;
    });

    return clients;
  },

  setFilter: function(f) { ClientsPage._filter = f; ClientsPage._page = 0; loadPage('clients'); },
  setSearch: function(q) { ClientsPage._search = q; ClientsPage._page = 0; loadPage('clients'); },
  setSort: function(field) {
    if (ClientsPage._sort === field) { ClientsPage._sortDir *= -1; }
    else { ClientsPage._sort = field; ClientsPage._sortDir = 1; }
    loadPage('clients');
  },
  goPage: function(p) {
    var total = Math.ceil(ClientsPage._getFiltered().length / ClientsPage._perPage);
    ClientsPage._page = Math.max(0, Math.min(p, total - 1));
    loadPage('clients');
  },

  filter: function(status, btn) {
    ClientsPage.setFilter(status);
  },

  showTagFilter: function() {
    // If already filtering by tag, clear it
    if (ClientsPage._tagFilter) {
      ClientsPage._tagFilter = '';
      ClientsPage._page = 0;
      loadPage('clients');
      return;
    }
    // Collect all unique tags across all clients
    var allTags = {};
    DB.clients.getAll().forEach(function(c) {
      if (c.tags && c.tags.length) {
        c.tags.forEach(function(t) {
          var key = t.toLowerCase().trim();
          if (key) {
            if (!allTags[key]) allTags[key] = { name: t.trim(), count: 0 };
            allTags[key].count++;
          }
        });
      }
    });
    var tagList = Object.keys(allTags).sort().map(function(k) { return allTags[k]; });

    if (tagList.length === 0) {
      UI.toast('No tags found — add tags to clients first');
      return;
    }

    // Default tags to suggest
    var defaultTags = ['VIP', 'Commercial', 'Residential', 'Repeat', 'Referral', 'Difficult Access', 'HOA', 'Property Manager', 'Emergency', 'Seasonal'];

    var html = '<div style="margin-bottom:16px;">'
      + '<div style="font-size:12px;font-weight:600;text-transform:uppercase;color:var(--text-light);margin-bottom:8px;">Active Tags</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    tagList.forEach(function(t) {
      html += '<button onclick="ClientsPage.setTagFilter(\'' + UI.esc(t.name).replace(/'/g, "\\'") + '\')" style="display:inline-flex;align-items:center;gap:4px;padding:6px 14px;background:var(--green-bg);border:1px solid #c8e6c9;border-radius:20px;font-size:13px;font-weight:600;color:var(--green-dark);cursor:pointer;">'
        + UI.esc(t.name) + ' <span style="background:var(--green-dark);color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;font-weight:700;">' + t.count + '</span></button>';
    });
    html += '</div></div>';

    // Suggested tags section
    var existingKeys = Object.keys(allTags);
    var suggestions = defaultTags.filter(function(t) { return existingKeys.indexOf(t.toLowerCase()) === -1; });
    if (suggestions.length) {
      html += '<div style="font-size:12px;font-weight:600;text-transform:uppercase;color:var(--text-light);margin-bottom:8px;margin-top:8px;">Suggested Tags</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
      suggestions.forEach(function(t) {
        html += '<span style="padding:6px 14px;background:var(--bg);border:1px dashed var(--border);border-radius:20px;font-size:13px;color:var(--text-light);">' + t + '</span>';
      });
      html += '</div>';
    }

    UI.showModal('Filter by Tag', html);
  },

  setTagFilter: function(tag) {
    ClientsPage._tagFilter = tag;
    ClientsPage._page = 0;
    UI.closeModal();
    loadPage('clients');
  },

  addTagToClient: function(clientId, tag) {
    var c = DB.clients.getById(clientId);
    if (!c) return;
    var tags = c.tags || [];
    var tagLower = tag.toLowerCase().trim();
    var exists = tags.some(function(t) { return t.toLowerCase() === tagLower; });
    if (!exists) {
      tags.push(tag.trim());
      DB.clients.update(clientId, { tags: tags });
      UI.toast('Tag added: ' + tag);
    }
  },

  _editNote: function(clientId) {
    var v = document.getElementById('client-note-view-' + clientId);
    var e = document.getElementById('client-note-edit-' + clientId);
    if (v) v.style.display = 'none';
    if (e) e.style.display = 'block';
    var ta = document.getElementById('client-note-ta-' + clientId);
    if (ta) ta.focus();
  },

  _cancelNote: function(clientId) {
    var v = document.getElementById('client-note-view-' + clientId);
    var e = document.getElementById('client-note-edit-' + clientId);
    if (v) v.style.display = 'block';
    if (e) e.style.display = 'none';
  },

  _saveNote: function(clientId) {
    var ta = document.getElementById('client-note-ta-' + clientId);
    if (!ta) return;
    var notes = ta.value.trim();
    DB.clients.update(clientId, { notes: notes });
    var v = document.getElementById('client-note-view-' + clientId);
    if (v) {
      v.textContent = notes || 'No notes yet. Click Edit to add notes.';
      v.style.color = notes ? 'var(--text)' : 'var(--text-light)';
      v.style.display = 'block';
    }
    var e = document.getElementById('client-note-edit-' + clientId);
    if (e) e.style.display = 'none';
    UI.toast('Notes saved');
  },

  _copyPortalLink: function(clientId) {
    var link = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/') + 'client.html?id=' + clientId;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(function() { UI.toast('Portal link copied!'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = link; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      UI.toast('Portal link copied!');
    }
  },

  _showContactPicker: function(clientId) {
    var c = DB.clients.getById(clientId);
    if (!c || !c.phone) return;
    var phoneClean = c.phone.replace(/\D/g, '');
    var telHref = 'tel:' + phoneClean;
    var smsHref = 'sms:' + phoneClean;
    var name = (c.name || '').replace(/'/g, "\\'");
    var dialpadConnected = false;
    try { dialpadConnected = !!JSON.parse(localStorage.getItem('bm-receptionist-settings') || '{}').connected; } catch(e) {}

    var html = '<div style="padding:8px 4px;">'
      + '<div style="font-size:22px;font-weight:700;margin-bottom:4px;">' + UI.esc(c.name || 'Contact') + '</div>'
      + '<div style="font-size:15px;color:var(--text-light);margin-bottom:20px;">' + UI.phone(c.phone) + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      // Call
      + '<a href="' + telHref + '" onclick="UI.closeModal();' + (dialpadConnected ? 'Dialpad.call(\'' + phoneClean + '\',\'' + clientId + '\',\'' + name + '\');' : '') + '" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px;background:var(--green-dark);color:#fff;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;">'
      + '<span style="font-size:32px;">📞</span><span>Call</span></a>'
      // Text
      + '<a href="' + smsHref + '" onclick="' + (dialpadConnected ? 'event.preventDefault();UI.closeModal();Dialpad.showTextModal(\'' + clientId + '\',\'' + name + '\',\'' + phoneClean + '\');' : 'UI.closeModal();') + '" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px;background:#7c3aed;color:#fff;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;">'
      + '<span style="font-size:32px;">💬</span><span>Text</span></a>'
      + '</div>'
      + (dialpadConnected ? '<div style="font-size:11px;color:var(--text-light);text-align:center;margin-top:14px;">Dialpad connected — calls & texts will sync to your inbox</div>' : '<div style="font-size:11px;color:var(--text-light);text-align:center;margin-top:14px;">Opens your phone\'s dialer. <a onclick="UI.closeModal();loadPage(\'receptionist\')" style="color:var(--accent);cursor:pointer;">Connect Dialpad</a> to log calls/texts automatically.</div>')
      + '</div>';

    UI.showModal('Contact ' + (c.name || ''), html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Close</button>'
    });
  },

  // Import contact from iPhone — pre-fills the New Client form
  _importVCard: function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vcf,text/vcard,text/x-vcard';
    input.onchange = function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        var vcf = ev.target.result;
        var p = ClientsPage._parseVCard(vcf);
        if (!p.name && !p.phones.length && !p.emails.length) {
          UI.toast('Could not parse contact', 'error');
          return;
        }
        // Pre-fill the existing form
        var first = p.firstName || (p.name || '').split(' ')[0] || '';
        var last = p.lastName || (p.name || '').split(' ').slice(1).join(' ') || '';
        var phoneEl = document.getElementById('c-phone');
        var emailEl = document.getElementById('c-email');
        var addrEl = document.getElementById('c-address');
        var coEl = document.getElementById('c-company');
        var firstEl = document.getElementById('c-first');
        var lastEl = document.getElementById('c-last');
        if (firstEl && !firstEl.value) firstEl.value = first;
        if (lastEl && !lastEl.value) lastEl.value = last;
        if (phoneEl && !phoneEl.value && p.phones[0]) phoneEl.value = p.phones[0];
        if (emailEl && !emailEl.value && p.emails[0]) emailEl.value = p.emails[0];
        if (addrEl && !addrEl.value && p.addresses[0]) addrEl.value = p.addresses[0];
        if (coEl && !coEl.value && p.org) coEl.value = p.org;
        UI.toast('Contact imported — review & save');
      };
      reader.readAsText(file);
    };
    input.click();
  },

  _parseVCard: function(text) {
    var lines = text.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
    var d = { name: '', firstName: '', lastName: '', phones: [], emails: [], addresses: [], org: '' };
    lines.forEach(function(line) {
      var m = line.match(/^([A-Z]+)(;[^:]+)?:(.+)$/i);
      if (!m) return;
      var field = m[1].toUpperCase();
      var value = m[3];
      if (field === 'FN') d.name = value.trim();
      else if (field === 'N') {
        var parts = value.split(';');
        d.lastName = (parts[0] || '').trim();
        d.firstName = (parts[1] || '').trim();
      }
      else if (field === 'TEL') d.phones.push(value.replace(/[^\d+]/g, '').replace(/^\+?1/, ''));
      else if (field === 'EMAIL') d.emails.push(value.trim());
      else if (field === 'ADR') {
        var a = value.split(';');
        var addr = [a[2], a[3], a[4], a[5]].filter(Boolean).join(', ');
        if (addr) d.addresses.push(addr);
      }
      else if (field === 'ORG') d.org = value.split(';')[0].trim();
    });
    return d;
  },

  _showPortalMenu: function(clientId) {
    var c = DB.clients.getById(clientId);
    if (!c) return;
    var link = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/') + 'client.html?id=' + clientId;
    var name = c.name || 'your client';
    var smsBody = 'Hi! Here\'s your ' + ClientsPage._co().name + ' portal where you can view quotes, invoices, and appointments: ' + link;
    var emailSubject = 'Your ' + ClientsPage._co().name + ' Portal';
    var emailBody = 'Hi ' + (name.split(' ')[0] || 'there') + ',\n\nHere\'s your client portal link where you can view quotes, approve work, pay invoices, and check appointments:\n\n' + link + '\n\nLet us know if you have any questions.\n\nThanks,\nDoug\n' + ClientsPage._co().name + '\n' + ClientsPage._co().phone;

    var html = '<div style="padding:4px 0;">'
      + '<div style="font-size:13px;color:var(--text-light);margin-bottom:12px;word-break:break-all;background:var(--bg);padding:8px;border-radius:6px;font-size:11px;">' + link + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:8px;">'
      + '<button onclick="navigator.clipboard?navigator.clipboard.writeText(\'' + link.replace(/'/g, "\\'") + '\').then(function(){UI.toast(\'Link copied!\');}):void(0);UI.closeModal();" class="btn btn-outline" style="justify-content:flex-start;">📋 Copy link</button>'
      + (c.phone ? '<a href="sms:' + c.phone.replace(/[^0-9+]/g,'') + '?body=' + encodeURIComponent(smsBody) + '" class="btn" style="background:#7c3aed;color:#fff;text-decoration:none;display:flex;align-items:center;">📱 Text to ' + c.phone + '</a>' : '')
      + (c.email ? '<a href="mailto:' + c.email + '?subject=' + encodeURIComponent(emailSubject) + '&body=' + encodeURIComponent(emailBody) + '" class="btn btn-primary" style="text-decoration:none;display:flex;align-items:center;">✉️ Email to ' + c.email + '</a>' : '')
      + '</div></div>';

    UI.modal('Share Client Portal — ' + name, html);
  },

  removeTagFromClient: function(clientId, tag) {
    var c = DB.clients.getById(clientId);
    if (!c) return;
    var tags = (c.tags || []).filter(function(t) { return t.toLowerCase() !== tag.toLowerCase(); });
    DB.clients.update(clientId, { tags: tags });
    UI.toast('Tag removed');
    ClientsPage.showDetail(clientId);
  },

  showAddTagModal: function(clientId) {
    var c = DB.clients.getById(clientId);
    if (!c) return;
    var existing = (c.tags || []).map(function(t) { return t.toLowerCase(); });

    // Collect all tags used across all clients for suggestions
    var allTags = {};
    DB.clients.getAll().forEach(function(cl) {
      if (cl.tags && cl.tags.length) {
        cl.tags.forEach(function(t) {
          var key = t.toLowerCase().trim();
          if (key && existing.indexOf(key) === -1) {
            allTags[key] = t.trim();
          }
        });
      }
    });

    var defaultTags = ['VIP', 'Commercial', 'Residential', 'Repeat', 'Referral', 'Difficult Access', 'HOA', 'Property Manager', 'Emergency', 'Seasonal'];
    var suggestTags = defaultTags.filter(function(t) { return existing.indexOf(t.toLowerCase()) === -1; });
    // Add any custom tags from other clients
    Object.keys(allTags).forEach(function(k) {
      if (suggestTags.map(function(s) { return s.toLowerCase(); }).indexOf(k) === -1) {
        suggestTags.push(allTags[k]);
      }
    });

    var html = '<div style="margin-bottom:16px;">'
      + '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">New Tag</label>'
      + '<div style="display:flex;gap:8px;">'
      + '<input type="text" id="new-tag-input" placeholder="Enter tag name..." style="flex:1;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;">'
      + '<button class="btn btn-primary" onclick="var v=document.getElementById(\'new-tag-input\').value.trim();if(v){ClientsPage.addTagToClient(\'' + clientId + '\',v);UI.closeModal();ClientsPage.showDetail(\'' + clientId + '\');}">Add</button>'
      + '</div></div>';

    if (suggestTags.length) {
      html += '<div style="font-size:12px;font-weight:600;text-transform:uppercase;color:var(--text-light);margin-bottom:8px;">Quick Add</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
      suggestTags.forEach(function(t) {
        html += '<button onclick="ClientsPage.addTagToClient(\'' + clientId + '\',\'' + t.replace(/'/g, "\\'") + '\');UI.closeModal();ClientsPage.showDetail(\'' + clientId + '\');" style="padding:6px 14px;background:var(--bg);border:1px solid var(--border);border-radius:20px;font-size:13px;cursor:pointer;font-weight:500;">' + UI.esc(t) + '</button>';
      });
      html += '</div>';
    }

    UI.showModal('Add Tag to ' + UI.esc(c.name), html);
  },

  showForm: function(id) {
    var c = id ? DB.clients.getById(id) : {};
    var title = id ? 'Edit Client' : 'New Client';

    // Split existing name into first/last if present (for edits)
    var _fn = c.firstName || '';
    var _ln = c.lastName || '';
    if (!_fn && !_ln && c.name) {
      var _parts = (c.name || '').trim().split(/\s+/);
      _fn = _parts[0] || '';
      _ln = _parts.slice(1).join(' ') || '';
    }

    var html = '<form id="client-form" onsubmit="ClientsPage.save(event, \'' + (id || '') + '\')">'
      + (id ? '' : '<div style="background:var(--bg);border:1px dashed var(--border);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">'
        + '<div style="font-size:13px;color:var(--text-light);">📇 Import from iPhone Contacts (vCard)</div>'
        + '<button type="button" class="btn btn-outline" style="font-size:12px;padding:6px 12px;" onclick="ClientsPage._importVCard()">Import .vcf</button>'
        + '</div>')
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + UI.formField('First Name *', 'text', 'c-first', _fn, { required: true, placeholder: 'First' })
      + UI.formField('Last Name', 'text', 'c-last', _ln, { placeholder: 'Last' })
      + '</div>'
      + UI.formField('Company', 'text', 'c-company', c.company, { placeholder: 'Company name (optional)' })
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + UI.formField('Phone *', 'tel', 'c-phone', c.phone, { required: true, placeholder: '(914) 555-0000' })
      + UI.formField('Email', 'email', 'c-email', c.email, { placeholder: 'email@example.com' })
      + '</div>'
      + UI.formField('Address', 'text', 'c-address', c.address, { placeholder: 'Street, City, State ZIP' })
      + UI.formField('Status', 'select', 'c-status', c.status || 'lead', { options: [{value:'lead',label:'Lead'},{value:'active',label:'Active'}] })
      + UI.formField('Tags', 'text', 'c-tags', (c.tags || []).join(', '), { placeholder: 'residential, commercial (comma separated)' })
      + UI.formField('Notes', 'textarea', 'c-notes', c.notes, { placeholder: 'Internal notes...' })
      + '</form>';

    UI.showModal(title, html, {
      footer: (id ? '<button class="btn" style="background:#c0392b;color:#fff;margin-right:auto;" onclick="ClientsPage.remove(\'' + id + '\')">Delete</button>' : '')
        + '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="document.getElementById(\'client-form\').requestSubmit()">Save Client</button>'
    });
  },

  save: function(e, id) {
    e.preventDefault();
    var _fn = (document.getElementById('c-first') || {}).value || '';
    var _ln = (document.getElementById('c-last') || {}).value || '';
    _fn = _fn.trim(); _ln = _ln.trim();
    var data = {
      firstName: _fn,
      lastName: _ln,
      name: (_fn + ' ' + _ln).trim(),
      company: document.getElementById('c-company').value.trim(),
      phone: document.getElementById('c-phone').value.trim(),
      email: document.getElementById('c-email').value.trim(),
      address: document.getElementById('c-address').value.trim(),
      status: document.getElementById('c-status').value,
      tags: document.getElementById('c-tags').value.split(',').map(function(t) { return t.trim(); }).filter(Boolean),
      notes: document.getElementById('c-notes').value.trim()
    };
    if (!data.name) { UI.toast('Name is required', 'error'); return; }

    if (id) {
      DB.clients.update(id, data);
      UI.toast('Client updated');
    } else {
      DB.clients.create(data);
      UI.toast('Client created');
    }
    UI.closeModal();
    loadPage('clients');
  },

  remove: function(id) {
    UI.confirm('Delete this client? This cannot be undone.', function() {
      DB.clients.remove(id);
      UI.toast('Client deleted');
      UI.closeModal();
      loadPage('clients');
    });
  },

  showDetail: function(id) {
    try { return ClientsPage._showDetailImpl(id); }
    catch(err) {
      console.error('[ClientsPage.showDetail] ERROR:', err);
      alert('Error opening client: ' + (err && err.message ? err.message : err) + '\n\nSee console for details.');
      var pc = document.getElementById('pageContent');
      if (pc) pc.innerHTML = '<div style="padding:20px;"><h2>Error loading client</h2><pre style="background:#fee;padding:12px;border-radius:8px;overflow:auto;">' + (err && err.stack ? err.stack : String(err)) + '</pre><button onclick="loadPage(\'clients\')" style="padding:10px 20px;background:#1b5e20;color:#fff;border:none;border-radius:8px;">← Back to Clients</button></div>';
    }
  },

  _showDetailImpl: function(id) {
    console.log('[ClientsPage.showDetail] called with id:', id);
    var c = DB.clients.getById(id);
    if (!c) {
      console.warn('[ClientsPage] Client not found:', id);
      if (typeof UI !== 'undefined' && UI.toast) UI.toast('Client not found: ' + id, 'error');
      else alert('Client not found: ' + id);
      return;
    }
    // Scroll to top so user sees the detail
    window.scrollTo(0, 0);
    var scrollable = document.querySelector('.content') || document.querySelector('.main');
    if (scrollable) scrollable.scrollTop = 0;

    // Get related records (match by clientId OR clientName since imports may not have IDs linked)
    var cName = (c.name || '').trim().toLowerCase();
    var clientJobs = DB.jobs.getAll().filter(function(j) { return j.clientId === id || (j.clientName || '').trim().toLowerCase() === cName; });
    var clientInvoices = DB.invoices.getAll().filter(function(i) { return i.clientId === id || (i.clientName || '').trim().toLowerCase() === cName; });
    var clientQuotes = DB.quotes.getAll().filter(function(q) { return q.clientId === id || (q.clientName || '').trim().toLowerCase() === cName; });
    var totalRevenue = clientInvoices.filter(function(i) { return i.status === 'paid'; }).reduce(function(s, i) { return s + (i.total || 0); }, 0);
    var totalOutstanding = clientInvoices.filter(function(i) { return i.status !== 'paid'; }).reduce(function(s, i) { return s + (i.balance || i.total || 0); }, 0);
    var totalInvoiced = clientInvoices.reduce(function(s, i) { return s + (i.total || 0); }, 0);
    var completedJobs = clientJobs.filter(function(j) { return j.status === 'completed'; });
    var sortedJobsByDate = clientJobs.slice().sort(function(a, b) { return (b.scheduledDate || b.createdAt || '') > (a.scheduledDate || a.createdAt || '') ? 1 : -1; });
    var lastJobDate = sortedJobsByDate.length ? (sortedJobsByDate[0].scheduledDate || sortedJobsByDate[0].createdAt) : null;

    // previous system-style client detail
    var html = ''
      // Breadcrumb
      + '<div style="font-size:13px;color:var(--text-light);margin-bottom:12px;">'
      + '<a onclick="loadPage(\'clients\')" style="color:var(--text-light);cursor:pointer;text-decoration:none;">' + BM_CONFIG.companyName + '</a>'
      + ' | <span style="color:var(--text);">' + UI.esc(c.name) + '</span></div>'

      // Action buttons (right-aligned)
      + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:16px;flex-wrap:wrap;">'
      + (c.phone ? '<button class="btn" style="background:var(--green-dark);color:#fff;" onclick="Dialpad.call(\'' + c.phone.replace(/'/g, '') + '\',\'' + id + '\',\'' + (c.name || '').replace(/'/g, "\\'") + '\')">📞 Call</button>' : '')
      + (c.phone ? '<button class="btn" style="background:#7c3aed;color:#fff;" onclick="Dialpad.showTextModal(\'' + id + '\',\'' + (c.name || '').replace(/'/g, "\\'") + '\',\'' + (c.phone || '').replace(/'/g, '') + '\')">💬 Text</button>' : '')
      + (c.email ? '<button class="btn btn-primary" onclick="window.location.href=\'mailto:' + c.email + '\'">✉️ Email</button>' : '')
      + '<button class="btn btn-outline" onclick="ClientsPage.showForm(\'' + id + '\')">✏️ Edit</button>'
      + '<button class="btn btn-outline" onclick="ClientsPage._showPortalMenu(\'' + id + '\')" title="Share client portal">🔗 Portal ▾</button>'
      + '<button class="btn btn-outline" style="font-size:12px;" onclick="ClientsPage.showStatement(\'' + id + '\')">📄 Statement</button>'
      + '</div>'

      // Client name (big, like previous system)
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">'
      + '<div style="width:48px;height:48px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--text-light);">👤</div>'
      + '<h2 style="font-size:28px;font-weight:700;">' + UI.esc(c.name) + '</h2>'
      + '</div>'

      // Quick Stats row
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--white);margin-bottom:16px;">'
      + '<div style="padding:14px 16px;border-right:1px solid var(--border);">'
      + '<div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-light);letter-spacing:.05em;">Total Jobs</div>'
      + '<div style="font-size:26px;font-weight:700;margin-top:4px;">' + clientJobs.length + '</div>'
      + '</div>'
      + '<div style="padding:14px 16px;border-right:1px solid var(--border);">'
      + '<div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-light);letter-spacing:.05em;">Total Invoiced</div>'
      + '<div style="font-size:26px;font-weight:700;margin-top:4px;">' + UI.moneyInt(totalInvoiced) + '</div>'
      + '</div>'
      + '<div style="padding:14px 16px;border-right:1px solid var(--border);">'
      + '<div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-light);letter-spacing:.05em;">Balance Due</div>'
      + '<div style="font-size:26px;font-weight:700;margin-top:4px;' + (totalOutstanding > 0 ? 'color:var(--red);' : 'color:var(--green-dark);') + '">' + UI.moneyInt(totalOutstanding) + '</div>'
      + '</div>'
      + '<div style="padding:14px 16px;">'
      + '<div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-light);letter-spacing:.05em;">Last Job</div>'
      + '<div style="font-size:16px;font-weight:700;margin-top:6px;">' + (lastJobDate ? UI.dateShort(lastJobDate) : '<span style="color:var(--text-light);font-size:13px;">None</span>') + '</div>'
      + '</div>'
      + '</div>'

      // Quick Actions bar
      + '<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">'
      + '<button class="btn btn-primary" style="font-size:13px;" onclick="QuotesPage.showForm(null,\'' + id + '\')">+ New Quote</button>'
      + '<button class="btn btn-primary" style="font-size:13px;" onclick="JobsPage.showForm(null,\'' + id + '\')">+ New Job</button>'
      + '<button class="btn btn-primary" style="font-size:13px;" onclick="InvoicesPage.showForm(null,\'' + id + '\')">+ New Invoice</button>'
      + '</div>'

      // Two column: Properties (left) + Contact info (right)
      + '<div class="detail-grid" style="display:grid;grid-template-columns:1.2fr 1fr;gap:20px;">'

      // Left — Properties card
      + '<div>'
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<h3 style="font-size:18px;font-weight:700;">Properties</h3>'
      + '<button class="btn btn-outline" style="font-size:12px;padding:5px 12px;" onclick="ClientsPage.showForm(\'' + id + '\')">+ New Property</button>'
      + '</div>'
      + (c.address ? '<a href="https://maps.apple.com/?daddr=' + encodeURIComponent(c.address) + '" target="_blank" style="display:flex;gap:12px;align-items:start;text-decoration:none;color:inherit;padding:4px;border-radius:6px;transition:background .15s;" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">'
        + '<div style="width:36px;height:36px;border-radius:8px;background:#e8f5e9;display:flex;align-items:center;justify-content:center;color:#2e7d32;flex-shrink:0;">📍</div>'
        + '<div style="font-size:14px;line-height:1.6;flex:1;">' + UI.esc(c.address).replace(/,/g, '<br>') + '<div style="font-size:11px;color:var(--accent);margin-top:2px;">Open in Maps →</div></div>'
        + '</a>' : '<div style="color:var(--text-light);font-size:13px;">No property address</div>')
      + '</div>'

      // Schedule section
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
      + '<h3 style="font-size:18px;font-weight:700;">Schedule</h3>'
      + '<button class="btn btn-outline" style="font-size:12px;padding:5px 12px;" onclick="JobsPage.showForm(null,\'' + id + '\')">New</button>'
      + '</div>';
    var upcomingJobs = clientJobs.filter(function(j){ return j.status==='scheduled'||j.status==='in_progress'; });
    var overdueJobs = clientJobs.filter(function(j){ return j.status==='late'; });
    if (overdueJobs.length) {
      html += '<div style="color:#dc3545;font-size:13px;font-weight:600;margin-bottom:8px;">Overdue</div>';
      overdueJobs.forEach(function(j) {
        html += '<div style="padding:8px 0;border-bottom:1px solid var(--bg);font-size:13px;cursor:pointer;" onclick="JobsPage.showDetail(\'' + j.id + '\')">'
          + '<strong>' + (j.description || 'Job #' + j.jobNumber) + '</strong><br>'
          + '<span style="color:var(--text-light);">' + UI.dateShort(j.scheduledDate) + '</span></div>';
      });
    }
    if (upcomingJobs.length) {
      upcomingJobs.forEach(function(j) {
        html += '<div style="padding:8px 0;border-bottom:1px solid var(--bg);font-size:13px;cursor:pointer;" onclick="JobsPage.showDetail(\'' + j.id + '\')">'
          + '<strong>' + (j.description || 'Job #' + j.jobNumber) + '</strong><br>'
          + '<span style="color:var(--text-light);">' + UI.dateShort(j.scheduledDate) + '</span></div>';
      });
    }
    if (!upcomingJobs.length && !overdueJobs.length) {
      html += '<div style="color:var(--text-light);font-size:13px;">No upcoming schedule</div>';
    }
    html += '</div>'

      // Recent pricing
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:20px;">'
      + '<h3 style="font-size:18px;font-weight:700;margin-bottom:12px;">Recent pricing for this property</h3>';
    var recentLineItems = [];
    clientQuotes.forEach(function(q) {
      if (q.lineItems) q.lineItems.forEach(function(li) {
        recentLineItems.push({ service: li.service, quoted: li.amount || (li.qty * li.rate), type: 'quoted' });
      });
    });
    if (recentLineItems.length) {
      html += '<table style="width:100%;font-size:13px;border-collapse:collapse;">'
        + '<tr style="text-transform:uppercase;font-size:10px;font-weight:600;color:var(--text-light);letter-spacing:.05em;"><td style="padding:6px 0;">Line Item</td><td style="padding:6px 0;text-align:right;">Quoted</td></tr>';
      recentLineItems.slice(0, 5).forEach(function(li) {
        html += '<tr><td style="padding:6px 0;">' + (li.service || 'Custom') + '</td><td style="padding:6px 0;text-align:right;">' + UI.money(li.quoted) + '</td></tr>';
      });
      html += '</table>';
    } else {
      // Fall back to recent completed jobs as pricing reference
      var recentJobs = clientJobs.filter(function(j) { return j.status === 'completed' && j.total > 0; })
        .sort(function(a, b) { return (b.scheduledDate || b.createdAt || '') > (a.scheduledDate || a.createdAt || '') ? 1 : -1; })
        .slice(0, 5);
      if (recentJobs.length) {
        html += '<table style="width:100%;font-size:13px;border-collapse:collapse;">'
          + '<tr style="text-transform:uppercase;font-size:10px;font-weight:600;color:var(--text-light);letter-spacing:.05em;"><td style="padding:6px 0;">Job</td><td style="padding:6px 0;">Date</td><td style="padding:6px 0;text-align:right;">Total</td></tr>';
        recentJobs.forEach(function(j) {
          var dateStr = j.scheduledDate ? new Date(j.scheduledDate).toLocaleDateString('en-US', {month:'short', year:'numeric'}) : '—';
          html += '<tr><td style="padding:5px 0;">' + UI.esc(j.description || 'Job #' + j.jobNumber) + '</td>'
            + '<td style="padding:5px 0;color:var(--text-light);">' + dateStr + '</td>'
            + '<td style="padding:5px 0;text-align:right;font-weight:600;">' + UI.moneyInt(j.total) + '</td></tr>';
        });
        html += '</table>';
      } else {
        html += '<div style="color:var(--text-light);font-size:13px;">No pricing history</div>';
      }
    }
    html += '</div></div>'

      // Right — Contact info + Tags + Internal notes
      + '<div>'
      + '<div style="margin-bottom:16px;">'
      + '<h3 style="font-size:18px;font-weight:700;margin-bottom:12px;">Contact info</h3>'
      + '<table style="width:100%;font-size:14px;border-collapse:collapse;">'
      + (c.phone ? '<tr><td style="padding:8px 0;color:var(--text-light);width:60px;">Main</td><td style="padding:8px 0;"><a onclick="ClientsPage._showContactPicker(\'' + id + '\')" style="color:var(--accent);text-decoration:none;cursor:pointer;font-weight:600;">' + UI.phone(c.phone) + '</a> <span style="font-size:11px;color:var(--text-light);margin-left:6px;">tap to call/text</span></td></tr>' : '')
      + (c.email ? '<tr><td style="padding:8px 0;color:var(--text-light);">Main</td><td style="padding:8px 0;"><a href="mailto:' + c.email + '" style="color:#1565c0;text-decoration:none;">' + c.email + '</a></td></tr>' : '')
      + '<tr><td style="padding:8px 0;color:var(--text-light);">Status</td><td style="padding:8px 0;">' + UI.statusBadge(c.status) + '</td></tr>'
      + '<tr><td style="padding:8px 0;color:var(--text-light);">Revenue</td><td style="padding:8px 0;font-weight:600;">' + UI.moneyInt(totalRevenue) + '</td></tr>'
      + '<tr><td style="padding:8px 0;color:var(--text-light);">Owed</td><td style="padding:8px 0;' + (totalOutstanding > 0 ? 'color:var(--red);font-weight:600;' : '') + '">' + UI.moneyInt(totalOutstanding) + '</td></tr>'
      + '</table></div>'

      // Tags
      + '<div style="margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
      + '<h3 style="font-size:18px;font-weight:700;">Tags</h3>'
      + '<button class="btn btn-outline" style="font-size:12px;padding:4px 10px;" onclick="ClientsPage.showAddTagModal(\'' + id + '\')">+ Add Tag</button>'
      + '</div>'
      + (c.tags && c.tags.length ? (function() { var seen = {}; var uniq = c.tags.filter(function(t) { var k = t.toLowerCase(); return seen[k] ? false : (seen[k] = true); }); return '<div style="display:flex;gap:4px;flex-wrap:wrap;">' + uniq.map(function(t) { return '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px 4px 12px;background:var(--green-bg);border:1px solid #c8e6c9;border-radius:20px;font-size:12px;font-weight:600;color:var(--green-dark);">' + UI.esc(t) + '<button onclick="event.stopPropagation();ClientsPage.removeTagFromClient(\'' + id + '\',\'' + t.replace(/'/g, "\\'") + '\')" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--text-light);padding:0 2px;line-height:1;" title="Remove tag">×</button></span>'; }).join('') + '</div>'; })() : '<div style="font-size:13px;color:var(--text-light);font-style:italic;">No tags — add tags to organize clients</div>')
      + '</div>';

    // Custom fields
    if (typeof CustomFields !== 'undefined') {
      html += CustomFields.renderDisplay('client', id);
    }

    html += // Internal notes — inline editable
        '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
      + '<h3 style="font-size:18px;font-weight:700;">Internal notes</h3>'
      + '<button onclick="ClientsPage._editNote(\'' + id + '\')" style="background:none;border:none;cursor:pointer;font-size:13px;color:var(--accent);font-weight:600;">✏️ Edit</button>'
      + '</div>'
      + '<div style="font-size:12px;color:var(--text-light);margin-bottom:8px;">Only visible to your team</div>'
      + '<div id="client-note-view-' + id + '" style="font-size:13px;color:' + (c.notes ? 'var(--text)' : 'var(--text-light)') + ';line-height:1.6;padding:8px;background:var(--bg);border-radius:6px;min-height:40px;">' + (c.notes ? UI.esc(c.notes) : 'No notes yet. Click Edit to add notes.') + '</div>'
      + '<div id="client-note-edit-' + id + '" style="display:none;">'
      + '<textarea id="client-note-ta-' + id + '" style="width:100%;height:100px;border:2px solid var(--accent);border-radius:6px;padding:8px;font-size:13px;resize:vertical;">' + UI.esc(c.notes || '') + '</textarea>'
      + '<div style="display:flex;gap:6px;margin-top:6px;">'
      + '<button onclick="ClientsPage._saveNote(\'' + id + '\')" style="background:var(--green-dark);color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Save</button>'
      + '<button onclick="ClientsPage._cancelNote(\'' + id + '\')" style="background:none;border:1px solid var(--border);padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;">Cancel</button>'
      + '</div></div>'
      + '</div>'
      + '</div></div>'

      // Right content — tabs
      + '<div>'
      + '<div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:16px;">'
      + '<button class="cd-tab active" onclick="ClientsPage._tab(this,\'cd-jobs\');" style="padding:10px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid var(--accent);margin-bottom:-2px;color:var(--accent);">Jobs (' + clientJobs.length + ')</button>'
      + '<button class="cd-tab" onclick="ClientsPage._tab(this,\'cd-quotes\');" style="padding:10px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-light);">Quotes (' + clientQuotes.length + ')</button>'
      + '<button class="cd-tab" onclick="ClientsPage._tab(this,\'cd-invoices\');" style="padding:10px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-light);">Invoices (' + clientInvoices.length + ')</button>'
      + '<button class="cd-tab" onclick="ClientsPage._tab(this,\'cd-activity\');" style="padding:10px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-light);">Activity</button>'
      + '<button class="cd-tab" onclick="ClientsPage._tab(this,\'cd-photos\');" style="padding:10px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-light);">📷 Photos</button>'
      + '<button class="cd-tab" onclick="ClientsPage._tab(this,\'cd-trees\');" style="padding:10px 20px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-light);">🌳 Trees (' + TreeInventory.getForClient(id).length + ')</button>'
      + '</div>'

      // Jobs tab — last 10, sorted newest first
      + '<div id="cd-jobs" class="cd-panel">'
      + (clientJobs.length ? (function() {
          var sorted = clientJobs.slice().sort(function(a,b){ return (b.scheduledDate||b.createdAt||'') > (a.scheduledDate||a.createdAt||'') ? 1 : -1; });
          var shown = sorted.slice(0, 10);
          var moreCount = sorted.length - shown.length;
          return '<table class="data-table"><thead><tr><th>Date</th><th>Description</th><th>Status</th><th style="text-align:right;">Value</th></tr></thead><tbody>'
            + shown.map(function(j) {
              return '<tr style="cursor:pointer;" onclick="JobsPage.showDetail(\'' + j.id + '\')">'
                + '<td style="white-space:nowrap;color:var(--text-light);font-size:12px;">' + UI.dateShort(j.scheduledDate) + '</td>'
                + '<td>' + UI.esc(j.description || 'Job #' + (j.jobNumber || '—')) + '</td>'
                + '<td>' + UI.statusBadge(j.status) + '</td>'
                + '<td style="text-align:right;font-weight:600;">' + UI.moneyInt(j.total) + '</td>'
                + '</tr>';
            }).join('')
            + '</tbody></table>'
            + (moreCount > 0 ? '<div style="text-align:center;padding:10px;font-size:13px;color:var(--text-light);">Showing 10 of ' + sorted.length + ' jobs — <a onclick="ClientsPage._tab(document.querySelector(\'.cd-tab[onclick*=cd-jobs]\'),\'cd-jobs\')" style="color:var(--accent);cursor:pointer;">view all in Jobs page</a></div>' : '');
        })() : UI.emptyState('🔧', 'No jobs yet', 'Create a job for this client.', '+ New Job', 'JobsPage.showForm(null,\'' + id + '\')'))
      + '</div>'

      // Quotes tab
      + '<div id="cd-quotes" class="cd-panel" style="display:none;">'
      + (clientQuotes.length ? (function() {
          var sortedQ = clientQuotes.slice().sort(function(a,b){ return (b.createdAt||'') > (a.createdAt||'') ? 1 : -1; });
          return '<table class="data-table"><thead><tr><th>#</th><th>Date</th><th>Description</th><th>Status</th><th>Total</th></tr></thead><tbody>'
            + sortedQ.map(function(q) {
              return '<tr style="cursor:pointer;" onclick="QuotesPage._pendingDetail=\'' + q.id + '\';loadPage(\'quotes\')"><td><strong>' + (q.quoteNumber || '—') + '</strong></td>'
                + '<td style="white-space:nowrap;color:var(--text-light);font-size:12px;">' + UI.dateShort(q.createdAt) + '</td>'
                + '<td>' + UI.esc(q.description || '—') + '</td><td>' + UI.statusBadge(q.status) + '</td><td style="font-weight:600;">' + UI.money(q.total) + '</td></tr>';
            }).join('') + '</tbody></table>';
        })() : UI.emptyState('📋', 'No quotes yet', 'Create a quote for this client.', '+ New Quote', 'QuotesPage.showForm(null,\'' + id + '\')'))
      + '</div>'

      // Invoices tab — last 10, sorted newest first
      + '<div id="cd-invoices" class="cd-panel" style="display:none;">'
      + (clientInvoices.length ? (function() {
          var sorted = clientInvoices.slice().sort(function(a,b){ return (b.createdAt||b.issueDate||'') > (a.createdAt||a.issueDate||'') ? 1 : -1; });
          var shown = sorted.slice(0, 10);
          var moreCount = sorted.length - shown.length;
          return '<table class="data-table"><thead><tr><th>#</th><th>Date</th><th>Status</th><th style="text-align:right;">Amount</th></tr></thead><tbody>'
            + shown.map(function(inv) {
              return '<tr style="cursor:pointer;" onclick="InvoicesPage.showDetail(\'' + inv.id + '\')">'
                + '<td><strong>' + (inv.invoiceNumber || '—') + '</strong></td>'
                + '<td style="white-space:nowrap;color:var(--text-light);font-size:12px;">' + UI.dateShort(inv.issueDate || inv.createdAt) + '</td>'
                + '<td>' + UI.statusBadge(inv.status) + '</td>'
                + '<td style="text-align:right;font-weight:600;' + ((inv.balance||0) > 0 ? 'color:var(--red)' : 'color:var(--green-dark)') + ';">' + UI.money(inv.total || 0) + '</td>'
                + '</tr>';
            }).join('')
            + '</tbody></table>'
            + (moreCount > 0 ? '<div style="text-align:center;padding:10px;font-size:13px;color:var(--text-light);">Showing 10 of ' + sorted.length + ' invoices</div>' : '');
        })() : UI.emptyState('💰', 'No invoices yet', 'Create an invoice for this client.', '+ New Invoice', 'InvoicesPage.showForm(null,\'' + id + '\')'))
      + '</div>'

      // Activity timeline tab
      + '<div id="cd-activity" class="cd-panel" style="display:none;">';

    // Build timeline from all client data
    var timeline = [];
    clientQuotes.forEach(function(q) {
      timeline.push({ date: q.createdAt, type: 'quote', icon: '📋', color: '#8b2252',
        title: 'Quote #' + q.quoteNumber + ' created', detail: q.description || '', amount: q.total, status: q.status,
        onclick: "QuotesPage.showDetail('" + q.id + "')" });
      if (q.status === 'sent' || q.status === 'awaiting') {
        timeline.push({ date: q.sentAt || q.createdAt, type: 'quote_sent', icon: '📤', color: '#1565c0',
          title: 'Quote #' + q.quoteNumber + ' sent to client', detail: '', amount: q.total });
      }
      if (q.status === 'approved') {
        timeline.push({ date: q.approvedAt || q.createdAt, type: 'quote_approved', icon: '✅', color: '#2e7d32',
          title: 'Quote #' + q.quoteNumber + ' approved', detail: '', amount: q.total });
      }
    });
    clientJobs.forEach(function(j) {
      timeline.push({ date: j.createdAt, type: 'job', icon: '🔧', color: '#2e7d32',
        title: 'Job #' + j.jobNumber + ' created', detail: j.description || '', amount: j.total, status: j.status,
        onclick: "JobsPage.showDetail('" + j.id + "')" });
      if (j.status === 'completed') {
        timeline.push({ date: j.completedAt || j.scheduledDate || j.createdAt, type: 'job_done', icon: '✅', color: '#2e7d32',
          title: 'Job #' + j.jobNumber + ' completed', detail: '' });
      }
    });
    clientInvoices.forEach(function(inv) {
      timeline.push({ date: inv.createdAt, type: 'invoice', icon: '💰', color: '#1565c0',
        title: 'Invoice #' + inv.invoiceNumber + ' created', detail: inv.subject || '', amount: inv.total, status: inv.status,
        onclick: "InvoicesPage.showDetail('" + inv.id + "')" });
      if (inv.status === 'paid') {
        timeline.push({ date: inv.paidAt || inv.createdAt, type: 'payment', icon: '💵', color: '#2e7d32',
          title: 'Payment received — Invoice #' + inv.invoiceNumber, detail: '', amount: inv.total });
      }
    });
    // Satisfaction ratings
    clientJobs.forEach(function(j) {
      if (j.satisfaction && j.satisfaction.rating) {
        var stars = '';
        for (var s = 1; s <= 5; s++) stars += s <= j.satisfaction.rating ? '⭐' : '☆';
        timeline.push({ date: j.satisfaction.ratedAt || j.completedAt || j.createdAt, type: 'rating', icon: '😊', color: '#ffc107',
          title: 'Client rated Job #' + j.jobNumber + ' — ' + stars + ' (' + j.satisfaction.rating + '/5)',
          detail: j.satisfaction.comment || '' });
      }
    });
    // Communication log entries
    if (typeof CommsLog !== 'undefined') {
      var comms = CommsLog.getAll(id);
      comms.forEach(function(comm) {
        var icons = { call: '📞', text: '💬', email: '📧', note: '📌', visit: '🏠', voicemail: '📱' };
        var dirLabel = comm.direction === 'inbound' ? '← Inbound' : '→ Outbound';
        timeline.push({ date: comm.date, type: 'comm', icon: icons[comm.type] || '📋', color: comm.direction === 'inbound' ? '#2980b9' : '#27ae60',
          title: (comm.type || 'Note').charAt(0).toUpperCase() + (comm.type || 'note').slice(1) + ' ' + dirLabel,
          detail: comm.notes || '' });
      });
    }
    // Client notes
    if (c.notes) {
      timeline.push({ date: c.createdAt, type: 'note', icon: '📝', color: '#666',
        title: 'Internal note added', detail: c.notes });
    }
    // Client created
    timeline.push({ date: c.createdAt, type: 'created', icon: '👤', color: '#999',
      title: 'Client record created', detail: c.source ? 'Source: ' + c.source : '' });

    timeline.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

    if (timeline.length > 0) {
      html += '<div style="position:relative;padding-left:28px;">';
      // Vertical line
      html += '<div style="position:absolute;left:12px;top:8px;bottom:8px;width:2px;background:var(--border);"></div>';
      timeline.forEach(function(ev) {
        html += '<div style="position:relative;margin-bottom:16px;' + (ev.onclick ? 'cursor:pointer;' : '') + '"' + (ev.onclick ? ' onclick="' + ev.onclick + '"' : '') + '>'
          + '<div style="position:absolute;left:-24px;top:2px;width:20px;height:20px;border-radius:50%;background:' + ev.color + ';display:flex;align-items:center;justify-content:center;font-size:10px;z-index:1;">' + ev.icon + '</div>'
          + '<div style="font-size:11px;color:var(--text-light);margin-bottom:2px;">' + UI.dateRelative(ev.date) + '</div>'
          + '<div style="font-weight:600;font-size:13px;">' + ev.title
          + (ev.amount ? ' <span style="color:var(--green-dark);">' + UI.moneyInt(ev.amount) + '</span>' : '')
          + (ev.status ? ' ' + UI.statusBadge(ev.status) : '') + '</div>'
          + (ev.detail ? '<div style="font-size:12px;color:var(--text-light);margin-top:2px;">' + UI.esc(ev.detail) + '</div>' : '')
          + '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="text-align:center;padding:24px;color:var(--text-light);">No activity yet</div>';
    }

    // Communication log
    if (typeof CommsLog !== 'undefined') {
      html += CommsLog.renderForClient(id);
    }

    html += '</div>';

    // Photos tab panel
    html += '<div id="cd-photos" class="cd-panel" style="display:none;">';
    if (typeof Photos !== 'undefined') {
      html += Photos.renderGallery('client', id);
    } else {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--text-light);">No photo module loaded</div>';
    }
    html += '</div>';

    // Trees tab panel
    html += '<div id="cd-trees" class="cd-panel" style="display:none;">';
    var clientTrees = TreeInventory.getForClient(id);
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">'
      + '<div style="font-size:13px;color:var(--text-light);">' + clientTrees.length + ' tree' + (clientTrees.length !== 1 ? 's' : '') + ' on record</div>'
      + '<button class="btn btn-primary" style="font-size:12px;padding:6px 14px;" onclick="TreeInventory.showForm(\'' + id + '\')">+ Add Tree</button>'
      + '</div>';
    if (clientTrees.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--text-light);">'
        + '<div style="font-size:40px;margin-bottom:10px;">🌳</div>'
        + '<h3 style="font-size:16px;color:var(--text);margin-bottom:6px;">No trees logged yet</h3>'
        + '<p style="font-size:13px;max-width:320px;margin:0 auto 16px;">Record trees on this property — species, DBH, condition, and work needed. Helpful for quoting and risk assessment.</p>'
        + '<button class="btn btn-primary" onclick="TreeInventory.showForm(\'' + id + '\')">+ Log First Tree</button>'
        + '</div>';
    } else {
      html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;overflow:hidden;">'
        + '<table class="data-table"><thead><tr>'
        + '<th>#</th><th>Species</th><th>DBH</th><th>Est. Height</th><th>Condition</th><th>Work Needed</th><th style="width:36px;"></th>'
        + '</tr></thead><tbody>';
      clientTrees.forEach(function(t, idx) {
        var condColor = { 'Excellent': '#00836c', 'Good': '#2e7d32', 'Fair': '#e6a817', 'Poor': '#e07c24', 'Hazard': '#dc3545' }[t.condition] || 'var(--text-light)';
        html += '<tr onclick="TreeInventory.showDetail(\'' + t.id + '\')" style="cursor:pointer;">'
          + '<td style="font-weight:600;color:var(--text-light);">' + (idx + 1) + '</td>'
          + '<td><strong>' + UI.esc(t.species || 'Unknown') + '</strong>'
          + (t.location ? '<br><span style="font-size:11px;color:var(--text-light);">📍 ' + UI.esc(t.location) + '</span>' : '')
          + '</td>'
          + '<td style="font-weight:600;">' + (t.dbh ? t.dbh + '"' : '—') + '</td>'
          + '<td>' + (t.height ? '~' + t.height + ' ft' : '—') + '</td>'
          + '<td><span style="font-weight:600;color:' + condColor + ';">' + UI.esc(t.condition || '—') + '</span></td>'
          + '<td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + UI.esc(t.workNeeded || '—') + '</td>'
          + '<td><button onclick="event.stopPropagation();TreeInventory.showForm(\'' + id + '\',\'' + t.id + '\')" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--text-light);" title="Edit">✏️</button></td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';

      // Summary stats
      var withWork = clientTrees.filter(function(t){return t.workNeeded && t.workNeeded.trim();});
      var hazards = clientTrees.filter(function(t){return t.condition === 'Hazard';});
      var poor = clientTrees.filter(function(t){return t.condition === 'Poor';});
      if (withWork.length || hazards.length) {
        html += '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;">';
        if (hazards.length) html += '<div style="flex:1;min-width:140px;background:#fde8e8;border-radius:8px;padding:10px 14px;"><div style="font-size:11px;font-weight:600;color:#842029;text-transform:uppercase;letter-spacing:.05em;">⚠️ Hazard Trees</div><div style="font-size:24px;font-weight:700;color:#842029;">' + hazards.length + '</div></div>';
        if (poor.length) html += '<div style="flex:1;min-width:140px;background:#fff3e0;border-radius:8px;padding:10px 14px;"><div style="font-size:11px;font-weight:600;color:#e07c24;text-transform:uppercase;letter-spacing:.05em;">Poor Condition</div><div style="font-size:24px;font-weight:700;color:#e07c24;">' + poor.length + '</div></div>';
        if (withWork.length) html += '<div style="flex:1;min-width:140px;background:#e8f5e9;border-radius:8px;padding:10px 14px;"><div style="font-size:11px;font-weight:600;color:#2e7d32;text-transform:uppercase;letter-spacing:.05em;">Work Needed</div><div style="font-size:24px;font-weight:700;color:#2e7d32;">' + withWork.length + '</div></div>';
        html += '</div>';
      }
    }
    html += '</div>';

    html += '</div></div>';

    // Render as full page
    document.getElementById('pageTitle').textContent = c.name;
    document.getElementById('pageContent').innerHTML = html;
    document.getElementById('pageAction').style.display = 'none';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return; // Skip modal below
  },

  _tab: function(btn, panelId) {
    // Deactivate all tabs
    document.querySelectorAll('.cd-tab').forEach(function(t) {
      t.style.borderBottomColor = 'transparent';
      t.style.color = 'var(--text-light)';
      t.classList.remove('active');
    });
    document.querySelectorAll('.cd-panel').forEach(function(p) { p.style.display = 'none'; });
    // Activate clicked
    btn.style.borderBottomColor = 'var(--accent)';
    btn.style.color = 'var(--accent)';
    btn.classList.add('active');
    document.getElementById(panelId).style.display = 'block';
  },

  showStatement: function(clientId) {
    var client = DB.clients.getById(clientId);
    if (!client) return;

    // Gather all transactions for this client
    var invoices = DB.invoices.getAll().filter(function(i){ return i.clientId === clientId || i.clientName === client.name; });
    var quotes = DB.quotes.getAll().filter(function(q){ return q.clientId === clientId || q.clientName === client.name; });
    var jobs = DB.jobs.getAll().filter(function(j){ return j.clientId === clientId || j.clientName === client.name; });

    // Sort invoices by date
    invoices.sort(function(a,b){ return new Date(a.createdAt)-new Date(b.createdAt); });

    var totalBilled = invoices.reduce(function(s,i){return s+(i.total||0);},0);
    var totalPaid = invoices.filter(function(i){return i.status==='paid';}).reduce(function(s,i){return s+(i.total||0);},0);
    var balance = totalBilled - totalPaid;

    var html = '<div style="max-width:600px;font-family:sans-serif;">'
      // Header
      + '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid var(--border);">'
      + '<div><div style="font-size:18px;font-weight:800;color:#1a3c12;">' + ClientsPage._co().name + '</div>'
      + '<div style="font-size:12px;color:var(--text-light);">1 Highland Industrial Park · Peekskill, NY 10566</div>'
      + '<div style="font-size:12px;color:var(--text-light);">' + ClientsPage._co().phone + ' · ' + ClientsPage._co().website + '</div></div>'
      + '<div style="text-align:right;"><div style="font-size:20px;font-weight:800;">Account Statement</div>'
      + '<div style="font-size:12px;color:var(--text-light);">As of ' + new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) + '</div></div>'
      + '</div>'
      // Client info
      + '<div style="background:var(--bg);border-radius:8px;padding:12px 16px;margin-bottom:16px;">'
      + '<div style="font-weight:700;font-size:15px;">' + UI.esc(client.name) + '</div>'
      + (client.address ? '<div style="font-size:13px;color:var(--text-light);">' + UI.esc(client.address) + '</div>' : '')
      + (client.email ? '<div style="font-size:13px;color:var(--text-light);">' + UI.esc(client.email) + '</div>' : '')
      + '</div>'
      // Summary
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">'
      + '<div style="text-align:center;padding:12px;border:1px solid var(--border);border-radius:8px;"><div style="font-size:11px;color:var(--text-light);text-transform:uppercase;font-weight:600;">Total Billed</div><div style="font-size:20px;font-weight:800;">' + UI.moneyInt(totalBilled) + '</div></div>'
      + '<div style="text-align:center;padding:12px;border:1px solid var(--border);border-radius:8px;"><div style="font-size:11px;color:var(--text-light);text-transform:uppercase;font-weight:600;">Paid</div><div style="font-size:20px;font-weight:800;color:#2e7d32;">' + UI.moneyInt(totalPaid) + '</div></div>'
      + '<div style="text-align:center;padding:12px;border:1px solid var(--border);border-radius:8px;background:' + (balance>0?'#fff8f0':'#f0faf0') + ';"><div style="font-size:11px;color:var(--text-light);text-transform:uppercase;font-weight:600;">Balance Due</div><div style="font-size:20px;font-weight:800;color:' + (balance>0?'#c62828':'#2e7d32') + ';">' + UI.moneyInt(balance) + '</div></div>'
      + '</div>'
      // Invoice table
      + '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">'
      + '<thead><tr style="border-bottom:2px solid var(--border);">'
      + '<th style="text-align:left;padding:8px 4px;font-size:11px;color:var(--text-light);text-transform:uppercase;">Date</th>'
      + '<th style="text-align:left;padding:8px 4px;font-size:11px;color:var(--text-light);text-transform:uppercase;">Invoice</th>'
      + '<th style="text-align:left;padding:8px 4px;font-size:11px;color:var(--text-light);text-transform:uppercase;">Description</th>'
      + '<th style="text-align:right;padding:8px 4px;font-size:11px;color:var(--text-light);text-transform:uppercase;">Amount</th>'
      + '<th style="text-align:right;padding:8px 4px;font-size:11px;color:var(--text-light);text-transform:uppercase;">Paid</th>'
      + '<th style="text-align:right;padding:8px 4px;font-size:11px;color:var(--text-light);text-transform:uppercase;">Balance</th>'
      + '</tr></thead><tbody>';

    var runningBalance = 0;
    if (invoices.length === 0) {
      html += '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-light);">No invoices on record</td></tr>';
    } else {
      invoices.forEach(function(inv) {
        var invBalance = (inv.balance !== undefined ? inv.balance : (inv.total - (inv.amountPaid||0)));
        runningBalance += invBalance;
        html += '<tr style="border-bottom:1px solid #f3f4f6;">'
          + '<td style="padding:8px 4px;">' + UI.dateShort(inv.createdAt) + '</td>'
          + '<td style="padding:8px 4px;font-weight:600;">#' + (inv.invoiceNumber||'') + '</td>'
          + '<td style="padding:8px 4px;color:var(--text-light);">' + UI.esc((inv.subject||inv.description||'Tree Service').substring(0,30)) + '</td>'
          + '<td style="padding:8px 4px;text-align:right;">' + UI.money(inv.total) + '</td>'
          + '<td style="padding:8px 4px;text-align:right;color:#2e7d32;">' + (inv.status==='paid'?UI.money(inv.total):inv.amountPaid>0?UI.money(inv.amountPaid):'—') + '</td>'
          + '<td style="padding:8px 4px;text-align:right;font-weight:700;color:' + (invBalance>0?'#c62828':'#2e7d32') + ';">' + UI.money(invBalance) + '</td>'
          + '</tr>';
      });
    }
    html += '</tbody><tfoot><tr style="border-top:2px solid var(--border);font-weight:700;">'
      + '<td colspan="5" style="padding:10px 4px;text-align:right;font-size:14px;">Total Balance Due:</td>'
      + '<td style="padding:10px 4px;text-align:right;font-size:16px;color:' + (balance>0?'#c62828':'#2e7d32') + ';">' + UI.money(balance) + '</td>'
      + '</tr></tfoot></table>'
      + (balance>0 ? '<div style="margin-top:12px;text-align:center;"><a href="https://peekskilltree.com/branchmanager/client.html?id=' + clientId + '" style="display:inline-block;background:#1a3c12;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;">View Online & Pay →</a></div>' : '')
      + '</div>';

    UI.showModal('Account Statement — ' + client.name, html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Close</button>'
        + ' <button class="btn btn-primary" onclick="window.print()">🖨 Print Statement</button>'
    });
  },

  // Legacy modal version (keeping for reference, not used)
  _showDetailModal: function(id) {
    var c = DB.clients.getById(id);
    if (!c) return;
    UI.showModal(c.name, '<p>Use full-page view instead.</p>', {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Close</button>'
        + ' <button class="btn btn-primary" onclick="UI.closeModal();QuotesPage.showForm(null, \'' + id + '\')">Create Quote</button>'
    });
  }
};

/**
 * Tree Inventory — per-client tree records
 * Stored in localStorage as bm-tree-inventory
 */
var TreeInventory = {
  _key: 'bm-tree-inventory',

  getAll: function() {
    try { return JSON.parse(localStorage.getItem(TreeInventory._key) || '[]'); } catch(e) { return []; }
  },

  getForClient: function(clientId) {
    return TreeInventory.getAll().filter(function(t) { return t.clientId === clientId; });
  },

  getById: function(id) {
    return TreeInventory.getAll().find(function(t) { return t.id === id; }) || null;
  },

  save: function(tree) {
    var all = TreeInventory.getAll();
    var idx = all.findIndex(function(t) { return t.id === tree.id; });
    if (idx >= 0) { all[idx] = tree; } else { all.push(tree); }
    localStorage.setItem(TreeInventory._key, JSON.stringify(all));
  },

  remove: function(id) {
    var all = TreeInventory.getAll().filter(function(t) { return t.id !== id; });
    localStorage.setItem(TreeInventory._key, JSON.stringify(all));
  },

  showForm: function(clientId, treeId) {
    var c = DB.clients.getById(clientId);
    var t = treeId ? TreeInventory.getById(treeId) : {};
    if (!t) t = {};
    var title = treeId ? 'Edit Tree' : 'Add Tree to ' + (c ? c.name : 'Client');

    var commonSpecies = [
      '', 'Oak (Red)', 'Oak (White)', 'Oak (Pin)', 'Oak (Scarlet)', 'Maple (Red)', 'Maple (Sugar)',
      'Maple (Silver)', 'Maple (Norway)', 'Ash (White)', 'Ash (Green)', 'Elm (American)', 'Elm (Siberian)',
      'Pine (White)', 'Pine (Red)', 'Spruce (Norway)', 'Spruce (Blue)', 'Fir (Douglas)', 'Hemlock (Eastern)',
      'Cedar (Eastern Red)', 'Birch (White)', 'Birch (River)', 'Poplar', 'Linden', 'Locust (Black)',
      'Locust (Honey)', 'Walnut (Black)', 'Cherry', 'Apple', 'Pear', 'Dogwood', 'Other'
    ];

    var html = '<form id="tree-form" onsubmit="TreeInventory.saveForm(event,\'' + clientId + '\',\'' + (treeId || '') + '\')">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + '<div class="form-group"><label>Species *</label>'
      + '<select id="tree-species-select" onchange="var v=this.value;if(v===\'Other\'){document.getElementById(\'tree-species-custom\').style.display=\'block\';}else{document.getElementById(\'tree-species-custom\').style.display=\'none\';}" style="width:100%;padding:9px 12px;border:2px solid var(--border);border-radius:8px;font-size:14px;">'
      + commonSpecies.map(function(s) { return '<option value="' + UI.esc(s) + '"' + (t.species === s ? ' selected' : '') + '>' + (s || '— Select species —') + '</option>'; }).join('')
      + '</select>'
      + '<input type="text" id="tree-species-custom" placeholder="Enter species name..." value="' + UI.esc(commonSpecies.indexOf(t.species) === -1 ? (t.species || '') : '') + '" style="width:100%;padding:9px 12px;border:2px solid var(--border);border-radius:8px;font-size:14px;margin-top:6px;' + (commonSpecies.indexOf(t.species) === -1 && t.species ? '' : 'display:none;') + '">'
      + '</div>'
      + '<div class="form-group"><label>Location on Property</label><input type="text" id="tree-location" value="' + UI.esc(t.location || '') + '" placeholder="e.g. Front yard, back left corner" style="width:100%;padding:9px 12px;border:2px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">'
      + '<div class="form-group"><label>DBH (inches)</label><input type="number" id="tree-dbh" value="' + (t.dbh || '') + '" placeholder="e.g. 18" min="1" max="300" style="width:100%;padding:9px 12px;border:2px solid var(--border);border-radius:8px;font-size:14px;" oninput="TreeInventory._updatePriceHint()"></div>'
      + '<div class="form-group"><label>Est. Height (ft)</label><input type="number" id="tree-height" value="' + (t.height || '') + '" placeholder="e.g. 60" min="1" max="300" style="width:100%;padding:9px 12px;border:2px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '<div class="form-group"><label>Condition</label><select id="tree-condition" style="width:100%;padding:9px 12px;border:2px solid var(--border);border-radius:8px;font-size:14px;">'
      + ['', 'Excellent', 'Good', 'Fair', 'Poor', 'Hazard'].map(function(c_) { return '<option value="' + c_ + '"' + (t.condition === c_ ? ' selected' : '') + '>' + (c_ || '— Select —') + '</option>'; }).join('')
      + '</select></div>'
      + '</div>'
      + '<div id="tree-price-hint" style="display:none;background:#e8f5e9;border-radius:8px;padding:8px 12px;margin:-4px 0 12px;font-size:12px;color:#2e7d32;font-weight:600;"></div>'
      + '<div class="form-group"><label>Work Needed</label><input type="text" id="tree-work" value="' + UI.esc(t.workNeeded || '') + '" placeholder="e.g. Remove, Prune crown, Cable, Monitor" style="width:100%;padding:9px 12px;border:2px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '<div class="form-group"><label>Notes</label><textarea id="tree-notes" placeholder="Hazard notes, access issues, history..." style="width:100%;padding:9px 12px;border:2px solid var(--border);border-radius:8px;font-size:14px;height:72px;resize:vertical;">' + UI.esc(t.notes || '') + '</textarea></div>'
      + '</form>';

    UI.showModal(title, html, {
      footer: (treeId ? '<button class="btn btn-danger" style="margin-right:auto;" onclick="TreeInventory.confirmRemove(\'' + treeId + '\',\'' + clientId + '\')">Remove</button>' : '')
        + '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="document.getElementById(\'tree-form\').requestSubmit()">Save Tree</button>'
    });

    // Set up price hint
    setTimeout(function() { TreeInventory._updatePriceHint(); }, 50);
  },

  _updatePriceHint: function() {
    var dbhEl = document.getElementById('tree-dbh');
    var hintEl = document.getElementById('tree-price-hint');
    if (!dbhEl || !hintEl) return;
    var dbh = parseFloat(dbhEl.value);
    if (dbh > 0) {
      var estimate = Math.round(dbh * 100 / 50) * 50;
      hintEl.style.display = 'block';
      hintEl.textContent = '💡 Estimated removal price: ' + UI.money(estimate) + ' (based on ' + dbh + '" DBH × $100)';
    } else {
      hintEl.style.display = 'none';
    }
  },

  saveForm: function(e, clientId, treeId) {
    e.preventDefault();
    var speciesSel = document.getElementById('tree-species-select').value;
    var speciesCustom = document.getElementById('tree-species-custom').value.trim();
    var species = speciesSel === 'Other' ? speciesCustom : speciesSel;
    if (!species) { UI.toast('Species is required', 'error'); return; }

    var tree = {
      id: treeId || ('tr-' + Date.now().toString(36)),
      clientId: clientId,
      species: species,
      location: document.getElementById('tree-location').value.trim(),
      dbh: parseFloat(document.getElementById('tree-dbh').value) || null,
      height: parseFloat(document.getElementById('tree-height').value) || null,
      condition: document.getElementById('tree-condition').value,
      workNeeded: document.getElementById('tree-work').value.trim(),
      notes: document.getElementById('tree-notes').value.trim(),
      addedAt: treeId ? (TreeInventory.getById(treeId) || {}).addedAt : new Date().toISOString()
    };

    TreeInventory.save(tree);
    UI.toast(treeId ? 'Tree updated' : 'Tree added');
    UI.closeModal();
    ClientsPage.showDetail(clientId);
  },

  showDetail: function(treeId) {
    var t = TreeInventory.getById(treeId);
    if (!t) return;
    var condColor = { 'Excellent': '#00836c', 'Good': '#2e7d32', 'Fair': '#e6a817', 'Poor': '#e07c24', 'Hazard': '#dc3545' }[t.condition] || 'var(--text-light)';
    var estimate = t.dbh ? Math.round(t.dbh * 100 / 50) * 50 : null;

    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">';
    html += TreeInventory._detailRow('Species', t.species || '—');
    html += TreeInventory._detailRow('Location', t.location || '—');
    html += TreeInventory._detailRow('DBH', t.dbh ? t.dbh + '"' : '—');
    html += TreeInventory._detailRow('Est. Height', t.height ? '~' + t.height + ' ft' : '—');
    html += TreeInventory._detailRow('Condition', '<span style="font-weight:700;color:' + condColor + ';">' + (t.condition || '—') + '</span>');
    if (estimate) html += TreeInventory._detailRow('Est. Removal Price', '<span style="font-weight:700;color:var(--green-dark);">' + UI.money(estimate) + '</span>');
    html += '</div>';
    if (t.workNeeded) html += '<div style="margin-top:12px;padding:10px 14px;background:#fff3e0;border-radius:8px;"><strong>Work Needed:</strong> ' + UI.esc(t.workNeeded) + '</div>';
    if (t.notes) html += '<div style="margin-top:10px;padding:10px 14px;background:var(--bg);border-radius:8px;font-size:13px;">' + UI.esc(t.notes) + '</div>';

    var c = DB.clients.getById(t.clientId);
    UI.showModal((t.species || 'Tree') + (t.location ? ' — ' + t.location : ''), html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Close</button>'
        + (c ? ' <button class="btn btn-outline" onclick="UI.closeModal();QuotesPage.showForm(null,\'' + t.clientId + '\')" title="Start a quote using this tree">📋 Quote This Tree</button>' : '')
        + ' <button class="btn btn-primary" onclick="UI.closeModal();TreeInventory.showForm(\'' + t.clientId + '\',\'' + treeId + '\')">Edit</button>'
    });
  },

  _detailRow: function(label, value) {
    return '<div>'
      + '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-light);margin-bottom:4px;">' + label + '</div>'
      + '<div style="font-size:15px;">' + value + '</div>'
      + '</div>';
  },

  confirmRemove: function(treeId, clientId) {
    UI.confirm('Remove this tree from the inventory?', function() {
      TreeInventory.remove(treeId);
      UI.toast('Tree removed');
      UI.closeModal();
      ClientsPage.showDetail(clientId);
    });
  }
};
