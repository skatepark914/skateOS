/**
 * Branch Manager — Invoices Page
 */
var InvoicesPage = {
  _co: function() {
    return {
      name: localStorage.getItem('bm-co-name') || BM_CONFIG.companyName,
      phone: localStorage.getItem('bm-co-phone') || BM_CONFIG.phone,
      email: localStorage.getItem('bm-co-email') || BM_CONFIG.email,
      website: localStorage.getItem('bm-co-website') || BM_CONFIG.website
    };
  },

  _page: 0, _perPage: 50, _search: '', _filter: 'all', _sortCol: 'invoiceNumber', _sortDir: 'desc',
  _activeTab: 'invoices',

  switchTab: function(tab) {
    InvoicesPage._activeTab = tab;
    loadPage('invoices');
  },

  _pendingDetail: null,

  render: function() {
    var self = InvoicesPage;
    if (self._pendingDetail) {
      var _pid = self._pendingDetail;
      self._pendingDetail = null;
      setTimeout(function() { InvoicesPage.showDetail(_pid); }, 50);
    }
    var activeTab = self._activeTab || 'invoices';

    // Tab bar
    var html = '<div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:16px;">'
      + '<button onclick="InvoicesPage.switchTab(\'invoices\')" style="padding:10px 20px;font-size:14px;font-weight:' + (activeTab==='invoices'?'700':'500') + ';border:none;background:none;cursor:pointer;color:' + (activeTab==='invoices'?'var(--accent)':'var(--text-light)') + ';border-bottom:2px solid ' + (activeTab==='invoices'?'var(--accent)':'transparent') + ';margin-bottom:-2px;">Invoices</button>'
      + '<button onclick="InvoicesPage.switchTab(\'payments\')" style="padding:10px 20px;font-size:14px;font-weight:' + (activeTab==='payments'?'700':'500') + ';border:none;background:none;cursor:pointer;color:' + (activeTab==='payments'?'var(--accent)':'var(--text-light)') + ';border-bottom:2px solid ' + (activeTab==='payments'?'var(--accent)':'transparent') + ';margin-bottom:-2px;">Payments</button>'
      + '</div>';

    if (activeTab === 'payments') {
      return html + Payments._renderContent();
    }

    var all = DB.invoices.getAll();
    var receivable = DB.invoices.totalReceivable();
    var unpaid = all.filter(function(i) { return i.status !== 'paid'; });
    var draft = all.filter(function(i) { return i.status === 'draft'; }).length;
    var paid = all.filter(function(i) { return i.status === 'paid'; }).length;

    // Jobber-style stat cards row
    var now = new Date();
    var pastDue = all.filter(function(i) { return i.status !== 'paid' && i.dueDate && new Date(i.dueDate) < now; });
    var sentNotDue = all.filter(function(i) { return i.status === 'sent' && (!i.dueDate || new Date(i.dueDate) >= now); });
    var pastDueTotal = pastDue.reduce(function(s,i){return s+(i.balance||0);},0);
    var sentNotDueTotal = sentNotDue.reduce(function(s,i){return s+(i.balance||0);},0);
    var draftTotal = all.filter(function(i){return i.status==='draft';}).reduce(function(s,i){return s+(i.total||0);},0);
    var recentIssued = all.filter(function(i) { var d=new Date(i.createdAt); var ago=new Date(); ago.setDate(ago.getDate()-30); return d>=ago; });
    var recentIssuedTotal = recentIssued.reduce(function(s,i){return s+(i.total||0);},0);
    var avgInvoice = recentIssued.length > 0 ? Math.round(recentIssuedTotal / recentIssued.length) : 0;

    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;background:var(--white);" class="stat-row">'
      // Overview
      + '<div onclick="InvoicesPage._setFilter(\'all\')" style="padding:14px 16px;border-right:1px solid var(--border);cursor:pointer;">'
      + '<div style="font-size:14px;font-weight:700;margin-bottom:8px;">Overview</div>'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;"><span><span style="color:#dc3545;">●</span> Past due (' + pastDue.length + ')</span><span>' + UI.moneyInt(pastDueTotal) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;"><span><span style="color:#e6a817;">●</span> Sent but not due (' + sentNotDue.length + ')</span><span>' + UI.moneyInt(sentNotDueTotal) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;"><span><span style="color:#6c757d;">●</span> Draft (' + draft + ')</span><span>' + UI.moneyInt(draftTotal) + '</span></div>'
      + '</div>'
      // Issued
      + '<div style="padding:14px 16px;border-right:1px solid var(--border);">'
      + '<div style="font-size:14px;font-weight:700;">Issued</div>'
      + '<div style="font-size:12px;color:var(--text-light);">Past 30 days</div>'
      + '<div style="font-size:28px;font-weight:700;margin-top:4px;">' + recentIssued.length + '</div>'
      + '<div style="font-size:12px;color:var(--text-light);">' + UI.moneyInt(recentIssuedTotal) + '</div>'
      + '</div>'
      // Average invoice
      + '<div style="padding:14px 16px;border-right:1px solid var(--border);">'
      + '<div style="font-size:14px;font-weight:700;">Average invoice</div>'
      + '<div style="font-size:12px;color:var(--text-light);">Past 30 days</div>'
      + '<div style="font-size:28px;font-weight:700;margin-top:4px;">' + UI.moneyInt(avgInvoice) + '</div>'
      + '</div>'
      // Total collected
      + (function() {
        var totalCollected = all.filter(function(i){return i.status==='paid';}).reduce(function(s,i){return s+(i.total||0);},0);
        return '<div style="padding:14px 16px;">'
          + '<div style="font-size:14px;font-weight:700;">Total Collected</div>'
          + '<div style="font-size:22px;font-weight:800;margin-top:12px;color:var(--green-dark);">' + UI.moneyInt(totalCollected) + '</div>'
          + '<div style="font-size:12px;color:var(--text-light);">' + paid + ' paid invoices</div>'
          + '</div>';
      })()
      + '</div>';

    var filtered = self._getFiltered();
    var page = filtered.slice(self._page * self._perPage, (self._page + 1) * self._perPage);

    // Jobber-style header + filter chips + search
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">'
      + '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">'
      + '<h3 style="font-size:16px;font-weight:700;margin:0;">All invoices</h3>'
      + '<span style="font-size:13px;color:var(--text-light);">(' + filtered.length + ' results)</span>'
      + (function() {
        var chips = [['all','All'],['past_due','Past Due'],['sent_not_due','Sent but not due'],['draft','Draft'],['paid','Paid']];
        var out = '';
        for (var ci = 0; ci < chips.length; ci++) {
          var val = chips[ci][0], label = chips[ci][1];
          var isActive = self._filter === val;
          out += '<button onclick="InvoicesPage._setFilter(\'' + val + '\')" style="font-size:12px;padding:5px 14px;border-radius:20px;border:1px solid ' + (isActive ? '#2e7d32' : 'var(--border)') + ';background:' + (isActive ? '#2e7d32' : 'var(--white)') + ';color:' + (isActive ? '#fff' : 'var(--text)') + ';cursor:pointer;font-weight:' + (isActive ? '600' : '500') + ';">' + label + '</button>';
        }
        return out;
      })()
      + '</div>'
      + '<button onclick="InvoicesPage._generateFromJobs()" style="font-size:12px;padding:5px 14px;border-radius:20px;border:1px solid #e07c24;background:#fff3e0;color:#e07c24;cursor:pointer;font-weight:600;">⚡ Generate from Jobs</button>'
      + '<div class="search-box" style="min-width:200px;max-width:280px;">'
      + '<span style="color:var(--text-light);">🔍</span>'
      + '<input type="text" placeholder="Search invoices..." value="' + UI.esc(self._search) + '" oninput="InvoicesPage._search=this.value;InvoicesPage._page=0;loadPage(\'invoices\')">'
      + '</div></div>';

    // Floating batch action bar (fixed to bottom)
    html += '<div id="inv-batch-bar" style="display:none;position:fixed;bottom:0;left:var(--sidebar-w,0);right:0;z-index:500;background:#1a1a2e;color:#fff;padding:12px 24px;padding-bottom:max(12px,env(safe-area-inset-bottom));align-items:center;justify-content:space-between;box-shadow:0 -4px 20px rgba(0,0,0,.3);animation:invBatchSlideUp .25s ease-out;">'
      + '<span id="inv-batch-count" style="font-weight:700;font-size:14px;">0 selected</span>'
      + '<div style="display:flex;gap:8px;align-items:center;">'
      + '<button onclick="InvoicesPage._batchPaid()" style="background:#2e7d32;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Mark Paid</button>'
      + '<button onclick="InvoicesPage._batchSendAll()" style="background:#2e7d32;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Send All</button>'
      + '<button onclick="InvoicesPage._batchExport()" style="background:#2e7d32;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Export</button>'
      + '<button onclick="InvoicesPage._batchClear()" style="background:none;color:rgba(255,255,255,.7);border:none;padding:8px 12px;font-size:16px;cursor:pointer;">&#10005;</button>'
      + '</div></div>'
      + '<style>@keyframes invBatchSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}</style>';

    // Jobber card-style invoice list
    if (page.length === 0) {
      html += '<div style="background:var(--white);border-radius:12px;border:1px solid var(--border);padding:40px;text-align:center;">'
        + (self._search ? '<div style="color:var(--text-light);">No invoices match "' + self._search + '"</div>' : UI.emptyState('💰', 'No invoices yet', 'Complete a job and create an invoice.'))
        + '</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:12px;overflow:hidden;">';
      page.forEach(function(inv) {
        var statusColor = inv.status === 'paid' ? '#2e7d32' : inv.status === 'overdue' ? '#dc3545' : inv.status === 'draft' ? '#6c757d' : '#1565c0';
        html += '<div onclick="InvoicesPage.showDetail(\'' + inv.id + '\')" style="background:var(--white);padding:16px 20px;cursor:pointer;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;" onmouseover="this.style.background=\'#f8f9fa\'" onmouseout="this.style.background=\'var(--white)\'">'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="font-size:16px;font-weight:700;">' + UI.esc(inv.clientName || '—') + '</div>'
          + '<div style="font-size:14px;color:var(--text-light);margin-top:2px;">#' + (inv.invoiceNumber || '') + '</div>'
          + '<div style="font-size:14px;color:var(--text-light);margin-top:2px;">' + UI.dateShort(inv.createdAt || inv.date) + (inv.subject ? ' · ' + UI.esc(inv.subject) : '') + '</div>'
          + '<div style="margin-top:6px;font-size:14px;">'
          + '<span style="font-weight:700;">Total ' + UI.money(inv.total) + '</span>'
          + ((inv.balance||0) > 0 ? '<span style="margin-left:12px;">Balance <strong style="color:' + ((inv.status === 'overdue' || inv.status === 'past_due') ? '#dc3545' : 'var(--text)') + ';">' + UI.money(inv.balance) + '</strong></span>' : '')
          + '</div></div>'
          + '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'
          + UI.statusBadge(inv.status)
          + '<button onclick="event.stopPropagation();" style="background:none;border:none;font-size:18px;color:var(--text-light);cursor:pointer;padding:4px;">···</button>'
          + '</div></div>';
      });
      html += '</div>';
    }

    // Pagination
    var totalPages = Math.ceil(filtered.length / self._perPage);
    if (totalPages > 1) {
      html += '<div style="display:flex;justify-content:center;gap:4px;margin-top:12px;">';
      html += '<button class="btn btn-outline" onclick="InvoicesPage._goPage(' + (self._page - 1) + ')" style="font-size:12px;padding:5px 10px;"' + (self._page === 0 ? ' disabled' : '') + '>‹</button>';
      for (var p = Math.max(0, self._page - 2); p <= Math.min(totalPages - 1, self._page + 2); p++) {
        html += '<button class="btn ' + (p === self._page ? 'btn-primary' : 'btn-outline') + '" onclick="InvoicesPage._goPage(' + p + ')" style="font-size:12px;padding:5px 10px;min-width:32px;">' + (p + 1) + '</button>';
      }
      html += '<button class="btn btn-outline" onclick="InvoicesPage._goPage(' + (self._page + 1) + ')" style="font-size:12px;padding:5px 10px;"' + (self._page >= totalPages - 1 ? ' disabled' : '') + '>›</button>';
      html += '</div>';
    }
    return html;
  },

  _getFiltered: function() {
    var self = InvoicesPage;
    var all = DB.invoices.getAll();
    var now = new Date();
    if (self._filter === 'unpaid') all = all.filter(function(i) { return i.status !== 'paid'; });
    else if (self._filter === 'past_due') all = all.filter(function(i) { return i.status !== 'paid' && i.status !== 'cancelled' && (i.status === 'overdue' || (i.dueDate && new Date(i.dueDate) < now)); });
    else if (self._filter === 'sent_not_due') all = all.filter(function(i) { return (i.status === 'sent' || i.status === 'viewed') && (!i.dueDate || new Date(i.dueDate) >= now); });
    else if (self._filter !== 'all') all = all.filter(function(i) { return i.status === self._filter; });
    if (self._search && self._search.length >= 2) {
      var s = self._search.toLowerCase();
      all = all.filter(function(i) { return (i.clientName||'').toLowerCase().indexOf(s) >= 0 || (i.subject||'').toLowerCase().indexOf(s) >= 0 || String(i.invoiceNumber).indexOf(s) >= 0; });
    }
    var col = self._sortCol;
    var dir = self._sortDir === 'asc' ? 1 : -1;
    all.sort(function(a, b) {
      var va = a[col], vb = b[col];
      if (col === 'invoiceNumber' || col === 'total' || col === 'balance') return ((va || 0) - (vb || 0)) * dir;
      if (col === 'dueDate') return ((new Date(va || 0)).getTime() - (new Date(vb || 0)).getTime()) * dir;
      va = (va || '').toString().toLowerCase(); vb = (vb || '').toString().toLowerCase();
      return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
    });
    return all;
  },
  _sortTh: function(label, col, extraStyle) {
    var self = InvoicesPage;
    var arrow = self._sortCol === col ? (self._sortDir === 'asc' ? ' &#9650;' : ' &#9660;') : '';
    return '<th onclick="InvoicesPage._setSort(\'' + col + '\')" style="cursor:pointer;user-select:none;' + (extraStyle || '') + '"' + (self._sortCol === col ? ' class="sort-active"' : '') + '>' + label + arrow + '</th>';
  },
  _setSort: function(col) {
    if (InvoicesPage._sortCol === col) { InvoicesPage._sortDir = InvoicesPage._sortDir === 'asc' ? 'desc' : 'asc'; }
    else { InvoicesPage._sortCol = col; InvoicesPage._sortDir = 'asc'; }
    InvoicesPage._page = 0; loadPage('invoices');
  },
  _setFilter: function(f) { InvoicesPage._filter = f; InvoicesPage._page = 0; loadPage('invoices'); },
  _goPage: function(p) { var t = Math.ceil(InvoicesPage._getFiltered().length / InvoicesPage._perPage); InvoicesPage._page = Math.max(0, Math.min(p, t - 1)); loadPage('invoices'); },

  _selectAll: function(checked) {
    document.querySelectorAll('.inv-check').forEach(function(cb) { cb.checked = checked; });
    InvoicesPage._updateBatchBar();
  },
  _updateBulk: function() {
    InvoicesPage._updateBatchBar();
  },
  _updateBatchBar: function() {
    var selected = document.querySelectorAll('.inv-check:checked');
    var bar = document.getElementById('inv-batch-bar');
    var count = document.getElementById('inv-batch-count');
    if (bar) bar.style.display = selected.length > 0 ? 'flex' : 'none';
    if (count) count.textContent = selected.length + ' selected';
  },
  _getSelected: function() {
    return Array.from(document.querySelectorAll('.inv-check:checked')).map(function(cb) { return cb.getAttribute('data-id') || cb.value; });
  },
  _toggleAll: function(checked) {
    document.querySelectorAll('.inv-check').forEach(function(cb) { cb.checked = checked; });
    InvoicesPage._updateBatch();
  },
  _updateBatch: function() {
    var selected = InvoicesPage._getSelected();
    var bar = document.getElementById('inv-batch-bar');
    var count = document.getElementById('inv-batch-count');
    if (selected.length > 0) {
      bar.style.display = 'flex';
      count.textContent = selected.length + ' selected';
    } else {
      bar.style.display = 'none';
    }
  },
  _sendInvoice: function(id) {
    var inv = DB.invoices.getById(id);
    if (!inv) return;
    if (typeof Workflow !== 'undefined' && typeof Workflow.sendInvoice === 'function') {
      Workflow.sendInvoice(id);
      UI.toast('Invoice #' + inv.invoiceNumber + ' sent');
    } else {
      DB.invoices.update(id, { status: 'sent' });
      UI.toast('Invoice #' + inv.invoiceNumber + ' marked as sent');
    }
    loadPage('invoices');
  },
  _viewPDF: function(id) {
    var inv = DB.invoices.getById(id);
    if (!inv) return;
    if (typeof PDFGen !== 'undefined' && typeof PDFGen.invoice === 'function') {
      PDFGen.invoice(inv);
    } else {
      loadPage('pdfgen');
    }
  },
  _quickPay: function(id) {
    var inv = DB.invoices.getById(id);
    if (!inv) return;
    UI.confirm('Mark invoice #' + inv.invoiceNumber + ' for ' + UI.esc(inv.clientName || '') + ' as paid?', function() {
      if (typeof Workflow !== 'undefined') {
        Workflow.markPaid(id, 'check');
      } else {
        DB.invoices.update(id, { status: 'paid', balance: 0, paidDate: new Date().toISOString() });
      }
      UI.toast('Invoice #' + inv.invoiceNumber + ' marked paid');
      loadPage('invoices');
    });
  },
  _batchPaid: function() {
    var ids = InvoicesPage._getSelected();
    if (ids.length === 0) return;
    UI.confirm('Mark ' + ids.length + ' invoice' + (ids.length > 1 ? 's' : '') + ' as paid?', function() {
      ids.forEach(function(id) {
        if (typeof Workflow !== 'undefined') {
          Workflow.markPaid(id, 'bulk');
        } else {
          DB.invoices.update(id, { status: 'paid', balance: 0, paidDate: new Date().toISOString() });
        }
      });
      UI.toast(ids.length + ' invoice' + (ids.length > 1 ? 's' : '') + ' marked paid');
      loadPage('invoices');
    });
  },
  _batchReminder: function() {
    var ids = InvoicesPage._getSelected();
    if (ids.length === 0) return;
    var sent = 0;
    ids.forEach(function(id) {
      var inv = DB.invoices.getById(id);
      if (inv && inv.status !== 'paid') {
        if (typeof Workflow !== 'undefined') { Workflow.sendInvoice(id); }
        sent++;
      }
    });
    UI.toast('Reminders queued for ' + sent + ' invoice' + (sent !== 1 ? 's' : ''));
    loadPage('invoices');
  },
  _batchSendAll: function() {
    var ids = InvoicesPage._getSelected();
    if (ids.length === 0) return;
    UI.confirm('Mark ' + ids.length + ' invoice' + (ids.length > 1 ? 's' : '') + ' as sent?', function() {
      var count = 0;
      ids.forEach(function(id) {
        var inv = DB.invoices.getById(id);
        if (inv && inv.status !== 'paid') {
          DB.invoices.update(id, { status: 'sent' });
          count++;
        }
      });
      UI.toast(count + ' invoice' + (count > 1 ? 's' : '') + ' marked sent');
      loadPage('invoices');
    });
  },
  _batchExport: function() {
    var ids = InvoicesPage._getSelected();
    if (ids.length === 0) return;
    var rows = ['Invoice #,Client,Subject,Status,Due Date,Total,Balance'];
    ids.forEach(function(id) {
      var inv = DB.invoices.getById(id);
      if (!inv) return;
      rows.push(
        '"' + (inv.invoiceNumber || '') + '",'
        + '"' + (inv.clientName || '').replace(/"/g, '""') + '",'
        + '"' + (inv.subject || '').replace(/"/g, '""') + '",'
        + '"' + (inv.status || '') + '",'
        + '"' + (inv.dueDate || '') + '",'
        + '"' + (inv.total || 0) + '",'
        + '"' + (inv.balance || 0) + '"'
      );
    });
    var csv = rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'invoices-export-' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.toast(ids.length + ' invoice' + (ids.length > 1 ? 's' : '') + ' exported');
  },
  _batchClear: function() {
    document.querySelectorAll('.inv-check').forEach(function(cb) { cb.checked = false; });
    var headerCheck = document.querySelector('th input[type="checkbox"]');
    if (headerCheck) headerCheck.checked = false;
    InvoicesPage._updateBatch();
  },

  _generateFromJobs: function() {
    var allJobs = DB.jobs.getAll();
    var allInvoices = DB.invoices.getAll();
    var invoicedJobIds = allInvoices.map(function(i) { return i.jobId; }).filter(Boolean);
    var uninvoiced = allJobs.filter(function(j) {
      return j.status === 'completed' && invoicedJobIds.indexOf(j.id) === -1;
    });

    if (uninvoiced.length === 0) {
      UI.toast('All completed jobs already have invoices', 'error');
      return;
    }

    var html = '<p style="margin:0 0 16px;font-size:13px;color:var(--text-light);">' + uninvoiced.length + ' completed jobs without invoices. Select which ones to generate:</p>';
    html += '<div style="max-height:350px;overflow-y:auto;">';
    uninvoiced.forEach(function(j) {
      html += '<label style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border-radius:8px;margin-bottom:6px;cursor:pointer;">'
        + '<input type="checkbox" checked class="gen-inv-check" data-id="' + j.id + '">'
        + '<div style="flex:1;"><div style="font-weight:600;font-size:13px;">' + UI.esc(j.clientName || '—') + ' — #' + (j.jobNumber || '') + '</div>'
        + '<div style="font-size:11px;color:var(--text-light);">' + UI.esc(j.description || j.property || '') + ' · ' + UI.money(j.total || 0) + '</div></div>'
        + '</label>';
    });
    html += '</div>';

    UI.showModal('Generate Invoices (' + uninvoiced.length + ' jobs)', html, {
      footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
        + ' <button class="btn btn-primary" onclick="InvoicesPage._doGenerate()">Generate Selected</button>'
    });
  },

  _doGenerate: function() {
    var checks = document.querySelectorAll('.gen-inv-check:checked');
    var count = 0;
    checks.forEach(function(cb) {
      var jobId = cb.getAttribute('data-id');
      var j = DB.jobs.getById(jobId);
      if (!j) return;
      var invNum = DB.invoices.getAll().length + count + 1;
      DB.invoices.create({
        invoiceNumber: invNum,
        clientId: j.clientId,
        clientName: j.clientName,
        clientEmail: j.clientEmail,
        clientPhone: j.clientPhone,
        jobId: j.id,
        subject: 'For Services Rendered',
        lineItems: j.lineItems || [],
        total: j.total || 0,
        balance: j.total || 0,
        issuedDate: new Date().toISOString().split('T')[0],
        status: 'draft'
      });
      DB.jobs.update(jobId, { invoiceId: 'generated' });
      count++;
    });
    UI.closeModal();
    UI.toast(count + ' invoice' + (count !== 1 ? 's' : '') + ' generated! 🧾');
    loadPage('invoices');
  },

  _getPayLink: function(id) {
    var inv = DB.invoices.getById(id);
    // If ID is a UUID, use it directly; otherwise append invoice_number as fallback
    var isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID || !inv || !inv.invoiceNumber) {
      return 'https://peekskilltree.com/branchmanager/pay.html?id=' + id;
    }
    // Legacy non-UUID ID: use invoice_number so pay.html can find it
    return 'https://peekskilltree.com/branchmanager/pay.html?id=' + encodeURIComponent(inv.invoiceNumber);
  },

  _copyPayLink: function(id) {
    var link = InvoicesPage._getPayLink(id);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(function() { UI.toast('Pay link copied!'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = link; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      UI.toast('Pay link copied!');
    }
  },

  _saveStripeUrl: function(id, url) {
    if (url && !url.startsWith('https://')) { UI.toast('Must be a valid https:// URL', 'error'); return; }
    DB.invoices.update(id, { stripePaymentUrl: url || null });
    UI.toast(url ? 'Payment link saved!' : 'Payment link removed');
    InvoicesPage.showDetail(id);
  },

  _copyStripeLink: function(id) {
    var inv = DB.invoices.getById(id);
    if (!inv || !inv.stripePaymentUrl) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(inv.stripePaymentUrl).then(function() { UI.toast('Copied!'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = inv.stripePaymentUrl; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      UI.toast('Copied!');
    }
  },

  _sendInvoiceEmail: function(id) {
    var inv = DB.invoices.getById(id);
    if (!inv) return;
    var client = inv.clientId ? DB.clients.getById(inv.clientId) : null;
    var email = inv.clientEmail || (client && client.email) || '';
    if (!email) { UI.toast('No email address for this client', 'error'); return; }
    var firstName = (inv.clientName || '').split(' ')[0] || 'there';
    var payLink = InvoicesPage._getPayLink(id);
    var amtDue = UI.money(inv.balance || inv.total);
    var subject = 'Invoice #' + inv.invoiceNumber + ' from ' + InvoicesPage._co().name + ' — ' + amtDue;

    // Plain text fallback
    var body = 'Hi ' + firstName + ',\n\n'
      + 'Thank you for choosing ' + InvoicesPage._co().name + '! Your invoice is ready:\n\n'
      + '  Invoice #' + inv.invoiceNumber + '\n'
      + (inv.subject ? '  Job: ' + inv.subject + '\n' : '')
      + '  Amount Due: ' + amtDue + '\n'
      + (inv.dueDate ? '  Due: ' + UI.dateShort(inv.dueDate) + '\n' : '') + '\n'
      + 'Pay online (card, or tip optional):\n' + payLink + '\n\n'
      + ''
      + 'Questions? Reply to this email or call/text ' + InvoicesPage._co().phone + '.\n\n'
      + 'Thanks,\nDoug Brown\n' + InvoicesPage._co().name + '\n' + InvoicesPage._co().phone + '\n' + InvoicesPage._co().website;

    // Branded HTML email
    var lineItemsHtml = '';
    if (inv.lineItems && inv.lineItems.length) {
      lineItemsHtml = '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">'
        + '<tr style="background:#f0f9f4;"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#555;font-weight:600;border-bottom:2px solid #c8e6c9;">SERVICE</th><th style="padding:8px 12px;text-align:right;font-size:12px;color:#555;font-weight:600;border-bottom:2px solid #c8e6c9;">AMOUNT</th></tr>';
      inv.lineItems.forEach(function(item) {
        var amt = item.amount || ((item.qty||1) * (item.rate||0));
        lineItemsHtml += '<tr><td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">' + (item.service||item.description||'Service') + '</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #e0e0e0;font-weight:600;">' + UI.money(amt) + '</td></tr>';
      });
      lineItemsHtml += '<tr style="background:#f0f9f4;"><td style="padding:10px 12px;font-weight:700;">Total</td><td style="padding:10px 12px;text-align:right;font-weight:800;color:#00836c;font-size:16px;">' + UI.money(inv.total) + '</td></tr></table>';
    }

    var htmlBody = '<div style="background:#f5f6f8;padding:24px 0;">'
      + '<div style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">'
      // Header
      + '<div style="background:linear-gradient(135deg,#1a3c12 0%,#00836c 100%);border-radius:12px 12px 0 0;padding:24px 28px;color:#fff;">'
      + '<div style="font-size:13px;opacity:.8;margin-bottom:4px;">🌳 ' + InvoicesPage._co().name + '</div>'
      + '<div style="font-size:26px;font-weight:900;letter-spacing:-0.5px;">Invoice #' + inv.invoiceNumber + '</div>'
      + '<div style="font-size:38px;font-weight:900;margin:8px 0 4px;letter-spacing:-1px;">' + amtDue + '</div>'
      + '<div style="font-size:13px;opacity:.75;">' + (inv.dueDate ? 'Due ' + UI.dateShort(inv.dueDate) : 'Balance due') + ' &nbsp;·&nbsp; ' + (inv.clientName||'') + '</div>'
      + '</div>'
      // Body
      + '<div style="background:#fff;border-radius:0 0 12px 12px;padding:24px 28px;">'
      + '<p style="font-size:15px;color:#2d3748;margin-bottom:16px;">Hi ' + firstName + ',</p>'
      + '<p style="font-size:14px;color:#4a5568;line-height:1.6;margin-bottom:16px;">Thank you for choosing ' + InvoicesPage._co().name + '! Your invoice is ready to view and pay online.</p>'
      + (inv.subject ? '<p style="font-size:13px;color:#718096;margin-bottom:16px;">📋 <strong>Job:</strong> ' + inv.subject + '</p>' : '')
      + lineItemsHtml
      // Pay button
      + '<div style="text-align:center;margin:24px 0;">'
      + '<a href="' + payLink + '" style="display:inline-block;background:linear-gradient(135deg,#00836c,#1a3c12);color:#fff;padding:16px 36px;border-radius:10px;font-size:17px;font-weight:800;text-decoration:none;letter-spacing:-0.3px;box-shadow:0 4px 14px rgba(0,131,108,.35);">💳 Pay ' + amtDue + ' Online</a>'
      + '</div>'
      + '<p style="font-size:12px;color:#a0aec0;text-align:center;margin-bottom:20px;">You can also add an optional gratuity for the crew on the payment page.</p>'
      + ''
      + '<p style="font-size:13px;color:#718096;margin-top:16px;">Questions? Reply to this email or call/text <strong>' + InvoicesPage._co().phone + '</strong>.</p>'
      + '<p style="font-size:13px;color:#2d3748;margin-top:12px;">Thanks,<br><strong>Doug Brown</strong><br>' + InvoicesPage._co().name + '</p>'
      + '</div></div></div>';

    if (typeof Email !== 'undefined') {
      Email.send(email, subject, body, { htmlBody: htmlBody }).then(function(result) {
        if (result && result.ok) {
          DB.invoices.update(id, { status: 'sent', sentAt: new Date().toISOString() });
          UI.toast('Invoice sent to ' + email + ' ✓');
        } else {
          UI.toast('Email error: ' + (result && result.error ? result.error : 'unknown'), 'error');
        }
        InvoicesPage.showDetail(id);
      });
    } else {
      window.open('mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), '_blank');
      DB.invoices.update(id, { status: 'sent', sentAt: new Date().toISOString() });
      InvoicesPage.showDetail(id);
    }
  },

  showDetail: function(id) {
    var inv = DB.invoices.getById(id);
    if (!inv) return;

    var statusColors = {draft:'#6c757d',sent:'#1565c0',viewed:'#e07c24',partial:'#e6a817',paid:'#2e7d32',overdue:'#dc3545',cancelled:'#6c757d'};
    var statusColor = statusColors[inv.status] || '#1565c0';

    // Look up client for contact info
    var client = inv.clientId ? DB.clients.getById(inv.clientId) : null;
    var clientPhone = inv.clientPhone || (client ? client.phone : '');
    var clientEmail = inv.clientEmail || (client ? client.email : '');
    var clientAddr = inv.property || (client ? client.address : '');

    var html = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px;">'
      // Colored status bar
      + '<div style="height:4px;background:' + statusColor + ';margin:-24px -24px 16px -24px;border-radius:12px 12px 0 0;"></div>'
      // Status + actions row — single row on desktop, stacks gracefully on mobile
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;">'
      + '<button class="btn btn-outline" onclick="loadPage(\'invoices\')" style="padding:6px 12px;font-size:12px;flex-shrink:0;">← Back</button>'
      + UI.statusBadge(inv.status)
      + '<div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
      + '<button class="btn btn-outline" onclick="PDF.generateInvoice(\'' + id + '\')" style="font-size:12px;">📄 PDF</button>'
      + (inv.status !== 'paid' ? '<button class="btn btn-outline" onclick="InvoicesPage._copyPayLink(\'' + id + '\')" style="font-size:12px;">🔗 Pay Link</button>' : '')
      + (inv.status !== 'paid' ? '<button class="btn btn-outline" onclick="InvoicesPage._sendInvoiceEmail(\'' + id + '\')" style="font-size:12px;">📧 Send</button>' : '')
      + (inv.status !== 'paid' ? '<button class="btn btn-primary" onclick="if(typeof Workflow!==\'undefined\')Workflow.showMarkPaid(\'' + id + '\');else InvoicesPage._quickPay(\'' + id + '\');" style="font-size:12px;font-weight:700;">💵 Mark Paid</button>' : '<span style="font-size:12px;color:var(--green-dark);font-weight:700;">✓ Paid ' + UI.money(inv.total) + '</span>')
      + '<div style="position:relative;display:inline-block;">'
      + '<button onclick="var d=this.nextElementSibling;document.querySelectorAll(\'.more-dd\').forEach(function(x){x.style.display=\'none\'});d.style.display=d.style.display===\'block\'?\'none\':\'block\';" class="btn btn-outline" style="font-size:13px;padding:6px 10px;">•••</button>'
      + '<div class="more-dd" style="display:none;position:absolute;right:0;top:calc(100% + 4px);background:#fff;border:1px solid var(--border);border-radius:8px;padding:4px 0;z-index:200;min-width:180px;box-shadow:0 4px 16px rgba(0,0,0,.12);">'
      + '<button onclick="InvoicesPage._sendInvoiceEmail(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:var(--text);">📧 Send Invoice Email</button>'
      + '<button onclick="InvoicesPage._copyPayLink(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:var(--text);">🔗 Copy Pay Link</button>'
      + '<button onclick="PDF.generateInvoice(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:var(--text);">📄 Download PDF</button>'
      + '<button onclick="InvoicesPage.showForm(\'' + id + '\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:var(--text);">✏️ Edit Invoice</button>'
      + '<div style="height:1px;background:var(--border);margin:4px 0;"></div>'
      + '<button onclick="InvoicesPage.setStatus(\'' + id + '\',\'cancelled\')" style="display:block;width:100%;text-align:left;padding:8px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#dc3545;">✗ Cancel Invoice</button>'
      + '</div></div>'
      + '</div></div>'
      // Title
      + '<h2 style="font-size:24px;font-weight:700;margin-bottom:4px;">Invoice #' + (inv.invoiceNumber||'') + ' — ' + UI.esc(inv.clientName || 'Client') + '</h2>'
      + '<div style="font-size:14px;color:var(--text-light);margin-bottom:20px;">' + (inv.subject ? UI.esc(inv.subject) + ' · ' : '') + (inv.dueDate ? 'Due ' + UI.dateShort(inv.dueDate) : 'No due date set') + '</div>'

      // Two-column: Client card + metadata
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;" class="detail-grid">'
      // Client card
      + '<div style="background:var(--bg);border-radius:8px;padding:16px;">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'
      + '<div style="width:10px;height:10px;border-radius:50%;background:' + statusColor + ';"></div>'
      + '<span style="font-weight:700;font-size:15px;">' + UI.esc(inv.clientName || '—') + '</span></div>'
      + (clientAddr ? '<div style="font-size:13px;color:var(--text-light);margin-bottom:8px;">📍 ' + UI.esc(clientAddr) + '</div>' : '')
      + (clientPhone ? '<a href="tel:' + clientPhone.replace(/\D/g,'') + '" style="display:block;font-size:13px;color:var(--accent);margin-bottom:4px;">📞 ' + UI.phone(clientPhone) + '</a>' : '')
      + (clientEmail ? '<a href="mailto:' + clientEmail + '" style="display:block;font-size:13px;color:var(--accent);">✉️ ' + clientEmail + '</a>' : '')
      + '</div>'
      // Metadata table
      + '<div style="background:var(--bg);border-radius:8px;padding:16px;">'
      + '<table style="width:100%;font-size:13px;border-collapse:collapse;">'
      + '<tr><td style="padding:4px 0;color:var(--text-light);">Invoice #</td><td style="padding:4px 0;text-align:right;font-weight:600;">' + (inv.invoiceNumber || '—') + '</td></tr>'
      + '<tr><td style="padding:4px 0;color:var(--text-light);">Issued</td><td style="padding:4px 0;text-align:right;">' + UI.dateShort(inv.issuedDate || inv.createdAt) + '</td></tr>'
      + '<tr><td style="padding:4px 0;color:var(--text-light);">Due</td><td style="padding:4px 0;text-align:right;">' + UI.dateShort(inv.dueDate) + '</td></tr>'
      + (inv.subtotal ? '<tr><td style="padding:4px 0;color:var(--text-light);">Subtotal</td><td style="padding:4px 0;text-align:right;">' + UI.money(inv.subtotal) + '</td></tr>' : '')
      + (inv.taxRate ? '<tr><td style="padding:4px 0;color:var(--text-light);">Tax (' + inv.taxRate + '%)</td><td style="padding:4px 0;text-align:right;">' + UI.money(inv.taxAmount || 0) + '</td></tr>' : '')
      + '<tr><td style="padding:4px 0;color:var(--text-light);">Total</td><td style="padding:4px 0;text-align:right;font-weight:700;">' + UI.money(inv.total) + '</td></tr>'
      + '<tr><td style="padding:4px 0;color:var(--text-light);">Paid</td><td style="padding:4px 0;text-align:right;font-weight:700;color:var(--accent);">' + UI.money((inv.total||0) - (inv.balance||0)) + '</td></tr>'
      + '<tr style="border-top:1px solid var(--border);"><td style="padding:6px 0;color:var(--text-light);font-weight:700;">Balance</td><td style="padding:6px 0;text-align:right;font-weight:800;font-size:15px;color:' + (inv.balance > 0 ? 'var(--red)' : 'var(--accent)') + ';">' + UI.money(inv.balance || 0) + '</td></tr>'
      + '</table></div>'
      + '</div></div>';

    // Main content area
    html += '<div style="display:grid;grid-template-columns:1fr 300px;gap:20px;margin-top:20px;" class="detail-grid"><div>';

    // Line items
    html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px;">'
      + '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin:0;">Products / Services</h4></div>';
    if (inv.lineItems && inv.lineItems.length) {
      html += '<table class="data-table" style="border:none;border-radius:0;"><thead><tr><th>Service</th><th>Description</th><th>Qty</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Amount</th></tr></thead><tbody>';
      inv.lineItems.forEach(function(item) {
        html += '<tr><td style="font-weight:600;">' + (item.service || 'Custom') + '</td><td style="color:var(--text-light);">' + (item.description || '') + '</td><td>' + (item.qty || 1) + '</td><td style="text-align:right;">' + UI.money(item.rate) + '</td><td style="text-align:right;font-weight:600;">' + UI.money(item.amount || (item.qty||1) * item.rate) + '</td></tr>';
      });
      if (inv.taxRate) {
        var invSubDisplay = inv.subtotal || (inv.total - (inv.taxAmount || 0));
        html += '<tr><td colspan="4" style="text-align:right;color:var(--text-light);">Subtotal</td><td style="text-align:right;">' + UI.money(invSubDisplay) + '</td></tr>';
        html += '<tr><td colspan="4" style="text-align:right;color:var(--text-light);">Tax (' + inv.taxRate + '%)</td><td style="text-align:right;">' + UI.money(inv.taxAmount || 0) + '</td></tr>';
      }
      html += '<tr style="background:var(--green-bg);"><td colspan="4" style="text-align:right;font-weight:700;">Total</td><td style="text-align:right;font-weight:800;font-size:15px;color:var(--accent);">' + UI.money(inv.total) + '</td></tr>';
      html += '</tbody></table>';
    } else {
      html += '<div style="padding:20px;text-align:center;color:var(--text-light);font-size:13px;">No line items</div>';
    }
    html += '</div>';

    // Payment history
    html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Payment History</h4>';
    if (typeof Payments !== 'undefined') { html += Payments.renderForInvoice(id); }
    else { html += '<div style="color:var(--text-light);font-size:13px;">No payments recorded</div>'; }
    html += '</div></div>';

    // Right sidebar
    html += '<div>';
    // Record Payment
    html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Record Payment</h4>';
    if (inv.status !== 'paid') {
      if (typeof Workflow !== 'undefined') {
        html += Workflow.invoiceActions(id);
      } else if (typeof Stripe !== 'undefined') {
        html += Stripe.paymentButton(id);
      }
      if (typeof Stripe !== 'undefined' && inv.balance > 0) {
        var fees = Stripe.calcFees(inv.balance || inv.total);
        html += '<div style="margin-top:10px;font-size:12px;color:var(--text-light);display:flex;gap:16px;flex-wrap:wrap;">'
          + '<span>Card fee: $' + fees.card.toFixed(2) + '</span>'
          + '<span>ACH fee: $' + fees.ach.toFixed(2) + '</span></div>';
      }
    } else {
      html += '<div style="text-align:center;padding:12px;color:var(--accent);font-weight:600;">Fully Paid</div>';
    }
    html += '</div>';

    // Stripe Payment Link
    if (inv.status !== 'paid') {
      html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;">'
        + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">💳 Stripe Payment Link</h4>'
        + (inv.stripePaymentUrl
          ? '<div style="background:var(--green-bg);border:1px solid var(--green-border,#c8e6c9);border-radius:7px;padding:10px 12px;margin-bottom:8px;">'
            + '<div style="font-size:12px;font-weight:600;color:var(--green-dark,#2e7d32);margin-bottom:4px;">✅ Stripe link connected</div>'
            + '<div style="font-size:11px;color:var(--text-light);word-break:break-all;">' + UI.esc(inv.stripePaymentUrl) + '</div>'
            + '</div>'
            + '<div style="display:flex;gap:6px;">'
            + '<button class="btn btn-outline" style="font-size:11px;flex:1;" onclick="InvoicesPage._copyStripeLink(\'' + id + '\')">Copy Link</button>'
            + '<button class="btn btn-outline" style="font-size:11px;flex:1;" onclick="InvoicesPage._saveStripeUrl(\'' + id + '\',\'\')">Remove</button>'
            + '</div>'
          : '<div style="display:flex;gap:6px;margin-bottom:6px;">'
            + '<input type="text" id="stripe-url-' + id + '" placeholder="https://buy.stripe.com/..." style="flex:1;padding:7px 10px;border:2px solid var(--border);border-radius:6px;font-size:12px;">'
            + '<button class="btn btn-primary" style="font-size:11px;white-space:nowrap;" onclick="InvoicesPage._saveStripeUrl(\'' + id + '\',document.getElementById(\'stripe-url-' + id + '\').value.trim())">Save</button>'
            + '</div>'
            + '<div style="font-size:11px;color:var(--text-light);">Get one: <a href="https://dashboard.stripe.com/payment-links" target="_blank" style="color:var(--accent);">dashboard.stripe.com → Payment Links</a></div>')
        + '</div>';
    }

    // Status workflow
    html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px;">'
      + '<h4 style="font-size:13px;color:var(--text-light);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Update Status</h4>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    var invStatusBtns = [['draft','Draft'],['sent','Sent'],['partial','Partial'],['paid','Paid'],['overdue','Overdue'],['cancelled','Cancelled']];
    invStatusBtns.forEach(function(sb) {
      var isActive = inv.status === sb[0];
      html += '<button onclick="InvoicesPage.setStatus(\'' + inv.id + '\',\'' + sb[0] + '\')" style="font-size:11px;padding:5px 12px;border-radius:6px;border:1px solid '
        + (isActive ? '#2e7d32' : 'var(--border)') + ';background:' + (isActive ? '#2e7d32' : 'var(--white)') + ';color:' + (isActive ? '#fff' : 'var(--text)') + ';cursor:pointer;font-weight:' + (isActive ? '700' : '500') + ';">'
        + sb[1] + '</button>';
    });
    html += '</div></div>';

    html += '</div></div>';

    document.getElementById('pageTitle').textContent = 'Invoice #' + inv.invoiceNumber;
    document.getElementById('pageContent').innerHTML = html;
    document.getElementById('pageAction').style.display = 'none';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  },

  setStatus: function(id, status) {
    var updates = { status: status };
    if (status === 'paid') {
      updates.balance = 0;
      updates.paidDate = new Date().toISOString();
    }
    DB.invoices.update(id, updates);
    UI.toast('Invoice status: ' + status);
    UI.closeModal();
    loadPage('invoices');
  },

  markPaid: function(id) {
    InvoicesPage.setStatus(id, 'paid');
  },

  // ── New Invoice Form ──
  showForm: function(invoiceId, clientId) {
    var inv = invoiceId ? DB.invoices.getById(invoiceId) : {};
    // Pre-fill client from parameter (e.g., from client detail page)
    if (!inv.clientId && clientId) {
      var prefillClient = DB.clients.getById(clientId);
      if (prefillClient) {
        inv.clientId = clientId;
        inv.clientName = prefillClient.name;
      }
    }
    var items = inv.lineItems || [{ description: '', qty: 1, rate: 0 }];
    var services = DB.services.getAll();

    var allClients = [];
    try { allClients = JSON.parse(localStorage.getItem('bm-clients') || '[]'); } catch(e) {}

    var today = new Date();
    var todayStr = today.toISOString().split('T')[0];
    var due = new Date(today);
    due.setDate(due.getDate() + 30);
    var dueStr = due.toISOString().split('T')[0];

    var html = '<form id="inv-form" onsubmit="InvoicesPage.save(event, \'' + (invoiceId || '') + '\')">';

    // Client selector
    if (inv.clientId) {
      var client = DB.clients.getById(inv.clientId);
      html += '<input type="hidden" id="inv-clientId" value="' + inv.clientId + '">'
        + '<div class="form-group"><label>Client</label><div style="padding:8px 12px;background:var(--bg);border-radius:8px;font-weight:600;">' + UI.esc(inv.clientName || (client ? client.name : '')) + '</div></div>';
    } else {
      var clientOptions = allClients.map(function(c) { return { value: c.id, label: c.name + (c.address ? ' — ' + c.address : '') }; });
      html += UI.formField('Client *', 'select', 'inv-clientId', '', { options: [{ value: '', label: 'Select a client...' }].concat(clientOptions) });
    }

    html += UI.formField('Property Address', 'text', 'inv-property', inv.property || (inv.clientId && DB.clients.getById(inv.clientId) ? DB.clients.getById(inv.clientId).address : ''), { placeholder: 'Property address' });
    html += UI.formField('Subject', 'text', 'inv-subject', inv.subject || 'For Services Rendered', { placeholder: 'Invoice subject' });

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
      + UI.formField('Issue Date', 'date', 'inv-issueDate', inv.issuedDate ? inv.issuedDate.split('T')[0] : todayStr)
      + UI.formField('Due Date', 'date', 'inv-dueDate', inv.dueDate ? inv.dueDate.split('T')[0] : dueStr)
      + '</div>';

    // Line items
    html += '<div style="margin:16px 0 8px;font-weight:700;">Line Items</div>'
      + '<div id="inv-items">';
    items.forEach(function(item, i) {
      html += InvoicesPage._itemRow(i, item, services);
    });
    html += '</div>'
      + '<button type="button" class="btn btn-outline" style="margin-top:8px;" onclick="InvoicesPage.addItem()">+ Add Line Item</button>';

    // Total display with tax breakdown (Jobber style)
    var _invSubtotal = 0;
    (inv.lineItems || []).forEach(function(it) { _invSubtotal += (it.qty || 1) * (it.rate || 0); });
    var _invTaxRate = (inv.taxRate !== undefined ? inv.taxRate : (parseFloat(localStorage.getItem('bm-tax-rate')) || 8.375));
    var _invTaxAmt = Math.round(_invSubtotal * _invTaxRate / 100 * 100) / 100;
    var _invGrandTotal = _invSubtotal + _invTaxAmt;
    html += '<div style="margin-top:16px;background:var(--bg);border:1px solid var(--border);border-radius:10px;overflow:hidden;">'
      + '<div style="padding:10px 16px;display:flex;justify-content:space-between;align-items:center;font-size:13px;border-bottom:1px solid var(--border);">'
      + '<span style="color:var(--text-light);">Subtotal</span><span id="inv-subtotal-display" style="font-weight:600;">' + UI.money(_invSubtotal) + '</span>'
      + '</div>'
      + '<div style="padding:10px 16px;display:flex;justify-content:space-between;align-items:center;font-size:13px;border-bottom:1px solid var(--border);">'
      + '<span style="color:var(--text-light);">Tax (' + _invTaxRate + '%)</span><input type="hidden" id="inv-tax-rate" value="' + _invTaxRate + '">'
      + '<span id="inv-tax-display" style="font-weight:600;">' + UI.money(_invTaxAmt) + '</span>'
      + '</div>'
      + '<div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;background:var(--green-dark);color:var(--white);">'
      + '<span style="font-weight:600;">Total</span>'
      + '<span id="inv-total-display" style="font-size:1.5rem;font-weight:800;">' + UI.money(inv.total || _invGrandTotal) + '</span>'
      + '</div>'
      + '</div>';

    html += UI.formField('Internal Notes', 'textarea', 'inv-notes', inv.notes || '', { placeholder: 'Notes (not shown to client)' })
      + '</form>';

    // Render as full page (not modal)
    var pageHtml = '<div style="max-width:680px;margin:0 auto;padding-bottom:80px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'
      + '<button class="btn btn-outline" onclick="loadPage(\'invoices\')" style="font-size:13px;">\u2190 Back to Invoices</button>'
      + '<div style="display:flex;gap:8px;">'
      + '<button class="btn btn-outline" onclick="InvoicesPage.saveAs(\'draft\')">Save Draft</button>'
      + '<button class="btn btn-primary" onclick="InvoicesPage.saveAs(\'sent\')">Save & Send</button>'
      + '</div></div>'
      + '<h2 style="font-size:20px;margin-bottom:16px;">' + (invoiceId ? 'Edit Invoice #' + inv.invoiceNumber : 'New Invoice') + '</h2>'
      + html
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">'
      + '<button class="btn btn-outline" onclick="loadPage(\'invoices\')">Cancel</button>'
      + '<button class="btn btn-outline" onclick="InvoicesPage.saveAs(\'draft\')">Save Draft</button>'
      + '<button class="btn btn-primary" onclick="InvoicesPage.saveAs(\'sent\')">Save & Send</button>'
      + '</div></div>';

    var content = document.getElementById('pageContent');
    if (content) content.innerHTML = pageHtml;
  },

  _itemRow: function(index, item, services) {
    var svcOptions = services.map(function(s) {
      return '<option value="' + s.name + '"' + (item.service === s.name ? ' selected' : '') + '>' + s.name + (s.type === 'product' ? ' (product)' : '') + '</option>';
    }).join('');

    var lineTotal = ((item.qty || 1) * (item.rate || 0));

    return '<div class="inv-item-row" style="display:grid;grid-template-columns:2fr 2fr 60px 90px 80px 36px;gap:8px;align-items:end;margin-bottom:8px;padding:10px 12px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Service</label><select class="inv-item-service" onchange="InvoicesPage._onServiceChange(this)" style="font-size:13px;"><option value="">— Select or type custom —</option>' + svcOptions + '</select></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Description</label><input class="inv-item-desc" value="' + UI.esc(item.description || '') + '" placeholder="Work details..." style="font-size:13px;"></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Qty</label><input type="number" class="inv-item-qty" value="' + (item.qty || 1) + '" min="1" oninput="InvoicesPage.calcTotal()" style="font-size:13px;text-align:center;"></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Rate ($)</label><input type="number" class="inv-item-rate" value="' + (item.rate || '') + '" step="0.01" placeholder="0.00" oninput="InvoicesPage.calcTotal()" style="font-size:13px;"></div>'
      + '<div class="form-group" style="margin:0;"><label style="font-size:11px;font-weight:600;">Amount</label><div class="inv-item-amount" style="font-size:14px;font-weight:700;color:var(--green-dark);padding:8px 0;">' + UI.money(lineTotal) + '</div></div>'
      + '<button type="button" style="background:none;border:none;font-size:20px;color:var(--red);cursor:pointer;padding-bottom:8px;opacity:.6;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.6" onclick="this.parentElement.remove();InvoicesPage.calcTotal();">&#10005;</button>'
      + '</div>';
  },

  _onServiceChange: function(sel) {
    var row = sel.closest('.inv-item-row');
    var svc = sel.value;
    var services = DB.services.getAll();
    var match = null;
    for (var i = 0; i < services.length; i++) {
      if (services[i].name === svc) { match = services[i]; break; }
    }
    var descInput = row.querySelector('.inv-item-desc');
    if (match && match.description && !descInput.value) {
      descInput.value = match.description;
    }
    if (match && match.price) {
      row.querySelector('.inv-item-rate').value = match.price;
    }
    InvoicesPage.calcTotal();
  },

  addItem: function() {
    var container = document.getElementById('inv-items');
    var index = container.children.length;
    var services = DB.services.getAll();
    var div = document.createElement('div');
    div.innerHTML = InvoicesPage._itemRow(index, { description: '', qty: 1, rate: 0 }, services);
    container.appendChild(div.firstChild);
  },

  calcTotal: function() {
    var subtotal = 0;
    var rows = document.querySelectorAll('.inv-item-row');
    rows.forEach(function(row) {
      var qty = parseFloat(row.querySelector('.inv-item-qty').value) || 0;
      var rate = parseFloat(row.querySelector('.inv-item-rate').value) || 0;
      var amount = qty * rate;
      subtotal += amount;
      var amountEl = row.querySelector('.inv-item-amount');
      if (amountEl) amountEl.textContent = UI.money(amount);
    });
    var taxRateEl = document.getElementById('inv-tax-rate');
    var taxRate = taxRateEl ? (parseFloat(taxRateEl.value) || 0) : 0;
    var taxAmt = Math.round(subtotal * taxRate / 100 * 100) / 100;
    var total = subtotal + taxAmt;
    var subEl = document.getElementById('inv-subtotal-display');
    var taxEl = document.getElementById('inv-tax-display');
    var totEl = document.getElementById('inv-total-display');
    if (subEl) subEl.textContent = UI.money(subtotal);
    if (taxEl) taxEl.textContent = UI.money(taxAmt);
    if (totEl) totEl.textContent = UI.money(total);
  },

  saveAs: function(status) {
    var form = document.getElementById('inv-form');
    if (!form) return;
    form.dataset.saveStatus = status;
    form.requestSubmit();
  },

  save: function(e, invoiceId) {
    e.preventDefault();
    try { return InvoicesPage._saveImpl(e, invoiceId); }
    catch(err) {
      console.error('[InvoicesPage.save] ERROR:', err);
      InvoicesPage._saving = false;
      var f = e.target || document.getElementById('inv-form');
      if (f) f.querySelectorAll('button').forEach(function(b) { b.disabled = false; b.style.opacity = ''; b.style.cursor = ''; });
      UI.toast('Save failed: ' + (err && err.message ? err.message : err), 'error');
    }
  },

  _saveImpl: function(e, invoiceId) {
    // Guard against double-submit (don't disable on validation-only failures)
    if (InvoicesPage._saving) return;
    var form = e.target || document.getElementById('inv-form');
    var _disableButtons = function() {
      InvoicesPage._saving = true;
      if (form) form.querySelectorAll('button[type=submit], button[onclick*="requestSubmit"]').forEach(function(b) {
        b.disabled = true; b.style.opacity = '0.5'; b.style.cursor = 'wait';
      });
    };
    var _unsave = function() {
      InvoicesPage._saving = false;
      if (form) form.querySelectorAll('button').forEach(function(b) {
        b.disabled = false; b.style.opacity = ''; b.style.cursor = '';
      });
    };
    var clientIdEl = document.getElementById('inv-clientId');
    var clientId = clientIdEl ? clientIdEl.value : '';
    if (!clientId) {
      UI.toast('Client required — pick or create one before saving', 'error');
      var clientArea = document.getElementById('inv-client-search') || document.getElementById('inv-client-block') || clientIdEl;
      if (clientArea && clientArea.scrollIntoView) clientArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (clientArea) {
        var orig = clientArea.style.boxShadow;
        clientArea.style.boxShadow = '0 0 0 3px #dc3545';
        clientArea.style.transition = 'box-shadow .3s';
        setTimeout(function() { if (document.contains(clientArea)) clientArea.style.boxShadow = orig || ''; }, 2500);
      }
      // Don't disable buttons — user needs to retry after picking client
      return;
    }
    var client = DB.clients.getById(clientId);
    if (!client) {
      UI.toast('Selected client no longer exists — pick another', 'error');
      return;
    }

    // Passed validation — NOW disable the buttons to prevent double-submit
    _disableButtons();

    var items = [];
    var subtotal = 0;
    document.querySelectorAll('.inv-item-row').forEach(function(row) {
      var service = row.querySelector('.inv-item-service').value;
      var desc = row.querySelector('.inv-item-desc').value;
      var qty = parseFloat(row.querySelector('.inv-item-qty').value) || 0;
      var rate = parseFloat(row.querySelector('.inv-item-rate').value) || 0;
      if (service || desc || rate) {
        items.push({ service: service, description: desc, qty: qty, rate: rate, amount: qty * rate });
        subtotal += qty * rate;
      }
    });
    var invTaxRateEl = document.getElementById('inv-tax-rate');
    var taxRate = invTaxRateEl ? (parseFloat(invTaxRateEl.value) || 0) : (parseFloat(localStorage.getItem('bm-tax-rate')) || 8.375);
    var taxAmount = Math.round(subtotal * taxRate / 100 * 100) / 100;
    var total = subtotal + taxAmount;

    // form already declared at top
    var status = (form && form.dataset.saveStatus) ? form.dataset.saveStatus : 'draft';

    // Preserve jobId/quoteId/property from existing invoice (don't lose on edit)
    var existingInv = invoiceId ? DB.invoices.getById(invoiceId) : {};
    var data = {
      clientId: clientId,
      clientName: client ? client.name : '',
      clientPhone: client ? client.phone : '',
      clientEmail: client ? client.email : '',
      property: (document.getElementById('inv-property') || {}).value || existingInv.property || (client ? client.address : '') || '',
      subject: document.getElementById('inv-subject').value.trim(),
      issuedDate: document.getElementById('inv-issueDate').value,
      dueDate: document.getElementById('inv-dueDate').value,
      lineItems: items,
      subtotal: subtotal,
      taxRate: taxRate,
      taxAmount: taxAmount,
      total: total,
      balance: total,
      notes: document.getElementById('inv-notes').value.trim(),
      jobId: existingInv.jobId || null,
      quoteId: existingInv.quoteId || null,
      status: status
    };

    if (invoiceId) {
      DB.invoices.update(invoiceId, data);
      UI.toast('Invoice updated');
    } else {
      DB.invoices.create(data);
      UI.toast('Invoice created');
    }

    _unsave();
    if (document.querySelector('.modal-overlay')) UI.closeModal();
    loadPage('invoices');
  }
};
