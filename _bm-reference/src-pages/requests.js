/**
 * Branch Manager — Requests Page v3
 * Matches Jobber: filter chips, stat cards, row actions, detail view
 */
var RequestsPage = {

  // Look up existing client by phone (last-10-digits match) or email (case-insensitive).
  // Returns the client object, or null. If found, also auto-backfills missing phone/email
  // on the client record so we accumulate contact methods over time.
  _matchClient: function(phone, email, name) {
    var phoneDigits = (phone || '').replace(/\D/g, '').slice(-10);
    var emailNorm = (email || '').trim().toLowerCase();
    if (!phoneDigits && !emailNorm) return null;
    var clients = [];
    try { clients = JSON.parse(localStorage.getItem('bm-clients') || '[]'); } catch(e) {}
    var match = null;
    for (var i = 0; i < clients.length; i++) {
      var c = clients[i];
      var cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
      var cEmail = (c.email || '').trim().toLowerCase();
      if (phoneDigits && cPhone && cPhone === phoneDigits) { match = c; break; }
      if (emailNorm && cEmail && cEmail === emailNorm) { match = c; break; }
    }
    if (!match) return null;
    // Backfill missing contact on matched client
    var patch = {};
    if (phoneDigits && !(match.phone || '').replace(/\D/g, '').length) patch.phone = phone;
    if (emailNorm && !(match.email || '').trim()) patch.email = email;
    if (Object.keys(patch).length) {
      try { DB.clients.update(match.id, patch); Object.assign(match, patch); } catch(e){}
    }
    return match;
  },

  _co: function() {
    return {
      name: localStorage.getItem('bm-co-name') || BM_CONFIG.companyName,
      phone: localStorage.getItem('bm-co-phone') || BM_CONFIG.phone,
      email: localStorage.getItem('bm-co-email') || BM_CONFIG.email,
      website: localStorage.getItem('bm-co-website') || BM_CONFIG.website
    };
  },

  _search: '', _filter: 'all',

  // ── Helpers ──────────────────────────────────────────────────────────────
  _isOverdue: function(r) {
    if (r.status === 'converted' || r.status === 'quoted' || r.status === 'archived') return false;
    var age = (Date.now() - new Date(r.createdAt || 0)) / 86400000;
    return age > 3;
  },

  _statusLabel: function(s) {
    var map = { new:'New', assessment_scheduled:'Assessment Scheduled', assessment_complete:'Assessment Complete',
      converted:'Converted', quoted:'Quoted', overdue:'Overdue', archived:'Archived', unscheduled:'Unscheduled' };
    return map[s] || s;
  },

  // ── Background Supabase sync ──────────────────────────────────────────────
  _autoSync: function() {
    var SUPABASE_URL = 'https://ltpivkqahvplapyagljt.supabase.co';
    var SUPABASE_KEY = (typeof SupabaseDB !== 'undefined' && SupabaseDB.ANON_KEY) || '';
    fetch(SUPABASE_URL + '/rest/v1/requests?select=*&order=created_at.desc&limit=50', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    })
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      if (!Array.isArray(rows)) return;
      var existing = DB.requests.getAll();
      var added = 0;
      rows.forEach(function(row) {
        var dup = existing.find(function(e) {
          return (e.supabaseId && e.supabaseId === row.id) ||
                 (e.clientName && row.client_name && e.clientName.toLowerCase() === row.client_name.toLowerCase() &&
                  e.property && row.property && e.property.substring(0,8) === row.property.substring(0,8));
        });
        if (!dup) {
          var matched = RequestsPage._matchClient(row.phone, row.email, row.client_name);
          DB.requests.create({
            supabaseId: row.id,
            clientId: matched ? matched.id : undefined,
            clientName: (matched && matched.name) || row.client_name || '',
            email: row.email || (matched && matched.email) || '',
            phone: row.phone || (matched && matched.phone) || '',
            property: row.property || (matched && matched.address) || '',
            source: row.source || 'Online Form',
            notes: row.notes || '',
            status: row.status || 'new',
            createdAt: row.created_at
          });
          added++;
        }
      });
      localStorage.setItem('bm-req-last-sync', new Date().toISOString());
      if (added > 0) {
        UI.toast('📥 ' + added + ' new online request' + (added > 1 ? 's' : '') + ' pulled in!');
        loadPage('requests');
      }
    })
    .catch(function() {});
  },

  syncFromSupabase: function() {
    var SUPABASE_URL = 'https://ltpivkqahvplapyagljt.supabase.co';
    var SUPABASE_KEY = (typeof SupabaseDB !== 'undefined' && SupabaseDB.ANON_KEY) || '';
    var btn = document.getElementById('req-sync-btn');
    if (btn) { btn.textContent = '⏳ Syncing...'; btn.disabled = true; }
    fetch(SUPABASE_URL + '/rest/v1/requests?select=*&order=created_at.desc&limit=50', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    })
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      if (!Array.isArray(rows)) return;
      var existing = DB.requests.getAll();
      var added = 0;
      rows.forEach(function(row) {
        var dup = existing.find(function(e) {
          return (e.supabaseId && e.supabaseId === row.id) ||
                 (e.clientName && row.client_name && e.clientName.toLowerCase() === row.client_name.toLowerCase() &&
                  e.property && row.property && e.property.substring(0,8) === row.property.substring(0,8));
        });
        if (!dup) {
          var matched = RequestsPage._matchClient(row.phone, row.email, row.client_name);
          DB.requests.create({
            supabaseId: row.id,
            clientId: matched ? matched.id : undefined,
            clientName: (matched && matched.name) || row.client_name || '',
            email: row.email || (matched && matched.email) || '',
            phone: row.phone || (matched && matched.phone) || '',
            property: row.property || (matched && matched.address) || '',
            source: row.source || 'Online Form',
            notes: row.notes || '',
            status: row.status || 'new',
            createdAt: row.created_at
          });
          added++;
        }
      });
      localStorage.setItem('bm-req-last-sync', new Date().toISOString());
      UI.toast(added > 0 ? '✅ Synced ' + added + ' new request' + (added>1?'s':'') + ' from website' : '✅ Already up to date');
      if (btn) { btn.textContent = '🔄 Sync'; btn.disabled = false; }
      loadPage('requests');
    })
    .catch(function() {
      UI.toast('⚠️ Sync failed — check connection');
      if (btn) { btn.textContent = '🔄 Sync'; btn.disabled = false; }
    });
  },

  _pendingDetail: null,

  // ── List render ───────────────────────────────────────────────────────────
  render: function() {
    if (RequestsPage._pendingDetail) {
      var _pid = RequestsPage._pendingDetail;
      RequestsPage._pendingDetail = null;
      setTimeout(function() { RequestsPage.showDetail(_pid); }, 50);
    }
    var lastSync = localStorage.getItem('bm-req-last-sync');
    var fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    if (!lastSync || lastSync < fiveMinAgo) RequestsPage._autoSync();

    var self = RequestsPage;
    var allRequests = DB.requests.getAll();

    // ── Auto-link unlinked requests to existing clients ──
    var allClients = DB.clients.getAll();
    allRequests.forEach(function(r) {
      if (r.clientId) return;
      var match = null;
      if (r.phone) {
        var ph = r.phone.replace(/\D/g,'');
        if (ph.length >= 7) match = allClients.find(function(c) { return c.phone && c.phone.replace(/\D/g,'') === ph; });
      }
      if (!match && r.email) {
        var em = r.email.toLowerCase();
        match = allClients.find(function(c) { return c.email && c.email.toLowerCase() === em; });
      }
      if (!match && r.clientName) {
        var nm = r.clientName.toLowerCase().trim();
        match = allClients.find(function(c) { return c.name && c.name.toLowerCase().trim() === nm; });
      }
      if (match) {
        DB.requests.update(r.id, { clientId: match.id });
        r.clientId = match.id;
      }
    });

    // ── Counts ──
    var newCount   = allRequests.filter(function(r){ return r.status === 'new'; }).length;
    var quotedCount = allRequests.filter(function(r){ return r.status === 'quoted'; }).length;
    var overdueCount = allRequests.filter(function(r){ return self._isOverdue(r); }).length;
    var convertedCount = allRequests.filter(function(r){ return r.status === 'converted' || r.status === 'quoted'; }).length;
    var thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    var recentNew = allRequests.filter(function(r) {
      return new Date(r.createdAt) >= thirtyAgo;
    });
    var recentNewCount = recentNew.filter(function(r){ return r.status === 'new'; }).length;
    var recentConverted = recentNew.filter(function(r){ return r.status === 'converted' || r.status === 'quoted'; }).length;
    var convRate = recentNew.length > 0 ? Math.round(recentConverted / recentNew.length * 100) : 0;

    // ── New request alert cards at top ──
    var newRequests = allRequests.filter(function(r){ return r.status === 'new'; });
    newRequests.sort(function(a,b){ return new Date(b.createdAt||0) - new Date(a.createdAt||0); });

    var html = '';

    // New request cards
    if (newRequests.length > 0) {
      html += '<div style="margin-bottom:20px;">';
      newRequests.forEach(function(r) {
        var ageMs = Date.now() - new Date(r.createdAt || 0).getTime();
        var ageHrs = Math.floor(ageMs / 3600000);
        var ageStr = ageHrs < 1 ? 'just now' : ageHrs < 24 ? ageHrs + ' hour' + (ageHrs !== 1 ? 's' : '') + ' ago' : Math.floor(ageHrs / 24) + ' day' + (Math.floor(ageHrs / 24) !== 1 ? 's' : '') + ' ago';

        html += '<div onclick="RequestsPage.showDetail(\'' + r.id + '\')" style="'
          + 'background:#fffde7;border:1px solid #ffe082;border-left:4px solid #f9a825;'
          + 'border-radius:10px;padding:14px 18px;margin-bottom:8px;cursor:pointer;'
          + 'transition:transform .1s, box-shadow .1s;'
          + '" onmouseenter="this.style.boxShadow=\'0 2px 8px rgba(249,168,37,.25)\'" onmouseleave="this.style.boxShadow=\'none\'">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">'
          + '<div style="flex:1;min-width:200px;">'
          + '<div style="font-size:11px;font-weight:700;color:#e65100;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">New Request'
          + (r.clientId ? ' <span style="color:var(--green-dark);font-size:10px;background:#e8f5e9;padding:1px 6px;border-radius:4px;margin-left:6px;text-transform:none;letter-spacing:0;">Returning Client</span>' : '')
          + '</div>'
          + '<div style="font-size:15px;font-weight:700;color:var(--text);">' + UI.esc(r.clientName || 'Unknown')
          + '<span style="font-weight:400;color:var(--text-light);font-size:13px;margin-left:8px;">'
          + (r.property ? ' — ' + UI.esc(r.property) : '')
          + ' — Received ' + ageStr
          + '</span></div>'
          + '</div>'
          + '<button onclick="event.stopPropagation();RequestsPage._createQuote(\'' + r.id + '\',\'' + (r.clientId||'') + '\',\'' + UI.esc(r.clientName||'').replace(/'/g,"\\'") + '\')" '
          + 'style="font-size:12px;font-weight:600;padding:6px 14px;border-radius:6px;border:1px solid #e65100;background:#fff3e0;color:#e65100;cursor:pointer;white-space:nowrap;">'
          + 'Create Quote &rarr;</button>'
          + '</div></div>';
      });
      html += '</div>';
    }

    // ── Stats row (3 cards like Jobber) ──
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;" class="detail-grid">';

    // Card 1: Overview
    html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px 18px;">'
      + '<div style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Overview</div>'
      + '<div style="display:flex;gap:16px;flex-wrap:wrap;">'
      + '<div><div style="font-size:22px;font-weight:800;color:#1565c0;">' + newCount + '</div><div style="font-size:11px;color:var(--text-light);">New</div></div>'
      + '<div><div style="font-size:22px;font-weight:800;color:#7b1fa2;">' + quotedCount + '</div><div style="font-size:11px;color:var(--text-light);">Quoted</div></div>'
      + '<div><div style="font-size:22px;font-weight:800;color:' + (overdueCount > 0 ? '#c62828' : 'var(--text)') + ';">' + overdueCount + '</div><div style="font-size:11px;color:var(--text-light);">Overdue</div></div>'
      + '</div></div>';

    // Card 2: New Requests (30 days)
    html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px 18px;">'
      + '<div style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">New Requests</div>'
      + '<div style="font-size:28px;font-weight:800;color:var(--text);">' + recentNewCount + '</div>'
      + '<div style="font-size:11px;color:var(--text-light);">Past 30 days</div>'
      + '</div>';

    // Card 3: Conversion Rate (30 days)
    html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px 18px;">'
      + '<div style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Conversion Rate</div>'
      + '<div style="font-size:28px;font-weight:800;color:' + (convRate >= 50 ? '#2e7d32' : convRate >= 25 ? '#e07c24' : '#c62828') + ';">' + convRate + '%</div>'
      + '<div style="font-size:11px;color:var(--text-light);">Past 30 days</div>'
      + '</div>';

    html += '</div>';

    // ── Filter chips + search ──
    html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px;">';

    // Filter chips
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    var filters = [['all','All'],['new','New'],['quoted','Quoted'],['converted','Converted'],['archived','Archived']];
    filters.forEach(function(f) {
      var isActive = self._filter === f[0];
      html += '<button onclick="RequestsPage._setFilter(\'' + f[0] + '\')" style="font-size:12px;padding:5px 12px;border-radius:6px;border:1px solid '
        + (isActive ? '#1565c0' : 'var(--border)') + ';background:' + (isActive ? '#1565c0' : 'var(--white)') + ';color:'
        + (isActive ? '#fff' : 'var(--text)') + ';cursor:pointer;font-weight:' + (isActive ? '700' : '500') + ';">' + f[1] + '</button>';
    });
    html += '</div>';

    // Search input
    html += '<div style="position:relative;">'
      + '<input type="text" placeholder="Search requests..." value="' + UI.esc(self._search) + '" '
      + 'oninput="RequestsPage._search=this.value;loadPage(\'requests\')" '
      + 'style="font-size:13px;padding:7px 12px 7px 32px;border:1px solid var(--border);border-radius:8px;width:220px;background:var(--white);">'
      + '<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--text-light);">&#128269;</span>'
      + '</div>';

    html += '</div>';

    // ── Table ──
    var filtered = self._getFiltered();

    if (filtered.length === 0) {
      html += UI.emptyState('&#128229;', 'No requests found', self._search ? 'Try a different search term.' : 'New requests from your website form will appear here.');
    } else {
      html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;overflow:hidden;">';

      // Table header
      html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
        + '<thead><tr style="background:var(--bg);border-bottom:1px solid var(--border);">'
        + '<th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.04em;">Client</th>'
        + '<th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.04em;">Description</th>'
        + '<th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.04em;">Property</th>'
        + '<th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.04em;">Requested</th>'
        + '<th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.04em;">Status</th>'
        + '</tr></thead><tbody>';

      filtered.forEach(function(r) {
        var isOverdue = self._isOverdue(r);
        var displayStatus = isOverdue && r.status === 'new' ? 'overdue' : r.status;
        var desc = r.service || r.notes || '';
        if (desc.length > 50) desc = desc.substring(0, 50) + '...';
        var prop = r.property || '';
        if (prop.length > 35) prop = prop.substring(0, 35) + '...';

        html += '<tr onclick="RequestsPage.showDetail(\'' + r.id + '\')" style="cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s;" '
          + 'onmouseenter="this.style.background=\'var(--bg)\'" onmouseleave="this.style.background=\'transparent\'">'
          + '<td style="padding:12px 14px;font-weight:600;">' + UI.esc(r.clientName || 'Unknown') + '</td>'
          + '<td style="padding:12px 14px;color:var(--text-light);">' + UI.esc(desc || '—') + '</td>'
          + '<td style="padding:12px 14px;color:var(--text-light);font-size:12px;">' + UI.esc(prop || '—') + '</td>'
          + '<td style="padding:12px 14px;white-space:nowrap;">' + UI.dateShort(r.createdAt) + '</td>'
          + '<td style="padding:12px 14px;">' + UI.statusBadge(displayStatus) + '</td>'
          + '</tr>';
      });

      html += '</tbody></table></div>';
    }

    return html;
  },

  // ── Filtering ─────────────────────────────────────────────────────────────
  _getFiltered: function() {
    var self = RequestsPage;
    var all = DB.requests.getAll();
    // Default: hide converted and archived (they're done — show in Clients page)
    if (self._filter === 'all') {
      all = all.filter(function(r) { return r.status !== 'converted' && r.status !== 'quoted' && r.status !== 'archived'; });
    } else if (self._filter === 'converted') {
      all = all.filter(function(r) { return r.status === 'converted' || r.status === 'quoted'; });
    } else if (self._filter === 'overdue') {
      all = all.filter(function(r) { return self._isOverdue(r); });
    } else if (self._filter === 'unscheduled') {
      all = all.filter(function(r) { return !r.assessmentDate && (r.status === 'new' || r.status === 'assessment_complete'); });
    } else if (self._filter !== 'all') {
      all = all.filter(function(r) { return r.status === self._filter; });
    }
    if (self._search && self._search.length >= 2) {
      var s = self._search.toLowerCase();
      all = all.filter(function(r) {
        return (r.clientName||'').toLowerCase().indexOf(s) >= 0
          || (r.property||'').toLowerCase().indexOf(s) >= 0
          || (r.phone||'').indexOf(s) >= 0
          || (r.email||'').toLowerCase().indexOf(s) >= 0
          || (r.notes||'').toLowerCase().indexOf(s) >= 0
          || (r.service||'').toLowerCase().indexOf(s) >= 0
          || (r.source||'').toLowerCase().indexOf(s) >= 0;
      });
    }
    // Sort: newest first
    all.sort(function(a,b){ return new Date(b.createdAt||0) - new Date(a.createdAt||0); });
    return all;
  },
  _setFilter: function(f) { RequestsPage._filter = f; loadPage('requests'); },

  // ── New Request form ──────────────────────────────────────────────────────
  showForm: function(editId) {
    var r = editId ? DB.requests.getById(editId) : null;
    var allClients = [];
    try { allClients = JSON.parse(localStorage.getItem('bm-clients') || '[]'); } catch(e) {}
    var clientOptions = [{ value: '', label: '— New client (fill in below) —' }]
      .concat(allClients.map(function(c) { return { value: c.id, label: c.name + (c.address ? ' · ' + c.address.split(',')[0] : '') }; }));

    var services = ['','Tree Removal','Tree Pruning','Stump Grinding','Emergency Tree Work','Tree Assessment','Cabling & Bracing',
      'Chipping / Brush Removal','Lot Clearing','Firewood','Gutter Cleaning','Spring Clean Up','Snow Removal','Other'];

    var html = '<form id="req-form" onsubmit="RequestsPage.save(event,\'' + (editId||'') + '\')">'
      + (r ? '' : UI.formField('Existing Client', 'select', 'r-clientId', '', { options: clientOptions }))
      + '<div id="r-newclient-fields"' + (r ? '' : '') + '>'
      + UI.formField('Client Name', 'text', 'r-name', r ? r.clientName : '', { placeholder: 'Full name' })
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + UI.formField('Phone', 'tel', 'r-phone', r ? r.phone : '', { placeholder: '(914) 555-0000' })
      + UI.formField('Email', 'email', 'r-email', r ? r.email : '', { placeholder: 'email@example.com' })
      + '</div></div>'
      + UI.formField('Property Address', 'text', 'r-property', r ? r.property : '', { placeholder: 'Street, City, State ZIP' })
      + UI.formField('Service Requested', 'select', 'r-service', r ? r.service : '', { options: services })
      + UI.formField('How did they hear about us?', 'select', 'r-source', r ? r.source : '', { options: ['','Google Search','Facebook','Instagram','Nextdoor','Friend / Referral','Yelp','Angi','Thumbtack','Drive-by','Repeat Client','Other'] })
      + UI.formField('Details / Notes', 'textarea', 'r-notes', r ? r.notes : '', { placeholder: 'What do they need? Any specifics about the property or job.' })
      + '</form>'
      + '<script>var _rci=document.getElementById("r-clientId");if(_rci)_rci.addEventListener("change",function(){'
      + 'var nf=document.getElementById("r-newclient-fields");nf.style.display=this.value?"none":"block";'
      + 'if(this.value){var cl=JSON.parse(localStorage.getItem("bm-clients")||"[]");'
      + 'var c=cl.find(function(x){return x.id===_rci.value;});'
      + 'if(c){if(document.getElementById("r-name"))document.getElementById("r-name").value=c.name||"";'
      + 'if(document.getElementById("r-phone"))document.getElementById("r-phone").value=c.phone||"";'
      + 'if(document.getElementById("r-email"))document.getElementById("r-email").value=c.email||"";'
      + 'if(!document.getElementById("r-property").value)document.getElementById("r-property").value=c.address||"";}}'
      + '});<\/script>';

    UI.showModal(r ? 'Edit Request' : 'New Request', html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="document.getElementById(\'req-form\').requestSubmit()">'
        + (r ? 'Save Changes' : 'Save Request') + '</button>'
    });
  },

  save: function(e, editId) {
    e.preventDefault();
    var service  = (document.getElementById('r-service')||{}).value || '';
    var property = (document.getElementById('r-property')||{}).value.trim();
    var source   = (document.getElementById('r-source')||{}).value || '';
    var notes    = (document.getElementById('r-notes')||{}).value.trim();

    if (editId) {
      var phone = (document.getElementById('r-phone')||{}).value.trim();
      var email = (document.getElementById('r-email')||{}).value.trim();
      var name  = (document.getElementById('r-name')||{}).value.trim();
      DB.requests.update(editId, { clientName: name, phone: phone, email: email, property: property, service: service, source: source, notes: notes });
      UI.toast('Request updated');
      UI.closeModal();
      RequestsPage.showDetail(editId);
      return;
    }

    var existingClientId = (document.getElementById('r-clientId')||{}).value;
    var allClients = [];
    try { allClients = JSON.parse(localStorage.getItem('bm-clients') || '[]'); } catch(ex) {}
    var client;

    if (existingClientId) {
      client = allClients.find(function(c) { return c.id === existingClientId; });
      if (!client) { UI.toast('Client not found', 'error'); return; }
    } else {
      var name = (document.getElementById('r-name')||{}).value.trim();
      var rphone = (document.getElementById('r-phone')||{}).value.trim();
      var remail = (document.getElementById('r-email')||{}).value.trim();
      if (!name) { UI.toast('Enter a client name or select an existing client', 'error'); return; }
      // Auto-match to an existing client by phone/email to avoid duplicate records.
      client = RequestsPage._matchClient(rphone, remail, name);
      if (client) {
        UI.toast('Matched existing client: ' + client.name + ' ✓');
      } else {
        client = DB.clients.create({
          name: name,
          phone: rphone,
          email: remail,
          address: property,
          status: 'lead'
        });
      }
    }

    DB.requests.create({
      clientId: client.id,
      clientName: client.name,
      property: property || client.address || '',
      phone: client.phone || '',
      email: client.email || '',
      service: service,
      source: source,
      notes: notes,
      status: 'new'
    });

    UI.toast('Request created ✅');
    UI.closeModal();
    loadPage('requests');
  },

  // ── Detail view ───────────────────────────────────────────────────────────
  showDetail: function(id) {
    var r = DB.requests.getById(id);
    if (!r) return;
    var self = RequestsPage;

    var statusColor = { new:'#1565c0', assessment_scheduled:'#e07c24', assessment_complete:'#2e7d32',
      converted:'#2e7d32', quoted:'#8b2252', overdue:'#dc3545', archived:'#9e9e9e' }[r.status] || '#1565c0';

    // Find linked quotes
    var linkedQuotes = DB.quotes.getAll().filter(function(q) {
      return q.requestId === r.id || (q.clientName && r.clientName && q.clientName === r.clientName && q.clientId === r.clientId);
    }).slice(0, 3);

    var html = '<div style="max-width:960px;margin:0 auto;">'

    // Top action bar
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">'
      + '<button class="btn btn-outline" onclick="loadPage(\'requests\')" style="padding:6px 12px;font-size:12px;">← Back to Requests</button>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
      + '<button class="btn btn-primary" onclick="RequestsPage._createQuote(\'' + r.id + '\',\'' + (r.clientId||'') + '\',\'' + UI.esc(r.clientName||'') + '\')" style="font-size:12px;">📝 Create Quote</button>'
      + '</div></div>'

    // Header card
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px;">'
      + '<div style="height:4px;background:' + statusColor + ';"></div>'
      + '<div style="padding:20px 24px;">'
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">'
      + '<div>'
      + '<h2 style="font-size:22px;font-weight:700;margin:0 0 4px;">'
      + UI.esc(r.clientName || 'Unknown')
      + (r.clientId ? ' <a onclick="ClientsPage.showDetail(\'' + r.clientId + '\')" style="font-size:12px;color:var(--accent);cursor:pointer;font-weight:500;margin-left:6px;">Edit Client →</a>' : '')
      + '</h2>'
      + '<div style="font-size:13px;color:var(--text-light);">'
      + UI.dateRelative(r.createdAt)
      + (r.source ? ' · via ' + r.source : '')
      + (self._isOverdue(r) ? ' · <span style="color:#c62828;font-weight:600;">Overdue</span>' : '')
      + '</div>'
      + (r.property ? '<div style="font-size:13px;color:var(--text-light);margin-top:4px;">📍 ' + UI.esc(r.property) + '</div>' : '')
      + '</div>'
      + UI.statusBadge(r.status)
      + '</div></div></div>'

    // Two-column layout: main + sidebar
      + '<div style="display:grid;grid-template-columns:1fr 300px;gap:16px;" class="detail-grid">'

    // ── Main column ──
      + '<div>'

    // Request details card
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:14px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px;">Request Details</h4>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;" class="detail-grid">'
      + '<div><div style="font-size:11px;color:var(--text-light);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;">Service</div>'
      + '<div style="font-size:14px;font-weight:600;">' + UI.esc(r.service || '—') + '</div></div>'
      + '<div><div style="font-size:11px;color:var(--text-light);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;">Source</div>'
      + '<div style="font-size:14px;">' + UI.esc(r.source || '—') + '</div></div>'
      + '<div><div style="font-size:11px;color:var(--text-light);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;">Received</div>'
      + '<div style="font-size:14px;">' + UI.dateShort(r.createdAt) + '</div></div>'
      + '<div><div style="font-size:11px;color:var(--text-light);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;">Assessment</div>'
      + '<div style="font-size:14px;">' + (r.assessmentDate ? UI.dateShort(r.assessmentDate) : '<span style="color:var(--text-light);">Not scheduled</span>') + '</div></div>'
      + '</div>'
      + (r.notes ? '<div style="font-size:13px;line-height:1.7;color:var(--text);background:var(--bg);border-radius:8px;padding:12px;">' + UI.esc(r.notes).replace(/\n/g,'<br>') + '</div>' : '<div style="font-size:13px;color:var(--text-light);font-style:italic;">No details provided</div>')
      + '</div>'

    // Status workflow card
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:14px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;">Update Status</h4>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    [['new','New'],['assessment_scheduled','Assessment Scheduled'],['assessment_complete','Assessment Complete'],['converted','Converted'],['archived','Archived']].forEach(function(s) {
      var isActive = r.status === s[0];
      html += '<button onclick="RequestsPage.setStatus(\'' + r.id + '\',\'' + s[0] + '\')" style="font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid '
        + (isActive ? '#1565c0' : 'var(--border)') + ';background:' + (isActive ? '#1565c0' : 'var(--white)') + ';color:'
        + (isActive ? '#fff' : 'var(--text)') + ';cursor:pointer;font-weight:' + (isActive ? '700' : '500') + ';">' + s[1] + '</button>';
    });
    html += '</div></div>'

    // Linked quotes
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:20px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin:0;">Quotes</h4>'
      + '<button onclick="RequestsPage._createQuote(\'' + r.id + '\',\'' + (r.clientId||'') + '\',\'' + UI.esc(r.clientName||'') + '\')" class="btn btn-outline" style="font-size:12px;">+ Create Quote</button>'
      + '</div>';
    if (linkedQuotes.length > 0) {
      linkedQuotes.forEach(function(q) {
        html += '<div onclick="QuotesPage.showDetail(\'' + q.id + '\')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg);border-radius:8px;margin-bottom:6px;cursor:pointer;">'
          + '<div><div style="font-size:13px;font-weight:600;">' + 'Quote #' + (q.quoteNumber||'') + '</div>'
          + '<div style="font-size:11px;color:var(--text-light);">' + UI.dateShort(q.createdAt) + '</div></div>'
          + '<div style="display:flex;align-items:center;gap:8px;">' + UI.statusBadge(q.status) + '<span style="font-size:13px;font-weight:700;">' + UI.money(q.total) + '</span></div>'
          + '</div>';
      });
    } else {
      html += '<div style="font-size:13px;color:var(--text-light);text-align:center;padding:12px;">No quotes yet</div>';
    }
    html += '</div></div>'

    // ── Right sidebar ──
      + '<div>'

    // Auto-match client by phone/email/name
    var matchedClient = null;
    if (r.clientId) {
      matchedClient = DB.clients.getById(r.clientId);
    }
    if (!matchedClient && r.phone) {
      var ph = r.phone.replace(/\D/g,'');
      matchedClient = DB.clients.getAll().find(function(c) { return c.phone && c.phone.replace(/\D/g,'') === ph; });
    }
    if (!matchedClient && r.email) {
      var em = r.email.toLowerCase();
      matchedClient = DB.clients.getAll().find(function(c) { return c.email && c.email.toLowerCase() === em; });
    }
    if (!matchedClient && r.clientName) {
      matchedClient = DB.clients.getAll().find(function(c) { return c.name && c.name.toLowerCase() === r.clientName.toLowerCase(); });
    }
    // Auto-link if found but not linked
    if (matchedClient && !r.clientId) {
      DB.requests.update(r.id, { clientId: matchedClient.id });
      r.clientId = matchedClient.id;
    }

    // Client history
    var clientQuotes = matchedClient ? DB.quotes.getAll().filter(function(q) { return q.clientId === matchedClient.id; }) : [];
    var clientJobs = matchedClient ? DB.jobs.getAll().filter(function(j) { return j.clientId === matchedClient.id; }) : [];
    var clientInvoices = matchedClient ? DB.invoices.getAll().filter(function(i) { return i.clientId === matchedClient.id; }) : [];
    var clientRevenue = clientInvoices.filter(function(i) { return i.status === 'paid'; }).reduce(function(s,i) { return s + (i.total||0); }, 0);

    html
    // Contact card with client history
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;">Client</h4>'
      + '<div style="font-size:16px;font-weight:700;margin-bottom:4px;">' + UI.esc(r.clientName || '—')
      + (matchedClient ? ' <span style="font-size:11px;color:var(--green-dark);font-weight:600;">● Existing</span>' : ' <span style="font-size:11px;color:#e07c24;font-weight:600;">● New Lead</span>')
      + '</div>'
      + (r.property ? '<a href="https://maps.apple.com/?daddr=' + encodeURIComponent(r.property) + '" target="_blank" style="display:block;font-size:13px;color:var(--accent);margin-bottom:8px;text-decoration:none;">📍 ' + UI.esc(r.property) + ' →</a>' : '')
      + (r.phone ? '<a href="tel:' + r.phone.replace(/\D/g,'') + '" class="btn btn-outline" style="width:100%;justify-content:center;margin-bottom:6px;font-size:13px;">📞 ' + UI.phone(r.phone) + '</a>' : '')
      + (r.phone ? '<button class="btn btn-outline" style="width:100%;justify-content:center;margin-bottom:6px;font-size:13px;" onclick="if(typeof Dialpad!==\'undefined\'){Dialpad.showTextModal(\'' + r.phone.replace(/\D/g,'') + '\',\'Hi ' + UI.esc((r.clientName||'').split(' ')[0]||'there') + ', thanks for reaching out to \' + RequestsPage._co().name + \'! We received your request and will follow up shortly. Questions? Call \' + RequestsPage._co().phone + \'.\');}else{window.location=\'sms:' + r.phone.replace(/\D/g,'') + '\';}">💬 Text</button>' : '')
      + (r.email ? '<a href="mailto:' + r.email + '" class="btn btn-outline" style="width:100%;justify-content:center;margin-bottom:6px;font-size:13px;">✉️ ' + UI.esc(r.email) + '</a>' : '')
      + (r.property ? '<a href="https://maps.apple.com/?daddr=' + encodeURIComponent(r.property) + '" target="_blank" class="btn btn-outline" style="width:100%;justify-content:center;font-size:13px;">🗺 Directions</a>' : '')
      + (matchedClient ? '<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px;">'
        + '<div style="font-size:12px;color:var(--text-light);margin-bottom:6px;">CLIENT HISTORY</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;">'
        + '<div style="background:var(--bg);padding:6px 8px;border-radius:6px;text-align:center;"><div style="font-weight:700;">' + clientQuotes.length + '</div><div style="font-size:11px;color:var(--text-light);">quotes</div></div>'
        + '<div style="background:var(--bg);padding:6px 8px;border-radius:6px;text-align:center;"><div style="font-weight:700;">' + clientJobs.length + '</div><div style="font-size:11px;color:var(--text-light);">jobs</div></div>'
        + '<div style="background:var(--bg);padding:6px 8px;border-radius:6px;text-align:center;"><div style="font-weight:700;">' + clientInvoices.length + '</div><div style="font-size:11px;color:var(--text-light);">invoices</div></div>'
        + '<div style="background:var(--bg);padding:6px 8px;border-radius:6px;text-align:center;"><div style="font-weight:700;color:var(--green-dark);">' + UI.moneyInt(clientRevenue) + '</div><div style="font-size:11px;color:var(--text-light);">revenue</div></div>'
        + '</div>'
        + '<a onclick="ClientsPage.showDetail(\'' + matchedClient.id + '\')" style="display:block;text-align:center;font-size:12px;color:var(--accent);margin-top:8px;cursor:pointer;">View Full Client Profile →</a>'
        + '</div>' : '')
      + '</div>'

    // Assessment date card
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Assessment Date</h4>'
      + '<input type="date" id="req-assess-date" value="' + (r.assessmentDate || '') + '" style="width:100%;padding:8px 10px;border:2px solid var(--border);border-radius:8px;font-size:13px;margin-bottom:8px;">'
      + '<button onclick="RequestsPage._saveAssessmentDate(\'' + r.id + '\')" class="btn btn-primary" style="width:100%;font-size:13px;">Save Date</button>'
      + '</div>'

    // Assessment photos
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Assessment Photos</h4>';
    if (typeof Photos !== 'undefined') { html += Photos.renderGallery('request', r.id); }
    else { html += '<div style="color:var(--text-light);font-size:13px;">No photos yet</div>'; }
    html += '</div>'

    // Quick info
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Details</h4>'
      + '<table style="width:100%;font-size:12px;border-collapse:collapse;">'
      + '<tr><td style="padding:4px 0;color:var(--text-light);">Request #</td><td style="padding:4px 0;text-align:right;font-weight:600;">' + (r.id||'').slice(-6).toUpperCase() + '</td></tr>'
      + '<tr><td style="padding:4px 0;color:var(--text-light);">Received</td><td style="padding:4px 0;text-align:right;">' + UI.dateShort(r.createdAt) + '</td></tr>'
      + '<tr><td style="padding:4px 0;color:var(--text-light);">Source</td><td style="padding:4px 0;text-align:right;font-weight:600;">' + (r.source || '—') + '</td></tr>'
      + (r.confirmationSentAt ? '<tr><td style="padding:4px 0;color:var(--text-light);">Confirmed</td><td style="padding:4px 0;text-align:right;">' + UI.dateShort(r.confirmationSentAt) + '</td></tr>' : '')
      + '</table>'
      + '</div>'

      + '</div></div></div>';

    document.getElementById('pageTitle').textContent = 'Request — ' + (r.clientName || '');
    document.getElementById('pageContent').innerHTML = html;
    document.getElementById('pageAction').style.display = 'none';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  _saveAssessmentDate: function(id) {
    var val = (document.getElementById('req-assess-date')||{}).value;
    DB.requests.update(id, { assessmentDate: val, status: val ? 'assessment_scheduled' : 'new' });
    UI.toast(val ? 'Assessment scheduled for ' + UI.dateShort(val) : 'Assessment date cleared');
    RequestsPage.showDetail(id);
  },

  setStatus: function(id, status) {
    DB.requests.update(id, { status: status });
    UI.toast('Status updated to ' + RequestsPage._statusLabel(status));
    RequestsPage.showDetail(id);
  },

  _updateStatus: function(id, status) {
    DB.requests.update(id, { status: status });
    UI.toast(status === 'archived' ? 'Request archived' : 'Status updated to ' + RequestsPage._statusLabel(status));
    loadPage('requests');
  },

  _createQuote: function(requestId, clientId, clientName) {
    DB.requests.update(requestId, { status: 'converted' });
    UI.toast('Request marked as converted');
    var resolvedId = clientId;
    if (clientId && !DB.clients.getById(clientId) && clientName) {
      var allClients = JSON.parse(localStorage.getItem('bm-clients') || '[]');
      var match = allClients.find(function(c) { return c.name === clientName; });
      if (match) resolvedId = match.id;
    }
    // Pass requestId so the new quote is back-linked to its originating request
    QuotesPage.showForm(null, resolvedId, requestId);
  },

  _sendConfirmation: function(id) {
    var r = DB.requests.getById(id);
    if (!r || !r.email) { UI.toast('No email on file for this request', 'error'); return; }
    var firstName = (r.clientName || '').split(' ')[0] || 'there';
    var co = RequestsPage._co();
    var subject = 'We received your request — ' + co.name;
    var body = 'Hi ' + firstName + ',\n\n'
      + 'Thanks for reaching out to ' + co.name + '! We\'ve received your request and will be in touch within 1 business day to schedule a free assessment.\n\n'
      + (r.service ? '🌳 Service: ' + r.service + '\n' : '')
      + (r.notes ? '📋 Details: ' + r.notes + '\n' : '')
      + (r.property ? '📍 Property: ' + r.property + '\n' : '')
      + '\nFeel free to call or text us at ' + co.phone + ' with any questions.\n\n'
      + 'Doug Brown\n' + co.name + '\n' + co.phone + '\n' + co.email + '\nLicensed & Fully Insured';

    var html = '<div style="padding:4px;">'
      + '<div style="background:#e8f5e9;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#1a3c12;">📧 Sending to <strong>' + r.email + '</strong></div>'
      + '<div style="margin-bottom:12px;"><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Subject</label>'
      + '<input type="text" id="rc-subject" value="' + UI.esc(subject) + '" style="width:100%;padding:8px 12px;border:2px solid var(--border);border-radius:8px;font-size:14px;"></div>'
      + '<div><label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Message</label>'
      + '<textarea id="rc-body" rows="12" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:13px;line-height:1.6;font-family:inherit;resize:vertical;">' + body + '</textarea></div>'
      + '</div>';

    UI.showModal('Send Request Confirmation', html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="RequestsPage._confirmSendConfirmation(\'' + id + '\')">📧 Send Now</button>'
    });
  },

  _confirmSendConfirmation: function(id) {
    var r = DB.requests.getById(id);
    if (!r) return;
    var subject = (document.getElementById('rc-subject')||{}).value;
    var body = (document.getElementById('rc-body')||{}).value;
    if (typeof Email !== 'undefined' && Email.isConfigured()) {
      Email.send(r.email, subject, body);
    } else {
      window.open('mailto:' + r.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), '_blank');
    }
    DB.requests.update(id, { confirmationSentAt: new Date().toISOString(), status: 'assessment_scheduled' });
    UI.closeModal();
    UI.toast('Confirmation sent to ' + r.email + ' ✅');
    RequestsPage.showDetail(id);
  }
};
