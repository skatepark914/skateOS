/**
 * Branch Manager — Quotes Page
 * Quote list, builder with line items, status management
 */
var QuotesPage = {
  _page: 0, _perPage: 50, _search: '', _filter: 'all', _sortCol: 'quoteNumber', _sortDir: 'desc',

  _co: function() {
    return {
      name: localStorage.getItem('bm-co-name') || BM_CONFIG.companyName,
      phone: localStorage.getItem('bm-co-phone') || BM_CONFIG.phone,
      email: localStorage.getItem('bm-co-email') || BM_CONFIG.email,
      website: localStorage.getItem('bm-co-website') || BM_CONFIG.website,
      licenses: localStorage.getItem('bm-co-licenses') || 'WC-32079, PC-50644'
    };
  },

  _pendingDetail: null,

  render: function() {
    var self = QuotesPage;
    if (self._pendingDetail) {
      var _pid = self._pendingDetail;
      self._pendingDetail = null;
      setTimeout(function() { QuotesPage.showDetail(_pid); }, 50);
    }
    var all = DB.quotes.getAll();
    var draft = all.filter(function(q) { return q.status === 'draft'; }).length;
    var sent = all.filter(function(q) { return q.status === 'sent' || q.status === 'awaiting'; }).length;
    var approved = all.filter(function(q) { return q.status === 'approved'; }).length;

    // Jobber-style stat cards row
    var converted = all.filter(function(q) { return q.status === 'converted'; });
    var changesReq = all.filter(function(q) { return q.status === 'changes_requested'; });
    var sentTotal = all.filter(function(q) { return q.status === 'sent' || q.status === 'awaiting'; }).reduce(function(s,q){return s+(q.total||0);},0);
    var convertedTotal = converted.reduce(function(s,q){return s+(q.total||0);},0);
    var convRate = all.length > 0 ? Math.round((converted.length + approved) / all.length * 100) : 0;

    var html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;background:var(--white);" class="stat-row">'
      // Overview
      + '<div onclick="QuotesPage._setFilter(\'all\')" style="padding:14px 16px;border-right:1px solid var(--border);cursor:pointer;">'
      + '<div style="font-size:14px;font-weight:700;margin-bottom:8px;">Overview</div>'
      + '<div style="font-size:12px;"><span style="color:#6c757d;">●</span> Draft (' + draft + ')</div>'
      + '<div style="font-size:12px;"><span style="color:#e6a817;">●</span> Awaiting response (' + sent + ')</div>'
      + '<div style="font-size:12px;"><span style="color:#dc3545;">●</span> Changes requested (' + changesReq.length + ')</div>'
      + '<div style="font-size:12px;"><span style="color:#2e7d32;">●</span> Approved (' + approved + ')</div>'
      + '</div>'
      // Conversion rate
      + '<div style="padding:14px 16px;border-right:1px solid var(--border);">'
      + '<div style="font-size:14px;font-weight:700;">Conversion rate</div>'
      + '<div style="font-size:12px;color:var(--text-light);">All time</div>'
      + '<div style="font-size:28px;font-weight:700;margin-top:4px;">' + convRate + '%</div>'
      + '</div>'
      // Sent (currently awaiting)
      + '<div onclick="QuotesPage._setFilter(\'sent\')" style="padding:14px 16px;border-right:1px solid var(--border);cursor:pointer;">'
      + '<div style="font-size:14px;font-weight:700;">Sent</div>'
      + '<div style="font-size:12px;color:var(--text-light);">Past 30 days</div>'
      + '<div style="font-size:28px;font-weight:700;margin-top:4px;">' + sent + '</div>'
      + '<div style="font-size:12px;color:var(--text-light);">' + UI.moneyInt(sentTotal) + '</div>'
      + '</div>'
      // Converted
      + '<div onclick="QuotesPage._setFilter(\'converted\')" style="padding:14px 16px;cursor:pointer;">'
      + '<div style="font-size:14px;font-weight:700;">Converted</div>'
      + '<div style="font-size:12px;color:var(--text-light);">All time</div>'
      + '<div style="font-size:28px;font-weight:700;margin-top:4px;">' + converted.length + '</div>'
      + '<div style="font-size:12px;color:var(--text-light);">' + UI.moneyInt(convertedTotal) + '</div>'
      + '</div>'
      + '</div>';

    var filtered = self._getFiltered();
    var page = filtered.slice(self._page * self._perPage, (self._page + 1) * self._perPage);

    // Jobber-style "All quotes (X results)" + filter chips + search
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">'
      + '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">'
      + '<h3 style="font-size:16px;font-weight:700;margin:0;">All quotes</h3>'
      + '<span style="font-size:13px;color:var(--text-light);">(' + filtered.length + ' results)</span>'
      + (function() {
        var chips = [['all','All'],['draft','Draft'],['awaiting','Awaiting Response'],['changes_requested','Changes Requested'],['approved','Approved'],['converted','Converted']];
        var out = '';
        for (var ci = 0; ci < chips.length; ci++) {
          var val = chips[ci][0], label = chips[ci][1];
          var isActive = self._filter === val;
          out += '<button onclick="QuotesPage._setFilter(\'' + val + '\')" style="font-size:12px;padding:5px 14px;border-radius:20px;border:1px solid ' + (isActive ? '#2e7d32' : 'var(--border)') + ';background:' + (isActive ? '#2e7d32' : 'var(--white)') + ';color:' + (isActive ? '#fff' : 'var(--text)') + ';cursor:pointer;font-weight:' + (isActive ? '600' : '500') + ';">' + label + '</button>';
        }
        return out;
      })()
      + '</div>'
      + '<button onclick="loadPage(\'propertymap\')" style="background:none;border:1px solid var(--border);padding:7px 12px;border-radius:6px;font-size:12px;cursor:pointer;color:var(--accent);white-space:nowrap;" title="Property map for site assessments">📍 Property Map</button>'
      + '<div class="search-box" style="min-width:200px;max-width:280px;">'
      + '<span style="color:var(--text-light);">🔍</span>'
      + '<input type="text" placeholder="Search quotes..." value="' + UI.esc(self._search) + '" oninput="QuotesPage._search=this.value;QuotesPage._page=0;loadPage(\'quotes\')">'
      + '</div></div>';

    // Batch action bar (mobile-safe: no left offset on narrow screens)
    html += '<div id="q-batch-bar" class="bm-batch-bar" style="display:none;position:fixed;bottom:0;left:var(--sidebar-w,0);right:0;z-index:500;background:#1a1a2e;color:#fff;padding:12px 24px;padding-bottom:max(12px,env(safe-area-inset-bottom));align-items:center;justify-content:space-between;box-shadow:0 -4px 20px rgba(0,0,0,.3);">'
      + '<span id="q-batch-count" style="font-weight:700;font-size:14px;">0 selected</span>'
      + '<div style="display:flex;gap:8px;align-items:center;">'
      + '<button onclick="QuotesPage._batchFollowUp()" style="background:#e6a817;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">📬 Send Follow-up</button>'
      + '<button onclick="QuotesPage._batchDecline()" style="background:#dc3545;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">✗ Mark Declined</button>'
      + '<button onclick="QuotesPage._batchClear()" style="background:none;color:rgba(255,255,255,.7);border:none;padding:8px 12px;font-size:16px;cursor:pointer;">&#10005;</button>'
      + '</div></div>';

    var now7ago = new Date(Date.now() - 7 * 86400000);
    html += '<div style="background:var(--white);border-radius:12px;border:1px solid var(--border);overflow:hidden;">'
      + '<table class="data-table"><thead><tr>'
      + '<th style="width:32px;"><input type="checkbox" onchange="QuotesPage._selectAll(this.checked)" style="width:16px;height:16px;"></th>'
      + self._sortTh('Client', 'clientName') + self._sortTh('Quote number', 'quoteNumber') + '<th>Property</th>' + self._sortTh('Created', 'createdAt') + self._sortTh('Status', 'status') + self._sortTh('Total', 'total', 'text-align:right;')
      + '</tr></thead><tbody>';

    if (page.length === 0) {
      html += '<tr><td colspan="8">' + (self._search ? '<div style="text-align:center;padding:24px;color:var(--text-light);">No quotes match "' + self._search + '"</div>' : UI.emptyState('📋', 'No quotes yet', 'Create your first quote.', '+ New Quote', 'QuotesPage.showForm()')) + '</td></tr>';
    } else {
      page.forEach(function(q) {
        var isStale = (q.status === 'sent' || q.status === 'awaiting') && q.createdAt && new Date(q.createdAt) < now7ago;
        var rowStyle = 'cursor:pointer;' + (isStale ? 'background:#fffbf0;' : '');
        html += '<tr onclick="QuotesPage.showDetail(\'' + q.id + '\')" style="' + rowStyle + '">'
          + '<td onclick="event.stopPropagation()"><input type="checkbox" class="q-check" value="' + q.id + '" onchange="QuotesPage._updateBulk()" style="width:16px;height:16px;"></td>'
          + '<td><strong>' + UI.esc(q.clientName || '—') + '</strong>' + (isStale ? ' <span title="Sent 7+ days ago" style="font-size:10px;color:#e6a817;font-weight:700;background:#fff3cd;padding:1px 5px;border-radius:3px;">FOLLOW UP</span>' : '') + '</td>'
          + '<td>#' + (q.quoteNumber || '') + '</td>'
          + '<td style="font-size:13px;color:var(--text-light);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + UI.esc(q.property || '—') + '</td>'
          + '<td>' + UI.dateShort(q.createdAt) + '</td>'
          + '<td>' + UI.statusBadge(q.status) + '</td>'
          + '<td style="text-align:right;font-weight:600;">' + UI.money(q.total) + '</td>'
          + '</tr>';
      });
    }
    html += '</tbody></table></div>';

    // Pagination
    var totalPages = Math.ceil(filtered.length / self._perPage);
    if (totalPages > 1) {
      html += '<div style="display:flex;justify-content:center;gap:4px;margin-top:12px;">';
      html += '<button class="btn btn-outline" onclick="QuotesPage._goPage(' + (self._page - 1) + ')" style="font-size:12px;padding:5px 10px;"' + (self._page === 0 ? ' disabled' : '') + '>‹</button>';
      for (var p = Math.max(0, self._page - 2); p <= Math.min(totalPages - 1, self._page + 2); p++) {
        html += '<button class="btn ' + (p === self._page ? 'btn-primary' : 'btn-outline') + '" onclick="QuotesPage._goPage(' + p + ')" style="font-size:12px;padding:5px 10px;min-width:32px;">' + (p + 1) + '</button>';
      }
      html += '<button class="btn btn-outline" onclick="QuotesPage._goPage(' + (self._page + 1) + ')" style="font-size:12px;padding:5px 10px;"' + (self._page >= totalPages - 1 ? ' disabled' : '') + '>›</button>';
      html += '</div>';
    }
    return html;
  },

  _getFiltered: function() {
    var self = QuotesPage;
    var all = DB.quotes.getAll();
    if (self._filter !== 'all') {
      all = all.filter(function(q) {
        if (self._filter === 'awaiting' || self._filter === 'sent') return q.status === 'sent' || q.status === 'awaiting';
        return q.status === self._filter;
      });
    }
    if (self._search && self._search.length >= 2) {
      var s = self._search.toLowerCase();
      all = all.filter(function(q) {
        return (q.clientName || '').toLowerCase().indexOf(s) >= 0 || (q.description || '').toLowerCase().indexOf(s) >= 0 || (q.property || '').toLowerCase().indexOf(s) >= 0 || String(q.quoteNumber).indexOf(s) >= 0;
      });
    }
    var col = self._sortCol;
    var dir = self._sortDir === 'asc' ? 1 : -1;
    all.sort(function(a, b) {
      var va = a[col], vb = b[col];
      if (col === 'quoteNumber' || col === 'total') return ((va || 0) - (vb || 0)) * dir;
      if (col === 'createdAt') return ((new Date(va || 0)).getTime() - (new Date(vb || 0)).getTime()) * dir;
      va = (va || '').toString().toLowerCase(); vb = (vb || '').toString().toLowerCase();
      return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
    });
    return all;
  },
  _sortTh: function(label, col, extraStyle) {
    var self = QuotesPage;
    var arrow = self._sortCol === col ? (self._sortDir === 'asc' ? ' &#9650;' : ' &#9660;') : '';
    return '<th onclick="QuotesPage._setSort(\'' + col + '\')" style="cursor:pointer;user-select:none;' + (extraStyle || '') + '"' + (self._sortCol === col ? ' class="sort-active"' : '') + '>' + label + arrow + '</th>';
  },
  _setSort: function(col) {
    if (QuotesPage._sortCol === col) { QuotesPage._sortDir = QuotesPage._sortDir === 'asc' ? 'desc' : 'asc'; }
    else { QuotesPage._sortCol = col; QuotesPage._sortDir = 'asc'; }
    QuotesPage._page = 0; loadPage('quotes');
  },
  _setFilter: function(f) { QuotesPage._filter = f; QuotesPage._page = 0; loadPage('quotes'); },
  _goPage: function(p) { var t = Math.ceil(QuotesPage._getFiltered().length / QuotesPage._perPage); QuotesPage._page = Math.max(0, Math.min(p, t - 1)); loadPage('quotes'); },

  _selectAll: function(checked) {
    document.querySelectorAll('.q-check').forEach(function(cb) { cb.checked = checked; });
    QuotesPage._updateBatchBar();
  },
  _updateBulk: function() { QuotesPage._updateBatchBar(); },
  _updateBatchBar: function() {
    var selected = document.querySelectorAll('.q-check:checked');
    var bar = document.getElementById('q-batch-bar');
    var count = document.getElementById('q-batch-count');
    if (bar) bar.style.display = selected.length > 0 ? 'flex' : 'none';
    if (count) count.textContent = selected.length + ' selected';
  },
  _getSelected: function() {
    return Array.from(document.querySelectorAll('.q-check:checked')).map(function(cb) { return cb.value; });
  },
  _batchClear: function() {
    document.querySelectorAll('.q-check').forEach(function(cb) { cb.checked = false; });
    var bar = document.getElementById('q-batch-bar'); if (bar) bar.style.display = 'none';
  },
  _quickFollowUp: function(id) {
    var q = DB.quotes.getById(id);
    if (!q) return;
    DB.quotes.update(id, { lastFollowUp: new Date().toISOString() });

    // Try to send email if Email module is available and client has email
    var client = q.clientId ? DB.clients.getById(q.clientId) : null;
    var email = q.clientEmail || (client && client.email) || '';
    if (email && typeof Email !== 'undefined') {
      var firstName = (q.clientName || '').split(' ')[0] || 'there';
      var _co2 = QuotesPage._co();
      var subject = 'Following up on your quote from ' + _co2.name;
      var body = 'Hi ' + firstName + ',\n\n'
        + 'I wanted to follow up on the quote I sent over for ' + (q.description || 'tree services') + '.\n\n'
        + 'Quote #' + q.quoteNumber + ' — ' + UI.money(q.total) + '\n\n'
        + 'Do you have any questions or would you like to move forward? Just reply to this email or give me a call at ' + _co2.phone + '.\n\n'
        + 'Thanks,\nDoug Brown\n' + _co2.name + '\n' + _co2.phone + '\n' + _co2.website;
      Email.send(email, subject, body).then(function() {
        UI.toast('Follow-up sent to ' + email);
      }).catch(function() {
        UI.toast('Follow-up logged (email send failed — check SendGrid key in Settings)');
      });
    } else {
      UI.toast('Follow-up logged for ' + UI.esc(q.clientName || 'client') + (email ? '' : ' — no email on file'));
    }
  },
  _batchFollowUp: function() {
    var ids = QuotesPage._getSelected();
    if (ids.length === 0) return;
    ids.forEach(function(id) {
      DB.quotes.update(id, { lastFollowUp: new Date().toISOString() });
    });
    UI.toast(ids.length + ' follow-up' + (ids.length > 1 ? 's' : '') + ' logged');
    QuotesPage._batchClear();
    loadPage('quotes');
  },
  _batchDecline: function() {
    var ids = QuotesPage._getSelected();
    if (ids.length === 0) return;
    UI.confirm('Mark ' + ids.length + ' quote' + (ids.length > 1 ? 's' : '') + ' as declined?', function() {
      ids.forEach(function(id) { DB.quotes.update(id, { status: 'declined' }); });
      UI.toast(ids.length + ' quote' + (ids.length > 1 ? 's' : '') + ' marked declined');
      loadPage('quotes');
    });
  },

  showForm: function(quoteId, clientId, requestId) {
    var q = quoteId ? DB.quotes.getById(quoteId) : {};
    var client = clientId ? DB.clients.getById(clientId) : (q.clientId ? DB.clients.getById(q.clientId) : null);
    var items = q.lineItems || [{ service: '', description: '', qty: 1, rate: 0 }];
    // Stash requestId so save() captures it as origin
    QuotesPage._originRequestId = requestId || q.requestId || null;

    // Check for tree measurement data
    var treeMeasure = null;
    try { treeMeasure = JSON.parse(localStorage.getItem('bm-tree-measure')); localStorage.removeItem('bm-tree-measure'); } catch(e) {}
    if (treeMeasure && !quoteId) {
      var desc = 'Tree removal';
      if (treeMeasure.dbh) desc += ' — ' + treeMeasure.dbh + '" DBH';
      if (treeMeasure.height) desc += ', ~' + treeMeasure.height + ' ft';
      if (treeMeasure.complexity) desc += ' (' + treeMeasure.complexity + ')';
      var price = treeMeasure.dbh ? Math.round(treeMeasure.dbh * 100 / 50) * 50 : 0;
      items = [{ service: 'Tree Removal', description: desc, qty: 1, rate: price }];
      q.description = desc;
    }
    var services = DB.services.getAll();

    // Get clients synchronously from localStorage
    var allClients = [];
    try { allClients = JSON.parse(localStorage.getItem('bm-clients') || '[]'); } catch(e) {}

    var html = '<form id="quote-form" onsubmit="QuotesPage.save(event, \'' + (quoteId || '') + '\')">';

    // Client + property + description (minimal, auto-filled)
    var _qProperty = q.property || (client ? client.address : '') || '';
    var _qDesc = q.description || '';

    // Auto-fill description from request notes if creating from a request
    if (!_qDesc && !quoteId) {
      // Check if there's a recently converted request with notes
      var recentReqs = DB.requests.getAll().filter(function(r) {
        return r.status === 'converted' && r.clientName === (client ? client.name : '');
      });
      if (recentReqs.length > 0 && recentReqs[0].notes) _qDesc = recentReqs[0].notes;
      if (!_qDesc && recentReqs.length > 0 && recentReqs[0].service) _qDesc = recentReqs[0].service;
    }

    if (client) {
      html += '<input type="hidden" id="q-clientId" value="' + client.id + '">'
        + '<div style="background:var(--bg);border-radius:10px;padding:14px 16px;margin-bottom:16px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'
        + '<div>'
        + '<a onclick="UI.closeModal();ClientsPage.showDetail(\'' + client.id + '\')" style="font-size:16px;font-weight:700;color:var(--text);cursor:pointer;text-decoration:none;border-bottom:1px dashed var(--text-light);">' + UI.esc(client.name) + '</a>'
        + (_qProperty ? '<div style="margin-top:4px;"><a href="https://maps.apple.com/?daddr=' + encodeURIComponent(_qProperty) + '" target="_blank" style="font-size:13px;color:var(--accent);text-decoration:none;" onclick="event.stopPropagation();">📍 ' + UI.esc(_qProperty) + ' →</a></div>' : '')
        + '</div>'
        + '</div>'
        + '</div>'
        + '<input type="hidden" id="q-property" value="' + UI.esc(_qProperty) + '">';
    } else {
      // Search-as-you-type client selector
      html += '<div class="form-group"><label>Client *</label>'
        + '<input type="hidden" id="q-clientId" value="">'
        + '<input type="text" id="q-client-search" placeholder="Type client name..." autocomplete="off" '
        + 'oninput="QuotesPage._searchClient(this.value)" '
        + 'style="width:100%;padding:10px 12px;border:2px solid var(--border);border-radius:8px;font-size:15px;">'
        + '<div id="q-client-results" style="display:none;position:relative;z-index:10;"></div>'
        + '</div>'
        + '<input type="hidden" id="q-property" value="">';
    }

    // Description — show as editable text, auto-filled from request notes
    html += '<div class="form-group" style="margin-bottom:12px;">'
      + '<label style="font-size:12px;font-weight:600;color:var(--text-light);display:block;margin-bottom:4px;">Description</label>'
      + '<textarea id="q-description" rows="2" placeholder="e.g., Tree removal - 2 oaks" style="width:100%;padding:10px 12px;border:2px solid var(--border);border-radius:8px;font-size:15px;font-family:inherit;resize:vertical;">' + UI.esc(_qDesc) + '</textarea>'
      + (_qDesc ? '<div style="font-size:11px;color:var(--text-light);margin-top:3px;">Auto-filled from request</div>' : '')
      + '</div>';

    // ═══ STEP 1: Per Tree/Task ═══
    var tmData = q.timeMaterial || {};

    html += '<div style="margin:16px 0;">'
      + '<div style="font-size:15px;font-weight:800;margin-bottom:4px;">Line Items</div>'
      + '<p style="font-size:12px;color:var(--text-light);margin-bottom:12px;">Select service → take photo → AI identifies & prices.</p>';

    // Service selector + photo button
    html += '<div style="display:flex;gap:8px;margin-bottom:12px;">'
      + '<select id="q-add-service" style="flex:1;padding:12px;border:2px solid var(--border);border-radius:10px;font-size:15px;font-weight:600;">'
      + '<option value="">— Select Service —</option>'
      + '<option value="Tree Removal">Tree Removal</option>'
      + '<option value="Tree Pruning">Tree Pruning</option>'
      + '<option value="Stump Removal">Stump Grinding</option>'
      + '<option value="Cabling">Cabling</option>'
      + '<option value="Clean Up">Clean Up</option>'
      + '<option value="Other">Other</option>'
      + '</select>'
      + '<button type="button" onclick="QuotesPage._addWithServiceAndPhoto()" style="padding:12px 20px;background:var(--green-dark);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;white-space:nowrap;">'
      + '<i data-lucide="camera" style="width:18px;height:18px;"></i> Add</button>'
      + '</div>';

    // Line items (with photo thumbnails)
    html += '<div id="q-items">';
    items.forEach(function(item, i) {
      html += QuotesPage._itemRow(i, item, services);
    });
    html += '</div>'
      + '<button type="button" class="btn btn-outline" style="margin-top:8px;font-size:12px;" onclick="QuotesPage.addItem()">+ Add without photo</button>'
      + '<div id="q-pertree-total" style="margin-top:12px;text-align:right;font-size:15px;font-weight:700;color:var(--green-dark);"></div>'
      + '</div>';

      + '</div>';


    // Total display with tax breakdown (Jobber style)
    var _qSubtotal = 0;
    (q.lineItems || []).forEach(function(it) { _qSubtotal += (it.qty || 1) * (it.rate || 0); });
    var _qTaxRate = (q.taxRate !== undefined ? q.taxRate : (parseFloat(localStorage.getItem('bm-tax-rate')) || 8.375));
    var _qTaxAmt = Math.round(_qSubtotal * _qTaxRate / 100 * 100) / 100;
    var _qGrandTotal = _qSubtotal + _qTaxAmt;
    html += '<div style="margin-top:16px;background:var(--bg);border:1px solid var(--border);border-radius:10px;overflow:hidden;">'
      + '<div style="padding:10px 16px;display:flex;justify-content:space-between;align-items:center;font-size:13px;border-bottom:1px solid var(--border);">'
      + '<span style="color:var(--text-light);">Subtotal</span><span id="q-subtotal-display" style="font-weight:600;">' + UI.money(_qSubtotal) + '</span>'
      + '</div>'
      + '<div style="padding:10px 16px;display:flex;justify-content:space-between;align-items:center;font-size:13px;border-bottom:1px solid var(--border);">'
      + '<span style="color:var(--text-light);">Tax (' + _qTaxRate + '%)</span><input type="hidden" id="q-tax-rate" value="' + _qTaxRate + '">'
      + '<span id="q-tax-display" style="font-weight:600;">' + UI.money(_qTaxAmt) + '</span>'
      + '</div>'
      + '<div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;background:var(--green-dark);color:var(--white);">'
      + '<span style="font-weight:600;">Total</span>'
      + '<span id="q-total-display" style="font-size:1.5rem;font-weight:800;">' + UI.money(_qGrandTotal) + '</span>'
      + '</div>'
      + '<div style="padding:8px 16px;display:flex;justify-content:space-between;align-items:center;font-size:12px;background:#f0fdf4;border-top:1px solid #c8e6c9;">'
      + '<span style="color:var(--text-light);">Est. Profit Margin <span id="q-margin-pct" style="font-weight:700;color:var(--green-dark);"></span></span>'
      + '<span style="color:var(--text-light);">Cost: <input type="number" id="q-est-cost" value="' + (q.estimatedCost || '') + '" placeholder="0" oninput="QuotesPage._updateMargin()" style="width:70px;font-size:12px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;text-align:center;"> → Profit: <span id="q-profit-display" style="font-weight:700;color:var(--green-dark);">—</span></span>'
      + '</div>'
      + '</div>';

    // Property Map moved to Step 2

    html += UI.formField('Internal Notes', 'textarea', 'q-notes', q.notes, { placeholder: 'Notes (not shown to client)' });

      // Expiry
      + '<div style="margin-bottom:16px;">'
      + '<input type="hidden" id="q-expires" value="' + (q.expiresAt ? q.expiresAt.substring(0,10) : new Date(Date.now() + 30*86400000).toISOString().substring(0,10)) + '">'
      + '<div style="font-size:11px;color:var(--text-light);">Quote valid for 30 days.</div>'
      + '</div>'

      // ═══ TIME & EQUIPMENT (at the bottom, after all line items) ═══
      + '<button type="button" id="q-show-tm-btn" onclick="document.getElementById(\'q-mode-tm\').style.display=\'block\';this.style.display=\'none\';" style="width:100%;padding:14px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin:16px 0 12px;' + (tmData.totalHrs ? 'display:none;' : '') + '">✅ Finished Line Items — Time & Equipment</button>'

      + '<div id="q-mode-tm" style="display:' + (tmData.totalHrs ? 'block' : 'none') + ';border:2px solid var(--accent);border-radius:10px;padding:16px;margin-bottom:12px;">'
      + '<div style="font-size:15px;font-weight:800;margin-bottom:4px;">Production Estimate</div>'
      + '<p style="font-size:12px;color:var(--text-light);margin-bottom:12px;">Map the job site, estimate crew + equipment to verify pricing.</p>'

      // Property Map
      + '<div style="margin-bottom:16px;"><button type="button" class="btn btn-outline" style="width:100%;" onclick="PropertyMap.show(document.getElementById(\'q-property\').value)">🗺️ Open Property Map — Place Equipment</button></div>'

      // Crew
      + '<div style="font-size:13px;font-weight:700;margin-bottom:8px;">Crew</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">'
      + '<div><label style="font-size:11px;color:var(--text-light);display:block;">Climber</label>'
      + '<input type="number" id="q-tm-climber-hrs" value="' + (tmData.climberHrs || '') + '" placeholder="hrs" min="0" step="0.5" oninput="QuotesPage._calcTM()" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '<div><label style="font-size:11px;color:var(--text-light);display:block;">Ground crew</label>'
      + '<input type="number" id="q-tm-ground-count" value="' + (tmData.groundCount || '2') + '" placeholder="#" min="0" step="1" oninput="QuotesPage._calcTM()" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '<div><label style="font-size:11px;color:var(--text-light);display:block;">Ground hrs</label>'
      + '<input type="number" id="q-tm-ground-hrs" value="' + (tmData.groundHrs || '') + '" placeholder="hrs" min="0" step="0.5" oninput="QuotesPage._calcTM()" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '</div>'

      // Equipment
      + '<div style="font-size:13px;font-weight:700;margin-bottom:8px;">Equipment</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">'
      + '<label style="font-size:13px;display:flex;align-items:center;gap:6px;"><input type="checkbox" id="q-tm-bucket" onchange="QuotesPage._calcTM()"' + (tmData.bucket ? ' checked' : '') + '> Bucket truck</label>'
      + '<label style="font-size:13px;display:flex;align-items:center;gap:6px;"><input type="checkbox" id="q-tm-chipper" onchange="QuotesPage._calcTM()"' + (tmData.chipper ? ' checked' : '') + '> Chipper</label>'
      + '<label style="font-size:13px;display:flex;align-items:center;gap:6px;"><input type="checkbox" id="q-tm-crane" onchange="QuotesPage._calcTM()"' + (tmData.crane ? ' checked' : '') + '> Crane</label>'
      + '<label style="font-size:13px;display:flex;align-items:center;gap:6px;"><input type="checkbox" id="q-tm-stumpgrinder" onchange="QuotesPage._calcTM()"' + (tmData.stumpGrinder ? ' checked' : '') + '> Stump grinder</label>'
      + '</div>'

      // Duration
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">'
      + '<div><label style="font-size:11px;color:var(--text-light);display:block;">Total job hours</label>'
      + '<input type="number" id="q-tm-total-hrs" value="' + (tmData.totalHrs || '') + '" placeholder="hrs" min="0" step="0.5" oninput="QuotesPage._calcTM()" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '<div><label style="font-size:11px;color:var(--text-light);display:block;">Dump / disposal</label>'
      + '<input type="number" id="q-tm-disposal" value="' + (tmData.disposal || '') + '" placeholder="$" min="0" oninput="QuotesPage._calcTM()" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></div>'
      + '</div>'

      // T&M Total
      + '<div id="q-tm-breakdown" style="background:var(--bg);border-radius:8px;padding:12px;font-size:13px;"></div>'
      + '<div id="q-tm-total" style="margin-top:8px;text-align:right;font-size:15px;font-weight:700;color:var(--accent);"></div>'
      + '</div>'

      // Compare button + panel
      + '<button type="button" id="q-compare-btn" onclick="QuotesPage._showPriceComparison()" style="display:none;margin-top:12px;width:100%;padding:14px;background:#7c3aed;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">📊 Compare Pricing Methods</button>'
      + '<div id="q-comparison" style="display:none;margin-top:12px;background:#f5f3ff;border:2px solid #c4b5fd;border-radius:10px;padding:16px;"></div>'

      + '</form>';

    // Render as full page (not modal)
    var pageHtml = '<div style="max-width:680px;margin:0 auto;padding-bottom:80px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'
      + '<button class="btn btn-outline" onclick="loadPage(\'quotes\')" style="font-size:13px;">← Back to Quotes</button>'
      + '<div style="display:flex;gap:8px;">'
      + '<button class="btn btn-outline" onclick="QuotesPage.saveAs(\'draft\')">Save Draft</button>'
      + '<button class="btn btn-primary" onclick="QuotesPage.saveAs(\'sent\')">Save & Send</button>'
      + '</div></div>'
      + '<h2 style="font-size:20px;margin-bottom:16px;">' + (quoteId ? 'Edit Quote #' + q.quoteNumber : 'New Quote') + '</h2>'
      + html
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">'
      + '<button class="btn btn-outline" onclick="loadPage(\'quotes\')">Cancel</button>'
      + '<button class="btn btn-outline" onclick="QuotesPage.saveAs(\'draft\')">Save Draft</button>'
      + '<button class="btn btn-primary" onclick="QuotesPage.saveAs(\'sent\')">Save & Send</button>'
      + '</div></div>';

    var content = document.getElementById('pageContent');
    if (content) content.innerHTML = pageHtml;

    // ── AUTO-SAVE FAILSAFE ──
    // Save form state every 15 seconds + on every input change
    // Restores if app crashes, loses service, or accidentally navigates away
    QuotesPage._autoSaveKey = 'bm-quote-autosave-' + (quoteId || 'new');
    QuotesPage._autoSaveTimer = setInterval(function() { QuotesPage._autoSave(); }, 15000);

    // Save on any input change
    var form = document.getElementById('quote-form');
    if (form) {
      form.addEventListener('input', function() {
        clearTimeout(QuotesPage._autoSaveDebounce);
        QuotesPage._autoSaveDebounce = setTimeout(function() { QuotesPage._autoSave(); }, 2000);
      });
    }

    // Warn before leaving page with unsaved changes
    window._quoteFormDirty = false;
    if (form) form.addEventListener('input', function() { window._quoteFormDirty = true; });
    window.addEventListener('beforeunload', QuotesPage._beforeUnload);

    // Check for recovered draft
    var recovered = localStorage.getItem(QuotesPage._autoSaveKey);
    if (recovered && !quoteId) {
      try {
        var rd = JSON.parse(recovered);
        if (rd.clientName || (rd.lineItems && rd.lineItems.length > 0 && rd.lineItems[0].service)) {
          var banner = document.createElement('div');
          banner.style.cssText = 'background:#fff3e0;border:1px solid #ffe0b2;border-radius:8px;padding:12px 16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;';
          banner.innerHTML = '<div><strong style="color:#e65100;">📋 Recovered draft</strong><span style="font-size:13px;color:var(--text-light);margin-left:8px;">' + (rd.clientName || 'Unsaved quote') + ' — ' + new Date(rd.savedAt).toLocaleTimeString() + '</span></div>'
            + '<div style="display:flex;gap:6px;">'
            + '<button onclick="QuotesPage._restoreAutoSave()" class="btn btn-primary" style="font-size:12px;padding:4px 12px;">Restore</button>'
            + '<button onclick="this.parentElement.parentElement.remove();localStorage.removeItem(\'' + QuotesPage._autoSaveKey + '\')" class="btn btn-outline" style="font-size:12px;padding:4px 12px;">Discard</button>'
            + '</div>';
          var formEl = document.getElementById('quote-form');
          if (formEl) formEl.parentElement.insertBefore(banner, formEl);
        }
      } catch(e) {}
    }
  },

  _autoSave: function() {
    var form = document.getElementById('quote-form');
    if (!form) return;
    var data = {
      savedAt: new Date().toISOString(),
      clientId: (document.getElementById('q-clientId') || {}).value || '',
      clientName: (document.getElementById('q-client-search') || {}).value || '',
      description: (document.getElementById('q-description') || {}).value || '',
      notes: (document.getElementById('q-notes') || {}).value || '',
      lineItems: []
    };
    document.querySelectorAll('.quote-item-row').forEach(function(row) {
      data.lineItems.push({
        service: (row.querySelector('.q-item-service') || {}).value || '',
        description: (row.querySelector('.q-item-desc') || {}).value || '',
        qty: (row.querySelector('.q-item-qty') || {}).value || '1',
        rate: (row.querySelector('.q-item-rate') || {}).value || ''
      });
    });
    try {
      localStorage.setItem(QuotesPage._autoSaveKey, JSON.stringify(data));
    } catch(e) {}
  },

  _restoreAutoSave: function() {
    try {
      var data = JSON.parse(localStorage.getItem(QuotesPage._autoSaveKey));
      if (!data) return;
      var clientSearch = document.getElementById('q-client-search');
      if (clientSearch && data.clientName) clientSearch.value = data.clientName;
      var clientId = document.getElementById('q-clientId');
      if (clientId && data.clientId) clientId.value = data.clientId;
      var desc = document.getElementById('q-description');
      if (desc && data.description) desc.value = data.description;
      var notes = document.getElementById('q-notes');
      if (notes && data.notes) notes.value = data.notes;
      // Restore line items
      if (data.lineItems && data.lineItems.length > 0) {
        var rows = document.querySelectorAll('.quote-item-row');
        data.lineItems.forEach(function(li, i) {
          if (i >= rows.length) QuotesPage.addItem();
          var row = document.querySelectorAll('.quote-item-row')[i];
          if (!row) return;
          var svc = row.querySelector('.q-item-service'); if (svc) svc.value = li.service;
          var dsc = row.querySelector('.q-item-desc'); if (dsc) dsc.value = li.description;
          var qty = row.querySelector('.q-item-qty'); if (qty) qty.value = li.qty;
          var rate = row.querySelector('.q-item-rate'); if (rate) rate.value = li.rate;
        });
        QuotesPage.calcTotal();
      }
      // Remove recovery banner
      var banner = document.querySelector('[style*="fff3e0"]');
      if (banner) banner.remove();
      UI.toast('Draft restored ✅');
    } catch(e) { UI.toast('Could not restore draft', 'error'); }
  },

  _beforeUnload: function(e) {
    if (window._quoteFormDirty) {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes on this quote. Are you sure you want to leave?';
    }
  },

  _clearAutoSave: function() {
    if (QuotesPage._autoSaveTimer) clearInterval(QuotesPage._autoSaveTimer);
    if (QuotesPage._autoSaveKey) localStorage.removeItem(QuotesPage._autoSaveKey);
    window._quoteFormDirty = false;
    window.removeEventListener('beforeunload', QuotesPage._beforeUnload);
  },

  // Default rates for common services (editable in settings)
  _defaultRates: {
    'Tree Removal': 0, 'Tree Pruning': 0, 'Stump Removal': 150, 'Bucket Truck': 600,
    'Cabling': 300, 'Land Clearing': 0, 'Snow Removal': 0, 'Chipping Brush': 350,
    'Haul Debris': 250, 'Labor': 400, 'Gutter Clean Out': 150, 'Arborist Letter': 350,
    'Firewood Cord': 400, 'Firewood Bundle': 10, 'Free Woodchips': 0, 'Free Estimate': 0
  },

  _itemRow: function(index, item, services) {
    var svcOptions = services.map(function(s) {
      return '<option value="' + s.name + '"' + (item.service === s.name ? ' selected' : '') + '>' + s.name + (s.type === 'product' ? ' (product)' : '') + '</option>';
    }).join('');

    var lineTotal = ((item.qty || 1) * (item.rate || 0));

    return '<div class="quote-item-row" style="display:grid;grid-template-columns:2fr 2fr 60px 90px 80px 36px;gap:8px;align-items:end;margin-bottom:8px;padding:10px 12px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Service</label><select class="q-item-service" onchange="QuotesPage._onServiceChange(this)" style="font-size:13px;"><option value="">— Select or type custom —</option>' + svcOptions + '</select></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Description</label><input class="q-item-desc" value="' + UI.esc(item.description || '') + '" placeholder="Work details..." style="font-size:13px;"></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Qty</label><input type="number" class="q-item-qty" value="' + (item.qty || 1) + '" min="1" oninput="QuotesPage.calcTotal()" style="font-size:13px;text-align:center;"></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Rate ($)</label><input type="number" class="q-item-rate" value="' + (item.rate || '') + '" step="0.01" placeholder="0.00" oninput="QuotesPage.calcTotal()" style="font-size:13px;"></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Amount</label><div class="q-item-amount" style="font-size:14px;font-weight:700;color:var(--green-dark);padding:8px 0;">' + UI.money(lineTotal) + '</div></div>'
      + '<button type="button" style="background:none;border:none;font-size:20px;color:var(--red);cursor:pointer;padding-bottom:8px;opacity:.6;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.6" onclick="this.parentElement.remove();QuotesPage.calcTotal();">✕</button>'
      + '</div>';
  },

  // Service-specific measurement prompts → auto-price
  _servicePricing: {
    'Tree Removal': { prompt: 'DBH (inches):', unit: 'inch', rate: 100, desc: function(v) { return v + '" DBH tree removal'; } },
    'Stump Removal': { prompt: 'Total stump radius (inches):', unit: 'inch', rate: 10, desc: function(v) { return v + '" radius stump grinding'; } },
    'Cabling': { prompt: 'Cable length (feet):', unit: 'foot', rate: 10, desc: function(v) { return v + '\' cable installation'; } }
  },

  _onServiceChange: function(sel) {
    var row = sel.closest('.quote-item-row');
    var svc = sel.value;
    var rateInput = row.querySelector('.q-item-rate');
    var descInput = row.querySelector('.q-item-desc');

    // Check for measurement-based pricing
    var pricing = QuotesPage._servicePricing[svc];
    if (pricing) {
      var measurement = prompt(pricing.prompt);
      if (measurement && !isNaN(parseFloat(measurement))) {
        var m = parseFloat(measurement);
        var price = Math.round(m * pricing.rate);
        rateInput.value = price;
        if (!descInput.value) descInput.value = pricing.desc(m);
      }
    } else {
      // Use default flat rate if set
      var rate = QuotesPage._defaultRates[svc];
      if (rate && rate > 0) {
        rateInput.value = rate;
      }
    }

    // Auto-fill description from service catalog if still empty
    if (!descInput.value) {
      var services = DB.services.getAll();
      var match = services.find(function(s) { return s.name === svc; });
      if (match && match.description) descInput.value = match.description;
    }
    QuotesPage.calcTotal();
  },

  addItem: function() {
    var container = document.getElementById('q-items');
    var index = container.children.length;
    var services = DB.services.getAll();
    var div = document.createElement('div');
    div.innerHTML = QuotesPage._itemRow(index, {}, services);
    container.appendChild(div.firstChild);
    // Focus the new service dropdown
    var newRow = container.lastElementChild;
    if (newRow) { var sel = newRow.querySelector('.q-item-service'); if (sel) sel.focus(); }
  },

  _toggleDeposit: function(checked) {
    var fields = document.getElementById('q-deposit-fields');
    var preview = document.getElementById('q-deposit-preview');
    var label = document.querySelector('#q-deposit-req + span');
    if (fields) fields.style.display = checked ? 'grid' : 'none';
    if (preview) preview.style.display = checked ? 'block' : 'none';
    if (label) label.textContent = checked ? 'On' : 'Off';
    if (checked) QuotesPage._calcDeposit();
  },

  _calcDeposit: function() {
    var totalEl = document.getElementById('q-total-display');
    var depTypeEl = document.getElementById('q-deposit-type');
    var depAmtEl = document.getElementById('q-deposit-amount');
    var preview = document.getElementById('q-deposit-preview');
    if (!preview) return;
    var total = parseFloat((totalEl ? totalEl.textContent : '0').replace(/[^0-9.]/g,'')) || 0;
    var type = depTypeEl ? depTypeEl.value : 'percent';
    var amount = depAmtEl ? parseFloat(depAmtEl.value) || 0 : 0;
    var due = type === 'percent' ? (total * amount / 100) : amount;
    preview.textContent = 'Deposit due: ' + (type === 'percent' ? amount + '% = ' : '') + '$' + due.toFixed(2) + (total > 0 ? ' of $' + total.toFixed(2) + ' total' : '');
  },

  calcTotal: function() {
    var subtotal = 0;
    document.querySelectorAll('.quote-item-row').forEach(function(row) {
      var qty = parseFloat(row.querySelector('.q-item-qty').value) || 0;
      var rate = parseFloat(row.querySelector('.q-item-rate').value) || 0;
      var lineTotal = qty * rate;
      subtotal += lineTotal;
      var amountEl = row.querySelector('.q-item-amount');
      if (amountEl) amountEl.textContent = UI.money(lineTotal);
    });
    var taxRateEl = document.getElementById('q-tax-rate');
    var taxRate = taxRateEl ? (parseFloat(taxRateEl.value) || 0) : 0;
    var taxAmt = Math.round(subtotal * taxRate / 100 * 100) / 100;
    var total = subtotal + taxAmt;
    var subEl = document.getElementById('q-subtotal-display');
    var taxEl = document.getElementById('q-tax-display');
    var totEl = document.getElementById('q-total-display');
    if (subEl) subEl.textContent = UI.money(subtotal);
    if (taxEl) taxEl.textContent = UI.money(taxAmt);
    if (totEl) totEl.textContent = UI.money(total);
  },

  saveAs: function(status) {
    var form = document.getElementById('quote-form');
    if (!form) return;
    // Store desired status, trigger save
    form.dataset.saveStatus = status;
    form.requestSubmit();
  },

  save: function(e, quoteId) {
    e.preventDefault();
    try { return QuotesPage._saveImpl(e, quoteId); }
    catch(err) {
      console.error('[QuotesPage.save] ERROR:', err);
      QuotesPage._saving = false;
      var f = e.target;
      if (f) f.querySelectorAll('button').forEach(function(b) { b.disabled = false; b.style.opacity = ''; b.style.cursor = ''; });
      UI.toast('Save failed: ' + (err && err.message ? err.message : err), 'error');
    }
  },

  _saveImpl: function(e, quoteId) {
    if (QuotesPage._saving) return;
    var form = e.target;
    var _disableButtons = function() {
      QuotesPage._saving = true;
      if (form) form.querySelectorAll('button[type=submit], button[onclick*="requestSubmit"], button[onclick*="saveAs"]').forEach(function(b) {
        b.disabled = true; b.style.opacity = '0.5'; b.style.cursor = 'wait';
      });
    };
    var _unsave = function() {
      QuotesPage._saving = false;
      if (form) form.querySelectorAll('button').forEach(function(b) {
        b.disabled = false; b.style.opacity = ''; b.style.cursor = '';
      });
    };

    var clientIdEl = document.getElementById('q-clientId');
    var clientId = clientIdEl ? clientIdEl.value : '';
    if (!clientId) {
      UI.toast('Client required — pick or create one before saving', 'error');
      var clientArea = document.getElementById('q-client-search') || document.getElementById('q-client-block') || clientIdEl;
      if (clientArea && clientArea.scrollIntoView) clientArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (clientArea) {
        var orig = clientArea.style.boxShadow;
        clientArea.style.boxShadow = '0 0 0 3px #dc3545';
        clientArea.style.transition = 'box-shadow .3s';
        setTimeout(function() { if (document.contains(clientArea)) clientArea.style.boxShadow = orig || ''; }, 2500);
      }
      return; // Don't disable — let user retry after picking client
    }
    var client = DB.clients.getById(clientId);
    if (!client) {
      UI.toast('Selected client no longer exists — pick another', 'error');
      return;
    }

    // Passed validation — NOW disable buttons to prevent double-submit
    _disableButtons();

    var items = [];
    var subtotal = 0;
    document.querySelectorAll('.quote-item-row').forEach(function(row) {
      var service = row.querySelector('.q-item-service').value;
      var desc = row.querySelector('.q-item-desc').value;
      var qty = parseFloat(row.querySelector('.q-item-qty').value) || 0;
      var rate = parseFloat(row.querySelector('.q-item-rate').value) || 0;
      if (service || desc || rate) {
        items.push({ service: service, description: desc, qty: qty, rate: rate, amount: qty * rate });
        subtotal += qty * rate;
      }
    });
    var taxRateVal = document.getElementById('q-tax-rate');
    var taxRate = taxRateVal ? (parseFloat(taxRateVal.value) || 0) : (parseFloat(localStorage.getItem('bm-tax-rate')) || 8.375);
    var taxAmount = Math.round(subtotal * taxRate / 100 * 100) / 100;
    var total = subtotal + taxAmount;

    // Deposit handled in settings/PDF, not on quote form
    var depositRequired = false;
    var depositType = 'percent';
    var depositAmount = 0;
    var depositDue = 0;
    var expiresEl = document.getElementById('q-expires');
    var expiresAt = expiresEl ? expiresEl.value : new Date(Date.now() + 30*86400000).toISOString().split('T')[0];

    var existingQ = quoteId ? DB.quotes.getById(quoteId) : {};
    var data = {
      clientId: clientId,
      clientName: client ? client.name : '',
      clientEmail: (client && client.email) || '',
      clientPhone: (client && client.phone) || '',
      property: document.getElementById('q-property').value.trim() || (client && client.address) || '',
      description: document.getElementById('q-description').value.trim(),
      lineItems: items,
      subtotal: subtotal,
      taxRate: taxRate,
      taxAmount: taxAmount,
      total: total,
      notes: document.getElementById('q-notes').value.trim(),
      status: form.dataset.saveStatus || 'draft',
      // Preserve origin request link (don't lose on edit)
      requestId: QuotesPage._originRequestId || existingQ.requestId || null,
      depositRequired: depositRequired,
      depositType: depositType,
      depositAmount: depositAmount,
      depositDue: depositDue,
      expiresAt: expiresAt,
      options: null,
      timeMaterial: (function() {
        var climberHrs = parseFloat((document.getElementById('q-tm-climber-hrs') || {}).value) || 0;
        var groundCount = parseFloat((document.getElementById('q-tm-ground-count') || {}).value) || 0;
        var groundHrs = parseFloat((document.getElementById('q-tm-ground-hrs') || {}).value) || 0;
        var totalHrs = parseFloat((document.getElementById('q-tm-total-hrs') || {}).value) || 0;
        var disposal = parseFloat((document.getElementById('q-tm-disposal') || {}).value) || 0;
        if (!climberHrs && !groundHrs && !totalHrs) return null;
        return {
          climberHrs: climberHrs, groundCount: groundCount, groundHrs: groundHrs,
          totalHrs: totalHrs, disposal: disposal,
          bucket: !!(document.getElementById('q-tm-bucket') || {}).checked,
          chipper: !!(document.getElementById('q-tm-chipper') || {}).checked,
          crane: !!(document.getElementById('q-tm-crane') || {}).checked,
          stumpGrinder: !!(document.getElementById('q-tm-stumpgrinder') || {}).checked,
          tmTotal: QuotesPage._calcTM()
        };
      })()
    };

    var savedId;
    if (quoteId) {
      DB.quotes.update(quoteId, data);
      UI.toast('Quote updated');
      savedId = quoteId;
    } else {
      var newQ = DB.quotes.create(data);
      UI.toast('Quote created');
      savedId = newQ.id;
    }

    QuotesPage._clearAutoSave();
    if (client && client.status === 'lead') DB.clients.update(clientId, { status: 'active' });
    _unsave();
    if (document.querySelector('.modal-overlay')) UI.closeModal();

    if (data.status === 'sent' && savedId) {
      QuotesPage._sendQuote(savedId);
    } else {
      loadPage('quotes');
    }
  },

  showDetail: function(id) {
    var q = DB.quotes.getById(id);
    if (!q) return;

    // Jobber-style quote detail
    var statusColors = {draft:'#6c757d',sent:'#e07c24',awaiting:'#e07c24',approved:'#2e7d32',converted:'#2e7d32',declined:'#dc3545'};
    var statusColor = statusColors[q.status] || '#8b2252';
    var client = q.clientId ? DB.clients.getById(q.clientId) : null;

    var html = '<div style="max-width:960px;margin:0 auto;">'
      // Top bar: back + actions
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">'
      + '<button class="btn btn-outline" onclick="loadPage(\'quotes\')" style="padding:6px 12px;font-size:12px;">← Back to Quotes</button>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
      + '<button class="btn btn-outline" onclick="QuotesPage._copyApprovalLink(\'' + id + '\')" style="font-size:12px;">Copy Link</button>'
      + (q.status !== 'converted' && q.status !== 'declined'
          ? '<button class="btn btn-outline" onclick="QuotesPage._sendQuote(\'' + id + '\')" style="font-size:12px;">Send Quote</button>' : '')
      + (q.status === 'approved' || q.status === 'converted'
          ? '<button class="btn btn-primary" onclick="if(typeof Workflow!==\'undefined\')Workflow.quoteToJob(\'' + id + '\');loadPage(\'jobs\');" style="font-size:12px;">Convert to Job</button>'
          : '<button class="btn btn-primary" onclick="QuotesPage.showForm(\'' + id + '\')" style="font-size:12px;">Edit Quote</button>')
      + '<div style="position:relative;display:inline-block;">'
      + '<button onclick="var d=this.nextElementSibling;document.querySelectorAll(\'.more-dd\').forEach(function(x){x.style.display=\'none\'});d.style.display=d.style.display===\'block\'?\'none\':\'block\';" class="btn btn-outline" style="font-size:13px;padding:6px 10px;">•••</button>'
      + '<div class="more-dd" style="display:none;position:absolute;right:0;top:calc(100% + 4px);background:#fff;border:1px solid var(--border);border-radius:8px;padding:4px 0;z-index:200;min-width:180px;box-shadow:0 4px 16px rgba(0,0,0,.12);">'
      + '<button onclick="QuotesPage.showForm(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:var(--text);">Edit Quote</button>'
      + '<button onclick="QuotesPage._sendQuote(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:var(--text);">Send to Client</button>'
      + '<button onclick="QuotesPage._copyApprovalLink(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:var(--text);">Copy Approval Link</button>'
      + '<button onclick="PDF.generateQuote(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:var(--text);">Download PDF</button>'
      + '<button onclick="QuotesPage._quickFollowUp(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:var(--text);">Send Follow-up</button>'
      + '<div style="height:1px;background:var(--border);margin:4px 0;"></div>'
      + '<button onclick="QuotesPage.setStatus(\'' + id + '\',\'declined\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#dc3545;">Mark Declined</button>'
      + '<button onclick="QuotesPage._archiveQuote(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:var(--text-light);">Archive</button>'
      + '<button onclick="QuotesPage._deleteQuote(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#dc3545;">Delete Quote</button>'
      + '</div></div>'
      + '</div></div>'

      // Single header card — no duplication
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px;">'
      + '<div style="height:4px;background:' + statusColor + ';"></div>'
      + '<div style="padding:20px 24px;">'
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px;">'
      + '<div>'
      + '<h2 style="font-size:22px;font-weight:700;margin:0 0 4px;">Quote #' + (q.quoteNumber||'') + ' — ' + UI.esc(q.clientName || '—') + '</h2>'
      + '<div style="font-size:13px;color:var(--text-light);">' + UI.dateShort(q.createdAt) + (q.sentAt ? ' · Sent ' + UI.dateShort(q.sentAt) : '') + '</div>'
      + (q.property ? '<a href="https://maps.apple.com/?daddr=' + encodeURIComponent(q.property) + '" target="_blank" style="display:block;font-size:13px;color:var(--accent);margin-top:2px;text-decoration:none;">📍 ' + UI.esc(q.property) + ' →</a>' : '')
      + '</div>'
      + '<div style="text-align:right;">' + UI.statusBadge(q.status) + '<div style="font-size:24px;font-weight:800;color:var(--accent);margin-top:6px;">' + UI.money(q.total) + '</div></div>'
      + '</div>'
      // Contact + details in one row
      + '<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:13px;color:var(--text-light);border-top:1px solid var(--border);padding-top:12px;">'
      + (q.clientPhone || (client && client.phone) ? '<a href="tel:' + (q.clientPhone || client.phone).replace(/\D/g,'') + '" style="color:var(--accent);">📞 ' + (q.clientPhone || client.phone) + '</a>' : '')
      + (q.clientEmail || (client && client.email) ? '<a href="mailto:' + (q.clientEmail || client.email) + '" style="color:var(--accent);">✉️ ' + (q.clientEmail || client.email) + '</a>' : '')
      + (q.expiresAt ? (function() {
          var exp = new Date(q.expiresAt); var now = new Date();
          var days = Math.ceil((exp - now) / 86400000);
          var color = days < 0 ? '#dc3545' : days <= 5 ? '#e6a817' : 'var(--text-light)';
          var label = days < 0 ? 'Expired ' + Math.abs(days) + 'd ago' : days === 0 ? 'Expires today' : 'Valid ' + days + 'd';
          return '<span style="color:' + color + ';">⏱ ' + label + '</span>';
        })() : '')
      + (q.depositRequired ? '<span>' + (q.depositPaid ? '✅ Deposit paid' : '⚠️ Deposit due: ' + UI.money(q.depositDue)) + '</span>' : '')
      + (q.source ? '<span>📣 ' + UI.esc(q.source) + '</span>' : '')
      + (q.requestId ? '<a onclick="RequestsPage._pendingDetail=\'' + q.requestId + '\';loadPage(\'requests\');" style="color:var(--accent);cursor:pointer;">📥 From Request</a>' : '')
      + '</div>'
      + '</div></div>'

      // Description
      + (q.description ? '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">'
        + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Description</h4>'
        + '<p style="font-size:14px;line-height:1.6;margin:0;word-wrap:break-word;overflow-wrap:break-word;white-space:pre-wrap;">' + UI.esc(q.description) + '</p></div>' : '')

      // Line items (Product / Service) — inline editor
      + QuotesPage.renderLineItems(q, id)

      // Video walkthrough (full width, above photos)
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Video Walkthrough</h4>'
      + (q.videoUrl
        ? '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;margin-bottom:8px;">'
          + '<iframe src="' + q.videoUrl.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/') + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen></iframe></div>'
          + '<div style="display:flex;gap:6px;">'
          + '<button class="btn btn-outline" style="font-size:11px;" onclick="navigator.clipboard.writeText(\'' + UI.esc(q.videoUrl) + '\');UI.toast(\'Video link copied!\')">🔗 Copy Link</button>'
          + '<button class="btn btn-outline" style="font-size:11px;" onclick="QuotesPage._removeVideo(\'' + id + '\')">🗑 Remove</button>'
          + '</div>'
        : '<div style="text-align:center;padding:16px;background:var(--bg);border-radius:8px;">'
          + '<div style="font-size:24px;margin-bottom:8px;">🎥</div>'
          + '<div style="font-size:13px;color:var(--text-light);margin-bottom:8px;">Record a property walkthrough and attach it to this quote</div>'
          + '<button class="btn btn-primary" style="font-size:12px;" onclick="QuotesPage._addVideo(\'' + id + '\')">+ Add Video</button>'
          + '</div>')
      + '</div>'

      // Photos + Notes + Actions in bottom section
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;" class="detail-grid">'

      // Photos
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Photos</h4>';
    if (typeof Photos !== 'undefined') { html += Photos.renderGallery('quote', id); }
    else { html += '<div style="color:var(--text-light);font-size:13px;">No photos</div>'; }
    html += '</div>'

      // Notes + Actions
      + '<div>'
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Internal Notes</h4>'
      + (q.notes ? '<div style="font-size:13px;line-height:1.6;">' + UI.esc(q.notes) + '</div>' : '<div style="color:var(--text-light);font-size:13px;">No notes</div>')
      + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:6px;">'
      + '<button class="btn btn-outline" style="width:100%;justify-content:center;font-size:12px;" onclick="PDF.generateQuote(\'' + id + '\')">📄 Download PDF</button>'
      + (q.property ? '<button class="btn btn-outline" style="width:100%;justify-content:center;font-size:12px;" onclick="PropertyMap.show(\'' + (q.property || '').replace(/'/g, "\\'") + '\')">📐 Equipment Layout</button>' : '')
      + (q.status !== 'converted' ? '<button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="if(typeof Workflow!==\'undefined\')Workflow.quoteToJob(\'' + id + '\');loadPage(\'jobs\');">✅ Convert to Job</button>' : '')
      + '</div></div>'

      + '</div>'
      + '</div>'; // close max-width wrapper

    // Render full page
    document.getElementById('pageTitle').textContent = 'Quote #' + q.quoteNumber;
    document.getElementById('pageContent').innerHTML = html;
    document.getElementById('pageAction').style.display = 'none';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  },

  _getApprovalLink: function(id) {
    // Generate or retrieve approval token for CSRF protection
    var q = DB.quotes.getById(id);
    var token = q && q.approvalToken;
    if (!token) {
      token = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 16);
      DB.quotes.update(id, { approvalToken: token });
    }
    return 'https://peekskilltree.com/branchmanager/approve.html?id=' + id + '&token=' + token;
  },

  _copyApprovalLink: function(id) {
    var link = QuotesPage._getApprovalLink(id);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(function() { UI.toast('Approval link copied!'); }).catch(function() { UI.toast('Could not copy — use Ctrl+C', 'error'); });
    } else {
      var el = document.getElementById('approval-link-input');
      if (el) { el.select(); document.execCommand('copy'); UI.toast('Approval link copied!'); }
    }
  },

  _sendQuote: function(id) {
    var q = DB.quotes.getById(id);
    if (!q) return;

    // Get client email
    var client = q.clientId ? DB.clients.getById(q.clientId) : null;
    var email = (client && client.email) || q.clientEmail || '';
    var firstName = (q.clientName || '').split(' ')[0] || 'there';
    var approvalLink = QuotesPage._getApprovalLink(id);

    // Build email preview (Jobber style)
    var _co = QuotesPage._co();
    var subject = 'Quote #' + q.quoteNumber + ' from ' + _co.name + ' — ' + UI.money(q.total);
    var body = 'Hi ' + firstName + ',\n\n'
      + 'Thanks for reaching out to ' + _co.name + '! Here\'s your quote for the work we discussed:\n\n'
      + '📋 Quote #' + q.quoteNumber + '\n'
      + '📍 ' + (q.property || 'Property on file') + '\n'
      + '💰 Total: ' + UI.money(q.total) + '\n\n';
    if (q.description) body += 'Scope: ' + q.description + '\n\n';
    body += '👉 View & approve your quote online:\n' + approvalLink + '\n\n'
      + 'This quote is valid for 30 days. Click the link above to approve or request changes — no login required.\n\n'
      + 'Questions? Reply to this email or call ' + _co.phone + '.\n\n'
      + 'Thanks,\nDoug Brown\n' + _co.name + '\n' + _co.phone + '\n' + _co.website + '\nLicensed & Fully Insured — ' + _co.licenses;

    // Build line items summary for review
    var itemsSummary = '';
    if (q.lineItems && q.lineItems.length) {
      q.lineItems.forEach(function(item) {
        var amt = item.amount || ((item.qty || 1) * (item.rate || 0));
        itemsSummary += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:13px;">'
          + '<span>' + UI.esc(item.service || item.description || 'Service') + '</span>'
          + '<span style="font-weight:600;">' + UI.money(amt) + '</span></div>';
      });
    }

    var html = '<div style="padding:16px;">'
      // Review card — read only
      + '<div style="background:var(--bg);border-radius:10px;padding:16px;margin-bottom:16px;">'
      + '<div style="font-size:13px;color:var(--text-light);margin-bottom:4px;">Sending to</div>'
      + '<div style="font-size:16px;font-weight:700;">' + UI.esc(email || 'No email on file') + '</div>'
      + '<input type="hidden" id="send-to" value="' + UI.esc(email) + '">'
      + '</div>'

      // Quote summary
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
      + '<div style="font-size:15px;font-weight:700;">Quote #' + q.quoteNumber + '</div>'
      + '<div style="font-size:20px;font-weight:800;color:var(--green-dark);">' + UI.money(q.total) + '</div>'
      + '</div>'
      + '<div style="font-size:13px;color:var(--text-light);margin-bottom:8px;">' + UI.esc(q.clientName || '') + ' · ' + UI.esc(q.property || '') + '</div>'
      + (q.description ? '<div style="font-size:13px;margin-bottom:10px;word-wrap:break-word;overflow-wrap:break-word;white-space:pre-wrap;">' + UI.esc(q.description) + '</div>' : '')
      + itemsSummary
      + '</div>'

      // Approval link
      + '<div style="background:#e8f5e9;border-radius:8px;padding:12px 14px;margin-bottom:16px;border-left:3px solid var(--green-dark);">'
      + '<div style="font-size:12px;font-weight:700;color:var(--green-dark);margin-bottom:6px;">Client Approval Link</div>'
      + '<div style="display:flex;gap:6px;align-items:center;">'
      + '<input id="approval-link-input" type="text" readonly value="' + approvalLink + '" style="flex:1;font-size:11px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;color:#333;">'
      + '<button onclick="QuotesPage._copyApprovalLink(\'' + id + '\')" style="background:var(--green-dark);color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Copy</button>'
      + '</div>'
      + '<div style="font-size:11px;color:var(--text-light);margin-top:4px;">Or copy link and text it directly</div>'
      + '</div>'

      // Hidden fields for the send function
      + '<input type="hidden" id="send-subject" value="' + UI.esc(subject) + '">'
      + '<input type="hidden" id="send-body" value="' + UI.esc(body) + '">'
      + '</div>';

    UI.showModal('Send Quote #' + q.quoteNumber, html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-outline" onclick="PDF.generateQuote(\'' + id + '\')">👁 Preview PDF</button>'
        + ' <button class="btn btn-primary" onclick="QuotesPage._confirmSend(\'' + id + '\')">📧 Send Quote</button>'
    });
  },

  _confirmSend: function(id) {
    var to = document.getElementById('send-to').value.trim();
    if (!to) { UI.toast('Enter an email address', 'error'); return; }

    var subject = document.getElementById('send-subject').value;
    var body = document.getElementById('send-body').value;
    var q = DB.quotes.getById(id);

    // Disable button to prevent double-send
    var sendBtn = document.querySelector('.modal-footer .btn-primary');
    if (sendBtn) { sendBtn.textContent = 'Sending...'; sendBtn.disabled = true; }

    UI.closeModal();

    // Build branded HTML email
    var approvalLink = QuotesPage._getApprovalLink(id);
    var firstName = (q && q.clientName ? q.clientName.split(' ')[0] : 'there');

    var lineItemsHtml = '';
    if (q && q.lineItems && q.lineItems.length) {
      lineItemsHtml = '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">'
        + '<tr style="background:#f0f9f4;"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#555;font-weight:600;border-bottom:2px solid #c8e6c9;">SERVICE</th><th style="padding:8px 12px;text-align:right;font-size:12px;color:#555;font-weight:600;border-bottom:2px solid #c8e6c9;">AMOUNT</th></tr>';
      q.lineItems.forEach(function(item) {
        var amt = item.amount || ((item.qty||1) * (item.rate||0));
        lineItemsHtml += '<tr><td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">' + (item.service||item.description||'Service') + '</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #e0e0e0;font-weight:600;">' + UI.money(amt) + '</td></tr>';
      });
      if (q.subtotal && q.taxRate) {
        lineItemsHtml += '<tr><td style="padding:6px 12px;color:#718096;">Subtotal</td><td style="padding:6px 12px;text-align:right;">' + UI.money(q.subtotal) + '</td></tr>';
        lineItemsHtml += '<tr><td style="padding:6px 12px;color:#718096;">Tax (' + q.taxRate + '%)</td><td style="padding:6px 12px;text-align:right;">' + UI.money(q.taxAmount || 0) + '</td></tr>';
      }
      lineItemsHtml += '<tr style="background:#f0f9f4;"><td style="padding:10px 12px;font-weight:700;">Quote Total</td><td style="padding:10px 12px;text-align:right;font-weight:800;color:#00836c;font-size:16px;">' + UI.money(q.total) + '</td></tr>';
      lineItemsHtml += '</table>';
    }

    var htmlBody = '<div style="background:#f5f6f8;padding:24px 0;">'
      + '<div style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">'
      + '<div style="background:linear-gradient(135deg,#1a3c12 0%,#00836c 100%);border-radius:12px 12px 0 0;padding:24px 28px;color:#fff;">'
      + '<div style="font-size:13px;opacity:.8;margin-bottom:4px;">🌳 ' + _co.name + '</div>'
      + '<div style="font-size:24px;font-weight:900;letter-spacing:-.5px;">Quote #' + (q ? q.quoteNumber : '') + '</div>'
      + '<div style="font-size:38px;font-weight:900;margin:6px 0 4px;letter-spacing:-1px;">' + UI.money(q ? q.total : 0) + '</div>'
      + '<div style="font-size:13px;opacity:.75;">' + (q && q.property ? '📍 ' + q.property : '') + '</div>'
      + '</div>'
      + '<div style="background:#fff;border-radius:0 0 12px 12px;padding:24px 28px;">'
      + '<p style="font-size:15px;color:#2d3748;margin-bottom:12px;">Hi ' + firstName + ',</p>'
      + '<p style="font-size:14px;color:#4a5568;line-height:1.6;margin-bottom:16px;">Thanks for reaching out to ' + _co.name + '! Here\'s the quote for the work we discussed. You can approve it online — no login required.</p>'
      + (q && q.description ? '<p style="font-size:13px;color:#718096;background:#f7fafc;padding:10px 12px;border-radius:6px;margin-bottom:16px;"><strong>Scope:</strong> ' + q.description + '</p>' : '')
      + lineItemsHtml
      + '<div style="text-align:center;margin:24px 0;">'
      + '<a href="' + approvalLink + '" style="display:inline-block;background:linear-gradient(135deg,#00836c,#1a3c12);color:#fff;padding:16px 36px;border-radius:10px;font-size:17px;font-weight:800;text-decoration:none;box-shadow:0 4px 14px rgba(0,131,108,.35);">✅ View & Approve Quote</a>'
      + '</div>'
      + '<p style="font-size:12px;color:#a0aec0;text-align:center;margin-bottom:20px;">This quote is valid for 30 days. Click above to approve or request changes.</p>'
      + '<p style="font-size:13px;color:#718096;">Questions? Reply to this email or call/text <strong>' + _co.phone + '</strong>.</p>'
      + '<p style="font-size:13px;color:#2d3748;margin-top:12px;">Thanks,<br><strong>Doug Brown</strong><br>' + _co.name + '<br>Licensed & Insured — ' + _co.licenses + '</p>'
      + '</div></div></div>';

    if (typeof Email !== 'undefined') {
      Email.send(to, subject, body, { htmlBody: htmlBody }).then(function(result) {
        if (result && result.ok) {
          UI.toast('Quote sent to ' + to + ' ✓');
        } else {
          UI.toast('Email sent (check for errors)', 'warning');
        }
      }).catch(function() {
        UI.toast('Failed to send email', 'error');
      });
    } else {
      window.open('mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), '_blank');
    }

    // Mark as sent
    DB.quotes.update(id, { status: 'sent', sentAt: new Date().toISOString(), sentTo: to });
    QuotesPage.showDetail(id);
  },

  setStatus: function(id, status) {
    DB.quotes.update(id, { status: status });

    // Auto-convert approved quotes to jobs (Jobber-style pipeline)
    if (status === 'approved') {
      var q = DB.quotes.getById(id);
      if (q && !q.convertedJobId) {
        UI.confirm('Quote approved! Create a job from this quote?', function() {
          if (typeof Workflow !== 'undefined') {
            var job = Workflow.quoteToJob(id);
            if (job) { UI.toast('✅ Job #' + job.jobNumber + ' created'); loadPage('jobs'); return; }
          }
          QuotesPage.showDetail(id);
        }, function() { UI.toast('Quote approved'); QuotesPage.showDetail(id); });
        return;
      }
    }
    UI.toast('Quote status: ' + status);
    QuotesPage.showDetail(id);
  },

  // ── Service-first then photo ──
  _addWithServiceAndPhoto: function() {
    var sel = document.getElementById('q-add-service');
    var svc = sel ? sel.value : '';
    if (!svc) { UI.toast('Select a service first'); return; }

    // Prompt for measurement based on service
    var pricing = QuotesPage._servicePricing[svc];
    var measurement = null;
    var rate = 0;
    var desc = '';
    if (pricing) {
      measurement = prompt(pricing.prompt);
      if (!measurement || isNaN(parseFloat(measurement))) { measurement = null; }
      else {
        var m = parseFloat(measurement);
        rate = Math.round(m * pricing.rate);
        desc = pricing.desc(m);
      }
    }

    // Add line item with service pre-filled
    QuotesPage.addItem();
    var rows = document.querySelectorAll('.quote-item-row');
    var lastRow = rows[rows.length - 1];
    if (lastRow) {
      var svcEl = lastRow.querySelector('.q-item-service');
      if (svcEl) svcEl.value = svc;
      if (desc) { var descEl = lastRow.querySelector('.q-item-desc'); if (descEl) descEl.value = desc; }
      if (rate) { var rateEl = lastRow.querySelector('.q-item-rate'); if (rateEl) rateEl.value = rate; }
      QuotesPage.calcTotal();
    }

    // Store selected service for AI context
    QuotesPage._pendingService = svc;

    // Now open camera
    QuotesPage._addTreePhoto();
  },

  _addTreePhoto: function() {
    // Use camera or file input — no `capture` attr so iOS/Android show the
    // native picker (Take Photo / Photo Library / Browse) instead of forcing camera.
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        var dataUrl = ev.target.result;
        // Use existing last row (already added by _addWithServiceAndPhoto) or add new
        var rows = document.querySelectorAll('.quote-item-row');
        if (!rows.length || QuotesPage._pendingService) {
          // Row already added by _addWithServiceAndPhoto, use last one
        } else {
          QuotesPage.addItem();
          rows = document.querySelectorAll('.quote-item-row');
        }
        var lastRow = rows[rows.length - 1];
        if (lastRow) {
          // Store photo on the row
          lastRow.dataset.photo = dataUrl;
          // Add photo thumbnail before the row content
          var thumb = document.createElement('div');
          thumb.style.cssText = 'margin-bottom:8px;';
          thumb.innerHTML = '<img src="' + dataUrl + '" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--border);">';
          lastRow.insertBefore(thumb, lastRow.firstChild);
        }

        // Try AI identification
        QuotesPage._identifyTree(dataUrl, rows.length - 1);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  },

  _identifyTree: function(imageDataUrl, rowIndex) {
    // Guard against concurrent calls (duplicates wasted API credits)
    if (QuotesPage._identifying) {
      UI.toast('Already identifying a tree, please wait...', 'error');
      return;
    }
    // Send to AI for tree identification
    var aiKey = localStorage.getItem('bm-claude-key');
    if (!aiKey) {
      // No AI key — just add the photo, user fills in manually
      UI.toast('Add AI key in Settings for auto tree ID');
      QuotesPage.addItem();
      return;
    }

    QuotesPage._identifying = true;
    UI.toast('Identifying tree...');

    // Extract base64 from data URL
    var base64 = imageDataUrl.split(',')[1];
    var mediaType = imageDataUrl.split(';')[0].split(':')[1];

    fetch('https://ltpivkqahvplapyagljt.supabase.co/functions/v1/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: aiKey,
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'You are a certified arborist in ZIP ' + (localStorage.getItem('bm-zip') || '10566') + '. The selected service is: ' + (QuotesPage._pendingService || 'Tree Service') + '. Identify this tree and assess for that service. Respond in ONLY this JSON format: {"species":"Common Name","dbh":"estimated diameter in inches","condition":"good/fair/poor/dead","notes":"1 sentence assessment for the selected service","suggestedService":"' + (QuotesPage._pendingService || 'Tree Removal or Tree Pruning or Stump Grinding') + '","diseases":"top disease risk for this species"}' }
          ]
        }]
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var text = data.content && data.content[0] ? data.content[0].text : '';
      try {
        // Parse JSON from response
        var match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON');
        var tree = JSON.parse(match[0]);

        // Fill in the line item
        var rows = document.querySelectorAll('.quote-item-row');
        var row = rows[rowIndex];
        if (row) {
          var serviceEl = row.querySelector('.q-item-service');
          var descEl = row.querySelector('.q-item-desc');
          var rateEl = row.querySelector('.q-item-rate');
          var qtyEl = row.querySelector('.q-item-qty');

          if (serviceEl) serviceEl.value = tree.suggestedService || 'Tree Removal';
          if (descEl) descEl.value = tree.species + ' — ' + (tree.dbh || '?') + '" DBH — ' + (tree.condition || '') + (tree.notes ? ' — ' + tree.notes : '');
          if (qtyEl) qtyEl.value = '1';

          // Price suggestion: $100 per inch of DBH
          var dbh = parseInt(tree.dbh) || 18;
          var suggestedPrice = Math.round(dbh * 100 / 50) * 50; // round to nearest $50
          if (rateEl) rateEl.value = suggestedPrice;

          QuotesPage.calcTotal();
          UI.toast('🌳 ' + tree.species + ' — ' + tree.dbh + '" DBH — $' + suggestedPrice + ' suggested');
          QuotesPage.addItem();
        }
      } catch(e) {
        console.warn('Tree ID parse error:', e, text);
        UI.toast('Could not identify — fill in manually');
        QuotesPage.addItem();
      }
      QuotesPage._identifying = false;
    })
    .catch(function(e) {
      console.warn('Tree ID error:', e);
      UI.toast('AI unavailable — fill in manually');
      QuotesPage.addItem();
      QuotesPage._identifying = false;
    });
  },

  // ── Dual Pricing (removed tabs — now sequential) ──
  _showPricingMode: function(mode) {
    var pertree = document.getElementById('q-mode-pertree');
    var tm = document.getElementById('q-mode-tm');
    var tabPT = document.getElementById('q-tab-pertree');
    var tabTM = document.getElementById('q-tab-tm');
    if (mode === 'pertree') {
      pertree.style.display = 'block'; tm.style.display = 'none';
      tabPT.style.background = 'var(--green-dark)'; tabPT.style.color = '#fff';
      tabTM.style.background = 'var(--bg)'; tabTM.style.color = 'var(--text-light)';
    } else {
      pertree.style.display = 'none'; tm.style.display = 'block';
      tabTM.style.background = 'var(--accent)'; tabTM.style.color = '#fff';
      tabPT.style.background = 'var(--bg)'; tabPT.style.color = 'var(--text-light)';
    }
  },

  // ── Time & Material Calculator ──
  _TM_RATES: {
    climber: 50, ground: 30, bucket: 75, chipper: 44, crane: 200, stumpGrinder: 50,
    insurance: 0.31, // WC 9% + GL 9% + disability 2% + payroll 8% + auto 3%
    markup: 1.5 // 50% markup on cost
  },

  _calcTM: function() {
    var r = QuotesPage._TM_RATES;
    var climberHrs = parseFloat(document.getElementById('q-tm-climber-hrs').value) || 0;
    var groundCount = parseFloat(document.getElementById('q-tm-ground-count').value) || 0;
    var groundHrs = parseFloat(document.getElementById('q-tm-ground-hrs').value) || 0;
    var totalHrs = parseFloat(document.getElementById('q-tm-total-hrs').value) || 0;
    var disposal = parseFloat(document.getElementById('q-tm-disposal').value) || 0;
    var bucket = document.getElementById('q-tm-bucket').checked;
    var chipper = document.getElementById('q-tm-chipper').checked;
    var crane = document.getElementById('q-tm-crane').checked;
    var stumpGrinder = document.getElementById('q-tm-stumpgrinder').checked;

    var laborCost = (climberHrs * r.climber) + (groundCount * groundHrs * r.ground);
    var equipCost = (bucket ? totalHrs * r.bucket : 0) + (chipper ? totalHrs * r.chipper : 0)
      + (crane ? totalHrs * r.crane : 0) + (stumpGrinder ? totalHrs * r.stumpGrinder : 0);
    var insuranceCost = laborCost * r.insurance;
    var subtotalCost = laborCost + equipCost + insuranceCost + disposal;
    var tmTotal = Math.round(subtotalCost * r.markup);

    // Show breakdown
    var breakdown = document.getElementById('q-tm-breakdown');
    if (breakdown) {
      breakdown.innerHTML = '<div style="display:flex;justify-content:space-between;padding:3px 0;"><span>Labor</span><span>' + UI.money(laborCost) + '</span></div>'
        + '<div style="display:flex;justify-content:space-between;padding:3px 0;"><span>Equipment</span><span>' + UI.money(equipCost) + '</span></div>'
        + '<div style="display:flex;justify-content:space-between;padding:3px 0;"><span>Insurance (31%)</span><span>' + UI.money(insuranceCost) + '</span></div>'
        + (disposal > 0 ? '<div style="display:flex;justify-content:space-between;padding:3px 0;"><span>Disposal</span><span>' + UI.money(disposal) + '</span></div>' : '')
        + '<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border);font-weight:600;"><span>Cost</span><span>' + UI.money(subtotalCost) + '</span></div>'
        + '<div style="display:flex;justify-content:space-between;padding:3px 0;font-weight:700;color:var(--accent);"><span>T&M Price (1.5x)</span><span>' + UI.money(tmTotal) + '</span></div>';
    }
    var tmTotalEl = document.getElementById('q-tm-total');
    if (tmTotalEl) tmTotalEl.textContent = 'T&M Total: ' + UI.money(tmTotal);

    // Show compare button if both modes have data
    var compareBtn = document.getElementById('q-compare-btn');
    if (compareBtn && tmTotal > 0) compareBtn.style.display = 'block';

    return tmTotal;
  },

  // ── Price Comparison Page ──
  _showPriceComparison: function() {
    // Get per-tree total
    var perTreeTotal = 0;
    document.querySelectorAll('.quote-item-row').forEach(function(row) {
      var qty = parseFloat(row.querySelector('.q-item-qty').value) || 0;
      var rate = parseFloat(row.querySelector('.q-item-rate').value) || 0;
      perTreeTotal += qty * rate;
    });

    // Get T&M total
    var tmTotal = QuotesPage._calcTM();
    var average = Math.round((perTreeTotal + tmTotal) / 2);
    var diff = Math.abs(perTreeTotal - tmTotal);
    var diffPct = perTreeTotal > 0 ? Math.round((diff / perTreeTotal) * 100) : 0;

    // Determine which is higher
    var higher = perTreeTotal >= tmTotal ? 'Per Tree' : 'T&M';
    var barMax = Math.max(perTreeTotal, tmTotal, 1);

    var panel = document.getElementById('q-comparison');
    if (!panel) return;

    panel.style.display = 'block';
    panel.innerHTML = '<div style="font-size:16px;font-weight:800;margin-bottom:16px;color:#5b21b6;">📊 Price Comparison</div>'

      // Per Tree bar
      + '<div style="margin-bottom:12px;">'
      + '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:4px;"><span>Per Tree/Task</span><span>' + UI.money(perTreeTotal) + '</span></div>'
      + '<div style="background:#e2e8f0;border-radius:6px;height:8px;"><div style="background:var(--green-dark);border-radius:6px;height:100%;width:' + Math.round((perTreeTotal / barMax) * 100) + '%;"></div></div>'
      + '</div>'

      // T&M bar
      + '<div style="margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:4px;"><span>Time & Material</span><span>' + UI.money(tmTotal) + '</span></div>'
      + '<div style="background:#e2e8f0;border-radius:6px;height:8px;"><div style="background:var(--accent);border-radius:6px;height:100%;width:' + Math.round((tmTotal / barMax) * 100) + '%;"></div></div>'
      + '</div>'

      // Average
      + '<div style="background:#fff;border-radius:8px;padding:14px;text-align:center;border:2px solid #7c3aed;">'
      + '<div style="font-size:12px;color:var(--text-light);margin-bottom:4px;">RECOMMENDED PRICE (Average)</div>'
      + '<div style="font-size:28px;font-weight:800;color:#5b21b6;">' + UI.money(average) + '</div>'
      + '<div style="font-size:12px;color:var(--text-light);margin-top:4px;">Difference: ' + UI.money(diff) + ' (' + diffPct + '%) — ' + higher + ' is higher</div>'
      + '</div>'

      // Use buttons
      + '<div style="display:flex;gap:8px;margin-top:12px;">'
      + '<button type="button" onclick="QuotesPage._usePrice(' + perTreeTotal + ')" class="btn btn-outline" style="flex:1;font-size:12px;">Use Per Tree (' + UI.money(perTreeTotal) + ')</button>'
      + '<button type="button" onclick="QuotesPage._usePrice(' + average + ')" class="btn btn-primary" style="flex:1;font-size:12px;background:#7c3aed;">Use Average (' + UI.money(average) + ')</button>'
      + '<button type="button" onclick="QuotesPage._usePrice(' + tmTotal + ')" class="btn btn-outline" style="flex:1;font-size:12px;">Use T&M (' + UI.money(tmTotal) + ')</button>'
      + '</div>';

    // Scroll to comparison
    panel.scrollIntoView({ behavior: 'smooth' });
  },

  _usePrice: function(price) {
    // Update the first line item or add a total adjustment to match the selected price
    var currentTotal = 0;
    document.querySelectorAll('.quote-item-row').forEach(function(row) {
      currentTotal += (parseFloat(row.querySelector('.q-item-qty').value) || 0) * (parseFloat(row.querySelector('.q-item-rate').value) || 0);
    });

    if (Math.abs(currentTotal - price) < 1) {
      UI.toast('Price already matches');
      return;
    }

    var diff = price - currentTotal;
    if (diff > 0) {
      // Add a line item for the adjustment
      QuotesPage.addItem();
      setTimeout(function() {
        var rows = document.querySelectorAll('.quote-item-row');
        var last = rows[rows.length - 1];
        if (last) {
          last.querySelector('.q-item-service').value = 'Price adjustment';
          last.querySelector('.q-item-desc').value = 'Adjusted to match production estimate';
          last.querySelector('.q-item-qty').value = '1';
          last.querySelector('.q-item-rate').value = diff.toFixed(2);
        }
        QuotesPage.calcTotal();
        UI.toast('Price adjusted to ' + UI.money(price));
      }, 100);
    } else {
      UI.toast('To lower the price, edit individual line items');
    }
  },

  _updateMargin: function() {
    var costEl = document.getElementById('q-est-cost');
    var totalEl = document.getElementById('q-total-display');
    var profitEl = document.getElementById('q-profit-display');
    var pctEl = document.getElementById('q-margin-pct');
    if (!costEl || !totalEl || !profitEl) return;
    var cost = parseFloat(costEl.value) || 0;
    var total = parseFloat((totalEl.textContent || '').replace(/[^0-9.]/g, '')) || 0;
    var profit = total - cost;
    var margin = total > 0 ? Math.round((profit / total) * 100) : 0;
    profitEl.textContent = UI.money(profit);
    profitEl.style.color = profit >= 0 ? 'var(--green-dark)' : 'var(--red)';
    pctEl.textContent = '(' + margin + '%)';
    pctEl.style.color = margin >= 40 ? 'var(--green-dark)' : margin >= 20 ? '#e07c24' : 'var(--red)';
  },

  _clientSearchTimeout: null,
  _searchClient: function(query) {
    clearTimeout(QuotesPage._clientSearchTimeout);
    var results = document.getElementById('q-client-results');
    if (!query || query.length < 2) { results.style.display = 'none'; return; }
    QuotesPage._clientSearchTimeout = setTimeout(function() {
      var q = query.toLowerCase();
      var allClients = [];
      try { allClients = JSON.parse(localStorage.getItem('bm-clients') || '[]'); } catch(e) {}
      var matches = allClients.filter(function(c) {
        return (c.name || '').toLowerCase().indexOf(q) >= 0 || (c.address || '').toLowerCase().indexOf(q) >= 0 || (c.phone || '').indexOf(q) >= 0;
      }).slice(0, 8);
      if (matches.length === 0) {
        results.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:var(--text-light);background:var(--white);border:1px solid var(--border);border-radius:8px;margin-top:4px;">No clients found. <button type="button" style="color:var(--accent);background:none;border:none;cursor:pointer;font-weight:600;text-decoration:underline;" onclick="QuotesPage._newClientInline()">+ Create new</button></div>';
        results.style.display = 'block';
        return;
      }
      var html = '<div style="background:var(--white);border:1px solid var(--border);border-radius:8px;margin-top:4px;max-height:250px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.1);">';
      matches.forEach(function(c) {
        html += '<div onclick="QuotesPage._selectClient(\'' + c.id + '\',\'' + UI.esc(c.name).replace(/'/g,"\\'") + '\')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f5f5f5;font-size:14px;" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">'
          + '<strong>' + UI.esc(c.name) + '</strong>'
          + (c.address ? '<div style="font-size:12px;color:var(--text-light);margin-top:1px;">' + UI.esc(c.address) + '</div>' : '')
          + '</div>';
      });
      html += '</div>';
      results.innerHTML = html;
      results.style.display = 'block';
    }, 150);
  },

  _selectClient: function(id, name) {
    document.getElementById('q-clientId').value = id;
    document.getElementById('q-client-search').value = name;
    document.getElementById('q-client-results').style.display = 'none';
    // Auto-fill property from client
    var client = DB.clients.getById(id);
    if (client && client.address) {
      var prop = document.getElementById('q-property');
      if (prop && !prop.value) prop.value = client.address;
    }
  },

  _newClientInline: function() {
    var name = document.getElementById('q-client-search').value.trim();
    if (!name) return;
    var newClient = DB.clients.create({ name: name, status: 'lead' });
    QuotesPage._selectClient(newClient.id, newClient.name);
    UI.toast('Client "' + name + '" created');
  },

  _applyEstimator: function() {
    var calc = (typeof Estimator !== 'undefined') ? Estimator._lastCalc : null;
    if (!calc) { UI.toast('Calculate a price first', 'error'); return; }

    var items = calc.lineItems.map(function(li) {
      return { service: li.service, description: li.description, qty: li.qty, rate: li.rate, amount: li.amount };
    });
    if (calc.insurance > 0) {
      items.push({ service: 'Insurance & Compliance', description: 'WC, GL, Disability, Payroll, Auto', qty: 1, rate: calc.insurance, amount: calc.insurance });
    }
    if (calc.markup > 0) {
      items.push({ service: 'Service Fee', description: 'Coordination & management', qty: 1, rate: calc.markup, amount: calc.markup });
    }
    QuotesPage._fillFromEstimator(items, calc.total);

    // Collapse the estimator
    var estEl = document.getElementById('inline-estimator');
    if (estEl) estEl.style.display = 'none';

    UI.toast('Calculator applied — ' + items.length + ' line items, ' + UI.money(calc.total));
  },

  _fillFromEstimator: function(items, total) {
    // Clear existing line items
    var container = document.getElementById('q-items');
    if (!container) return;
    container.innerHTML = '';
    var services = DB.services.getAll();

    // Add each item from estimator
    items.forEach(function(item) {
      var div = document.createElement('div');
      div.innerHTML = QuotesPage._itemRow(container.children.length, item, services);
      container.appendChild(div.firstChild);
    });

    // Update total display
    var totalEl = document.getElementById('q-total-display');
    if (totalEl) totalEl.textContent = UI.money(total);

    UI.toast('Estimate applied — ' + items.length + ' line items, ' + UI.money(total));
  },

  // --- Inline Line Item Editor for Detail View ---

  renderLineItems: function(q, id) {
    var services = DB.services.getAll();
    var items = q.lineItems || [];
    var subtotal = 0;
    items.forEach(function(item) { subtotal += (item.qty || 0) * (item.rate || 0); });
    var discount = q.discount || 0;
    var grandTotal = subtotal - discount;

    var html = '<div id="li-section" style="background:var(--white);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);">'
      + '<h4 style="font-size:15px;font-weight:700;margin:0;">Product / Service</h4>'
      + '<div style="display:flex;gap:6px;">'
      + '<button class="btn btn-primary" style="font-size:12px;padding:5px 12px;" onclick="QuotesPage.addLineItem(\'' + id + '\')">+ Add Line Item</button>'
      + '<button class="btn btn-outline" style="font-size:12px;padding:5px 12px;" onclick="QuotesPage.addLineItem(\'' + id + '\', true)">+ Custom Item</button>'
      + '</div></div>';

    if (items.length > 0) {
      html += '<table class="data-table" style="border:none;border-radius:0;"><thead><tr>'
        + '<th>Service / Description</th><th style="width:70px;">Qty</th>'
        + '<th style="text-align:right;width:100px;">Unit Price</th>'
        + '<th style="text-align:right;width:90px;">Total</th>'
        + '<th style="width:40px;"></th>'
        + '</tr></thead><tbody id="li-tbody">';
      items.forEach(function(item, idx) {
        var lineTotal = (item.qty || 0) * (item.rate || 0);
        html += '<tr id="li-row-' + idx + '">'
          + '<td>'
          + '<strong class="li-name" onclick="QuotesPage.editLineItem(\'' + id + '\',' + idx + ')" style="cursor:pointer;" title="Click to edit">' + UI.esc(item.service || item.name || 'Custom') + '</strong>'
          + (item.description ? '<br><span style="color:var(--text-light);font-size:12px;">' + UI.esc(item.description) + '</span>' : '')
          + '</td>'
          + '<td><input type="number" class="li-qty-input" value="' + (item.qty || 1) + '" min="0" step="1" style="width:60px;text-align:center;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:13px;" onblur="QuotesPage.updateLineItemField(\'' + id + '\',' + idx + ',\'qty\',this.value)" onkeydown="if(event.key===\'Enter\'){this.blur();}"></td>'
          + '<td style="text-align:right;"><input type="number" class="li-rate-input" value="' + (item.rate || 0) + '" min="0" step="0.01" style="width:90px;text-align:right;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:13px;" onblur="QuotesPage.updateLineItemField(\'' + id + '\',' + idx + ',\'rate\',this.value)" onkeydown="if(event.key===\'Enter\'){this.blur();}"></td>'
          + '<td style="text-align:right;font-weight:600;" id="li-total-' + idx + '">' + UI.money(lineTotal) + '</td>'
          + '<td style="text-align:center;"><button onclick="QuotesPage.removeLineItem(\'' + id + '\',' + idx + ')" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--red);opacity:.6;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.6" title="Delete line item">🗑️</button></td>'
          + '</tr>';
      });
      html += '</tbody></table>';

      // Subtotal / Discount / Grand Total
      var taxRateDisplay = q.taxRate !== undefined ? q.taxRate : (parseFloat(localStorage.getItem('bm-tax-rate')) || 8.375);
      var taxAmtDisplay = Math.round(grandTotal * taxRateDisplay / 100 * 100) / 100;
      var totalWithTax = grandTotal + taxAmtDisplay;
      html += '<div style="padding:12px 16px;border-top:1px solid var(--border);">'
        + '<div style="display:flex;justify-content:flex-end;">'
        + '<table style="font-size:14px;min-width:260px;">'
        + '<tr><td style="padding:4px 16px 4px 0;text-align:right;color:var(--text-light);">Subtotal</td><td style="padding:4px 0;text-align:right;font-weight:600;">' + UI.money(subtotal) + '</td></tr>';
      html += '<tr><td style="padding:4px 16px 4px 0;text-align:right;color:var(--text-light);">Discount</td>'
        + '<td style="padding:4px 0;text-align:right;">'
        + '<input type="number" id="li-discount" value="' + discount + '" min="0" step="0.01" style="width:90px;text-align:right;font-size:13px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;" onchange="QuotesPage.updateDiscount(\'' + id + '\',this.value)">'
        + '</td></tr>';
      html += '<tr><td style="padding:4px 16px 4px 0;text-align:right;color:var(--text-light);">Tax (' + taxRateDisplay + '%)</td><td style="padding:4px 0;text-align:right;font-weight:600;">' + UI.money(taxAmtDisplay) + '</td></tr>';
      html += '<tr style="border-top:2px solid var(--border);"><td style="padding:8px 16px 4px 0;text-align:right;font-weight:700;font-size:15px;">Total</td>'
        + '<td style="padding:8px 0 4px;text-align:right;font-weight:800;font-size:16px;color:var(--accent);">' + UI.money(totalWithTax) + '</td></tr>';
      html += '</table></div></div>';
    } else {
      // No line items — check if services exist
      if (services.length === 0) {
        html += '<div style="padding:24px;text-align:center;color:var(--text-light);font-size:13px;">'
          + '<div style="font-size:24px;margin-bottom:8px;">📦</div>'
          + 'No services in catalog. Add services in <strong>Settings → Products & Services</strong>'
          + '</div>';
      } else {
        html += '<div style="padding:24px;text-align:center;color:var(--text-light);font-size:13px;">'
          + '<div style="font-size:24px;margin-bottom:8px;">📋</div>'
          + 'No line items yet. Click <strong>+ Add Line Item</strong> to get started.'
          + '</div>';
      }
    }

    // Add-row area (hidden by default, shown when adding)
    html += '<div id="li-add-row" style="display:none;"></div>';
    html += '</div>';
    return html;
  },

  addLineItem: function(quoteId, isCustom) {
    var services = DB.services.getAll();
    var container = document.getElementById('li-add-row');
    if (!container) return;

    // Build category-grouped options
    var optionsHtml = '<option value="">-- Select a service --</option>';
    if (!isCustom && services.length > 0) {
      var categories = {};
      services.forEach(function(s) {
        var cat = s.category || 'Other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(s);
      });
      var catKeys = Object.keys(categories).sort();
      catKeys.forEach(function(cat) {
        optionsHtml += '<optgroup label="' + UI.esc(cat) + '">';
        categories[cat].forEach(function(s) {
          optionsHtml += '<option value="' + s.id + '" data-name="' + UI.esc(s.name) + '" data-desc="' + UI.esc(s.description || '') + '" data-price="' + (s.unitPrice || 0) + '">' + UI.esc(s.name) + (s.unitPrice ? ' — ' + UI.money(s.unitPrice) : '') + '</option>';
        });
        optionsHtml += '</optgroup>';
      });
    }

    var rowHtml = '<div style="padding:12px 16px;border-top:1px solid var(--border);background:#f9fafb;">'
      + '<div style="font-size:13px;font-weight:700;margin-bottom:8px;">' + (isCustom ? 'Add Custom Item' : 'Add Service from Catalog') + '</div>'
      + '<div style="display:grid;grid-template-columns:2fr 2fr 70px 100px 90px;gap:8px;align-items:end;">';

    if (isCustom) {
      rowHtml += '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Name</label>'
        + '<input type="text" id="li-new-name" placeholder="Item name..." style="font-size:13px;"></div>';
    } else {
      rowHtml += '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Service</label>'
        + '<select id="li-new-service" onchange="QuotesPage._onNewServiceSelect()" style="font-size:13px;">' + optionsHtml + '</select></div>';
    }

    rowHtml += '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Description</label>'
      + '<input type="text" id="li-new-desc" placeholder="Work details..." style="font-size:13px;"></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Qty</label>'
      + '<input type="number" id="li-new-qty" value="1" min="1" style="font-size:13px;text-align:center;" oninput="QuotesPage._calcNewLineTotal()"></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Unit Price ($)</label>'
      + '<input type="number" id="li-new-rate" value="" step="0.01" placeholder="0.00" style="font-size:13px;" oninput="QuotesPage._calcNewLineTotal()"></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Total</label>'
      + '<div id="li-new-total" style="font-size:14px;font-weight:700;color:var(--green-dark);padding:8px 0;">$0.00</div></div>'
      + '</div>'
      + '<div style="display:flex;gap:6px;margin-top:10px;">'
      + '<button class="btn btn-primary" style="font-size:12px;padding:5px 14px;" onclick="QuotesPage.saveLineItem(\'' + quoteId + '\',' + (isCustom ? 'true' : 'false') + ')">Save</button>'
      + '<button class="btn btn-outline" style="font-size:12px;padding:5px 14px;" onclick="document.getElementById(\'li-add-row\').style.display=\'none\';">Cancel</button>'
      + '</div></div>';

    container.innerHTML = rowHtml;
    container.style.display = 'block';

    // Focus the first input
    setTimeout(function() {
      var el = document.getElementById(isCustom ? 'li-new-name' : 'li-new-service');
      if (el) el.focus();
    }, 50);
  },

  _onNewServiceSelect: function() {
    var sel = document.getElementById('li-new-service');
    if (!sel) return;
    var opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;
    var descEl = document.getElementById('li-new-desc');
    var rateEl = document.getElementById('li-new-rate');
    if (descEl && opt.dataset.desc) descEl.value = opt.dataset.desc;
    if (rateEl && opt.dataset.price) rateEl.value = opt.dataset.price;
    QuotesPage._calcNewLineTotal();
  },

  _calcNewLineTotal: function() {
    var qty = parseFloat((document.getElementById('li-new-qty') || {}).value) || 0;
    var rate = parseFloat((document.getElementById('li-new-rate') || {}).value) || 0;
    var el = document.getElementById('li-new-total');
    if (el) el.textContent = UI.money(qty * rate);
  },

  saveLineItem: function(quoteId, isCustom) {
    var q = DB.quotes.getById(quoteId);
    if (!q) return;
    var items = q.lineItems ? q.lineItems.slice() : [];

    var name, description, qty, rate, serviceId;
    if (isCustom) {
      name = (document.getElementById('li-new-name') || {}).value || '';
      if (!name.trim()) { UI.toast('Enter an item name', 'error'); return; }
    } else {
      var sel = document.getElementById('li-new-service');
      if (!sel || !sel.value) { UI.toast('Select a service', 'error'); return; }
      var opt = sel.options[sel.selectedIndex];
      serviceId = sel.value;
      name = opt.dataset.name || opt.textContent;
    }
    description = (document.getElementById('li-new-desc') || {}).value || '';
    qty = parseFloat((document.getElementById('li-new-qty') || {}).value) || 1;
    rate = parseFloat((document.getElementById('li-new-rate') || {}).value) || 0;

    var newItem = {
      id: 'li-' + Date.now(),
      serviceId: serviceId || null,
      service: name,
      name: name,
      description: description,
      qty: qty,
      rate: rate,
      amount: qty * rate
    };
    items.push(newItem);

    var total = 0;
    items.forEach(function(it) { total += (it.qty || 0) * (it.rate || 0); });
    total = total - (q.discount || 0);

    DB.quotes.update(quoteId, { lineItems: items, total: total });
    UI.toast('Line item added');
    QuotesPage.showDetail(quoteId);
  },

  editLineItem: function(quoteId, itemIdx) {
    var q = DB.quotes.getById(quoteId);
    if (!q || !q.lineItems || !q.lineItems[itemIdx]) return;
    var item = q.lineItems[itemIdx];
    var services = DB.services.getAll();

    // Build category-grouped options
    var optionsHtml = '<option value="">-- Select or keep current --</option>';
    var categories = {};
    services.forEach(function(s) {
      var cat = s.category || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(s);
    });
    var catKeys = Object.keys(categories).sort();
    catKeys.forEach(function(cat) {
      optionsHtml += '<optgroup label="' + UI.esc(cat) + '">';
      categories[cat].forEach(function(s) {
        var selected = (item.serviceId === s.id || item.service === s.name) ? ' selected' : '';
        optionsHtml += '<option value="' + s.id + '" data-name="' + UI.esc(s.name) + '" data-desc="' + UI.esc(s.description || '') + '" data-price="' + (s.unitPrice || 0) + '"' + selected + '>' + UI.esc(s.name) + '</option>';
      });
      optionsHtml += '</optgroup>';
    });

    var lineTotal = (item.qty || 0) * (item.rate || 0);

    var rowHtml = '<tr id="li-edit-row" style="background:#fffde7;">'
      + '<td><select id="li-edit-service" style="font-size:13px;margin-bottom:4px;width:100%;" onchange="QuotesPage._onEditServiceSelect()">' + optionsHtml + '</select>'
      + '<input type="text" id="li-edit-name" value="' + UI.esc(item.service || item.name || '') + '" placeholder="Item name" style="font-size:12px;margin-bottom:4px;width:100%;">'
      + '<input type="text" id="li-edit-desc" value="' + UI.esc(item.description || '') + '" placeholder="Description" style="font-size:12px;width:100%;"></td>'
      + '<td><input type="number" id="li-edit-qty" value="' + (item.qty || 1) + '" min="1" style="font-size:13px;text-align:center;width:55px;" oninput="QuotesPage._calcEditLineTotal()"></td>'
      + '<td style="text-align:right;"><input type="number" id="li-edit-rate" value="' + (item.rate || 0) + '" step="0.01" style="font-size:13px;text-align:right;width:85px;" oninput="QuotesPage._calcEditLineTotal()"></td>'
      + '<td style="text-align:right;font-weight:600;" id="li-edit-total">' + UI.money(lineTotal) + '</td>'
      + '<td style="text-align:center;">'
      + '<button class="btn btn-primary" style="font-size:11px;padding:3px 8px;margin-bottom:2px;display:block;width:100%;" onclick="QuotesPage._saveEditedItem(\'' + quoteId + '\',' + itemIdx + ')">Save</button>'
      + '<button class="btn btn-outline" style="font-size:11px;padding:3px 8px;display:block;width:100%;" onclick="QuotesPage.showDetail(\'' + quoteId + '\')">Cancel</button>'
      + '</td></tr>';

    // Replace the row
    var existingRow = document.getElementById('li-row-' + itemIdx);
    if (existingRow) {
      existingRow.outerHTML = rowHtml;
    }
  },

  _onEditServiceSelect: function() {
    var sel = document.getElementById('li-edit-service');
    if (!sel) return;
    var opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;
    var nameEl = document.getElementById('li-edit-name');
    var descEl = document.getElementById('li-edit-desc');
    var rateEl = document.getElementById('li-edit-rate');
    if (nameEl && opt.dataset.name) nameEl.value = opt.dataset.name;
    if (descEl && opt.dataset.desc) descEl.value = opt.dataset.desc;
    if (rateEl && opt.dataset.price && parseFloat(opt.dataset.price) > 0) rateEl.value = opt.dataset.price;
    QuotesPage._calcEditLineTotal();
  },

  _calcEditLineTotal: function() {
    var qty = parseFloat((document.getElementById('li-edit-qty') || {}).value) || 0;
    var rate = parseFloat((document.getElementById('li-edit-rate') || {}).value) || 0;
    var el = document.getElementById('li-edit-total');
    if (el) el.textContent = UI.money(qty * rate);
  },

  _saveEditedItem: function(quoteId, itemIdx) {
    var q = DB.quotes.getById(quoteId);
    if (!q || !q.lineItems || !q.lineItems[itemIdx]) return;
    var items = q.lineItems.slice();

    var sel = document.getElementById('li-edit-service');
    var serviceId = sel ? sel.value : null;
    var name = (document.getElementById('li-edit-name') || {}).value || '';
    var description = (document.getElementById('li-edit-desc') || {}).value || '';
    var qty = parseFloat((document.getElementById('li-edit-qty') || {}).value) || 1;
    var rate = parseFloat((document.getElementById('li-edit-rate') || {}).value) || 0;

    items[itemIdx] = {
      id: items[itemIdx].id || ('li-' + Date.now()),
      serviceId: serviceId || items[itemIdx].serviceId || null,
      service: name,
      name: name,
      description: description,
      qty: qty,
      rate: rate,
      amount: qty * rate
    };

    var total = 0;
    items.forEach(function(it) { total += (it.qty || 0) * (it.rate || 0); });
    total = total - (q.discount || 0);

    DB.quotes.update(quoteId, { lineItems: items, total: total });
    UI.toast('Line item updated');
    QuotesPage.showDetail(quoteId);
  },

  // On-the-fly single-field update (qty or rate) — no modal
  updateLineItemField: function(quoteId, itemIdx, field, value) {
    var q = DB.quotes.getById(quoteId);
    if (!q || !q.lineItems || !q.lineItems[itemIdx]) return;
    var items = q.lineItems.slice();
    var newVal = parseFloat(value) || 0;
    if (items[itemIdx][field] === newVal) return; // no change
    items[itemIdx][field] = newVal;
    items[itemIdx].amount = (items[itemIdx].qty || 0) * (items[itemIdx].rate || 0);

    var subtotal = 0;
    items.forEach(function(it) { subtotal += (it.qty || 0) * (it.rate || 0); });
    var discount = q.discount || 0;
    var afterDiscount = subtotal - discount;
    var taxRate = q.taxRate !== undefined ? q.taxRate : (parseFloat(localStorage.getItem('bm-tax-rate')) || 8.375);
    var tax = Math.round(afterDiscount * taxRate / 100 * 100) / 100;
    var total = afterDiscount + tax;

    DB.quotes.update(quoteId, { lineItems: items, total: total });
    QuotesPage.showDetail(quoteId);
  },

  removeLineItem: function(quoteId, itemIdx) {
    UI.confirm('Delete this line item?', function() {
      var q = DB.quotes.getById(quoteId);
      if (!q || !q.lineItems) return;
      var items = q.lineItems.slice();
      items.splice(itemIdx, 1);

      var total = 0;
      items.forEach(function(it) { total += (it.qty || 0) * (it.rate || 0); });
      total = total - (q.discount || 0);

      DB.quotes.update(quoteId, { lineItems: items, total: total });
      UI.toast('Line item removed');
      QuotesPage.showDetail(quoteId);
    });
  },

  updateDiscount: function(quoteId, val) {
    var q = DB.quotes.getById(quoteId);
    if (!q) return;
    var discount = parseFloat(val) || 0;
    var subtotal = 0;
    (q.lineItems || []).forEach(function(it) { subtotal += (it.qty || 0) * (it.rate || 0); });
    var afterDiscount = subtotal - discount;
    if (afterDiscount < 0) afterDiscount = 0;
    var taxRate = q.taxRate !== undefined ? q.taxRate : 8.375;
    var taxAmount = Math.round(afterDiscount * taxRate / 100 * 100) / 100;
    var total = afterDiscount + taxAmount;
    DB.quotes.update(quoteId, { discount: discount, subtotal: subtotal, taxAmount: taxAmount, total: total });
    QuotesPage.showDetail(quoteId);
  },

  convertToJob: function(quoteId) {
    var q = DB.quotes.getById(quoteId);
    if (!q) return;
    var job = DB.jobs.create({
      clientId: q.clientId,
      clientName: q.clientName,
      property: q.property,
      description: q.description,
      lineItems: q.lineItems,
      total: q.total,
      quoteId: quoteId,
      status: 'scheduled',
      scheduledDate: null
    });
    DB.quotes.update(quoteId, { status: 'converted', jobId: job.id });
    if (q.clientId) DB.clients.update(q.clientId, { status: 'active' });
    UI.toast('Job #' + job.jobNumber + ' created from quote');
    UI.closeModal();
    loadPage('jobs');
  },

  // ── Video Walkthrough ──
  _addVideo: function(quoteId) {
    var html = '<div style="text-align:center;margin-bottom:16px;">'
      + '<div style="font-size:48px;margin-bottom:8px;">🎥</div>'
      + '<p style="font-size:13px;color:var(--text-light);">Record a walkthrough of the property on your phone, upload it to YouTube as Unlisted, then paste the link below.</p>'
      + '</div>'
      + '<div style="background:var(--bg);border-radius:8px;padding:12px;margin-bottom:12px;">'
      + '<div style="font-size:12px;font-weight:700;margin-bottom:8px;">Quick steps:</div>'
      + '<div style="font-size:12px;color:var(--text-light);line-height:1.6;">'
      + '1. Open Camera app \u2192 Record video walking the property<br>'
      + '2. Open YouTube app \u2192 Tap + \u2192 Upload \u2192 Select video<br>'
      + '3. Set visibility to <strong>Unlisted</strong><br>'
      + '4. Copy the link \u2192 Paste below'
      + '</div></div>'
      + UI.field('YouTube Link', '<input type="url" id="vw-url" placeholder="https://youtu.be/... or https://youtube.com/watch?v=...">')
      + '<div style="font-size:11px;color:var(--text-light);margin-top:4px;">Unlisted = only people with the link can see it. Not public, not searchable.</div>';

    UI.showModal('Add Video Walkthrough', html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="QuotesPage._saveVideo(\'' + quoteId + '\')">Save Video</button>'
    });
  },

  _saveVideo: function(quoteId) {
    var url = document.getElementById('vw-url').value.trim();
    if (!url) { UI.toast('Paste a YouTube link', 'error'); return; }
    if (url.indexOf('youtu') === -1 && url.indexOf('youtube') === -1) {
      UI.toast('Please use a YouTube link', 'error'); return;
    }
    DB.quotes.update(quoteId, { videoUrl: url });
    UI.closeModal();
    UI.toast('Video walkthrough added! \uD83C\uDFAC');
    QuotesPage.showDetail(quoteId);
  },

  _removeVideo: function(quoteId) {
    if (!confirm('Remove video from this quote?')) return;
    DB.quotes.update(quoteId, { videoUrl: null });
    UI.toast('Video removed');
    QuotesPage.showDetail(quoteId);
  },

  _archiveQuote: function(quoteId) {
    if (!confirm('Archive this quote? It will be hidden from the main list.')) return;
    DB.quotes.update(quoteId, { status: 'archived' });
    UI.toast('Quote archived');
    loadPage('quotes');
  },

  _deleteQuote: function(quoteId) {
    if (!confirm('Delete this quote permanently? This cannot be undone.')) return;
    DB.quotes.delete(quoteId);
    UI.toast('Quote deleted');
    loadPage('quotes');
  }
};
