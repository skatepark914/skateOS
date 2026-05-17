/**
 * Branch Manager — Data Layer
 * Uses localStorage now, swap to Supabase by replacing these functions.
 * All functions return arrays/objects. No UI logic here.
 */
var DB = (function() {
  var KEYS = {
    clients: 'bm-clients',
    requests: 'bm-requests',
    quotes: 'bm-quotes',
    jobs: 'bm-jobs',
    invoices: 'bm-invoices',
    services: 'bm-services',
    timeEntries: 'bm-time-entries',
    settings: 'bm-settings'
  };

  function _get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch(e) { return []; }
  }
  function _set(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch(e) {
      // localStorage quota exceeded — warn user
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.error('localStorage full! Data may not be saved for: ' + key);
        if (typeof UI !== 'undefined' && UI.toast) {
          UI.toast('Storage full — some data may not save. Clear old data in Settings.', 'error');
        }
      }
    }
  }
  function _id() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
  function _now() { return new Date().toISOString(); }

  // ── Audit Log ──
  var AUDIT_KEY = 'bm-audit-log';
  var AUDIT_MAX = 500;
  function _audit(action, table, recordId, details) {
    try {
      var log = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]');
      log.unshift({
        ts: _now(),
        user: (typeof Auth !== 'undefined' && Auth.user) ? Auth.user.name || Auth.user.email : 'system',
        action: action,
        table: table.replace('bm-', ''),
        recordId: recordId,
        details: details || ''
      });
      if (log.length > AUDIT_MAX) log.length = AUDIT_MAX;
      localStorage.setItem(AUDIT_KEY, JSON.stringify(log));
    } catch(e) {}
  }

  // ── Generic CRUD ──
  function getAll(key) { return _get(key); }
  function getById(key, id) { return _get(key).find(function(r) { return r.id === id; }) || null; }
  // Map localStorage keys to Supabase table names
  var REMOTE_TABLE = {
    'bm-clients': 'clients',
    'bm-requests': 'requests',
    'bm-quotes': 'quotes',
    'bm-jobs': 'jobs',
    'bm-invoices': 'invoices',
    'bm-services': 'services',
    'bm-team': 'team_members'
  };

  function _pushToCloud(key, record, method) {
    try {
      var table = REMOTE_TABLE[key];
      if (!table) return;
      // If a full cloud pull is in progress, defer the push so it can't be overwritten
      if (window._bmSyncLock) {
        console.log('[DB push] sync lock active, deferring', table, record.id);
        setTimeout(function() { _pushToCloud(key, record, method); }, 500);
        return;
      }
      var url = localStorage.getItem('bm-supabase-url') || 'https://ltpivkqahvplapyagljt.supabase.co';
      var apiKey = localStorage.getItem('bm-supabase-key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0cGl2a3FhaHZwbGFweWFnbGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTgxNzIsImV4cCI6MjA4OTY3NDE3Mn0.bQ-wAx4Uu-FyA2ZwsTVfFoU2ZPbeWCmupqV-6ZR9uFI';
      if (!url || !apiKey) return;

      // Convert camelCase to snake_case for Supabase
      var snakeRow = {};
      Object.keys(record).forEach(function(k) {
        var sk = k.replace(/([A-Z])/g, '_$1').toLowerCase();
        snakeRow[sk] = record[k];
      });

      // Use upsert to handle both insert and update
      fetch(url + '/rest/v1/' + table + '?on_conflict=id', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey,
          'Authorization': 'Bearer ' + apiKey,
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(snakeRow)
      }).catch(function(e) { console.warn('[DB cloud push]', table, e); });
    } catch(e) { console.warn('[DB cloud push] error', e); }
  }

  function create(key, record) {
    var all = _get(key);
    record.id = record.id || _id();
    record.createdAt = record.createdAt || _now();
    record.updatedAt = _now();
    all.unshift(record);
    _set(key, all);
    _audit('create', key, record.id, record.name || record.clientName || '');
    _pushToCloud(key, record, 'create');
    return record;
  }
  function update(key, id, changes) {
    var all = _get(key);
    var idx = all.findIndex(function(r) { return r.id === id; });
    if (idx < 0) return null;
    Object.assign(all[idx], changes, { updatedAt: _now() });
    _set(key, all);
    _audit('update', key, id, Object.keys(changes).join(','));
    _pushToCloud(key, all[idx], 'update');
    return all[idx];
  }
  function remove(key, id) {
    var item = _get(key).find(function(r) { return r.id === id; });
    _audit('delete', key, id, item ? (item.name || item.clientName || '') : '');
    var all = _get(key).filter(function(r) { return r.id !== id; });
    _set(key, all);
    _deleteFromCloud(key, id);
  }

  function _deleteFromCloud(key, id) {
    try {
      var table = REMOTE_TABLE[key];
      if (!table || !id) return;
      if (window._bmSyncLock) {
        setTimeout(function() { _deleteFromCloud(key, id); }, 500);
        return;
      }
      var url = localStorage.getItem('bm-supabase-url') || 'https://ltpivkqahvplapyagljt.supabase.co';
      var apiKey = localStorage.getItem('bm-supabase-key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0cGl2a3FhaHZwbGFweWFnbGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTgxNzIsImV4cCI6MjA4OTY3NDE3Mn0.bQ-wAx4Uu-FyA2ZwsTVfFoU2ZPbeWCmupqV-6ZR9uFI';
      if (!url || !apiKey) return;
      fetch(url + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { 'apikey': apiKey, 'Authorization': 'Bearer ' + apiKey }
      }).catch(function(e) { console.warn('[DB cloud delete]', table, e); });
    } catch(e) { console.warn('[DB cloud delete] error', e); }
  }
  function count(key, filterFn) {
    var all = _get(key);
    return filterFn ? all.filter(filterFn).length : all.length;
  }
  function search(key, query) {
    var q = (query || '').toLowerCase();
    if (!q) return _get(key);
    return _get(key).filter(function(r) {
      return JSON.stringify(r).toLowerCase().indexOf(q) >= 0;
    });
  }

  // ── Clients ──
  var clients = {
    getAll: function() { return getAll(KEYS.clients); },
    getById: function(id) { return getById(KEYS.clients, id); },
    create: function(data) { data.status = data.status || 'lead'; return create(KEYS.clients, data); },
    update: function(id, data) { return update(KEYS.clients, id, data); },
    remove: function(id) { remove(KEYS.clients, id); },
    search: function(q) { return search(KEYS.clients, q); },
    count: function(filterFn) { return count(KEYS.clients, filterFn); },
    countActive: function() { return count(KEYS.clients, function(c) { return c.status === 'active'; }); },
    countLeads: function() { return count(KEYS.clients, function(c) { return c.status === 'lead'; }); }
  };

  // ── Requests ──
  var requests = {
    getAll: function() { return getAll(KEYS.requests); },
    getById: function(id) { return getById(KEYS.requests, id); },
    create: function(data) { data.status = data.status || 'new'; return create(KEYS.requests, data); },
    update: function(id, data) { return update(KEYS.requests, id, data); },
    remove: function(id) { remove(KEYS.requests, id); },
    search: function(q) { return search(KEYS.requests, q); },
    count: function(filterFn) { return count(KEYS.requests, filterFn); },
    countNew: function() { return count(KEYS.requests, function(r) { return r.status === 'new'; }); }
  };

  // ── Quotes ──
  var nextQuoteNum = function() {
    var all = getAll(KEYS.quotes);
    var max = all.reduce(function(m, q) { return Math.max(m, q.quoteNumber || 0); }, 0);
    return max + 1;
  };
  var quotes = {
    getAll: function() { return getAll(KEYS.quotes); },
    getById: function(id) { return getById(KEYS.quotes, id); },
    create: function(data) {
      data.status = data.status || 'draft';
      data.quoteNumber = data.quoteNumber || nextQuoteNum();
      return create(KEYS.quotes, data);
    },
    update: function(id, data) { return update(KEYS.quotes, id, data); },
    remove: function(id) { remove(KEYS.quotes, id); },
    search: function(q) { return search(KEYS.quotes, q); },
    count: function(filterFn) { return count(KEYS.quotes, filterFn); }
  };

  // ── Jobs ──
  var nextJobNum = function() {
    var all = getAll(KEYS.jobs);
    var max = all.reduce(function(m, j) { return Math.max(m, j.jobNumber || 0); }, 399);
    return max + 1;
  };
  var jobs = {
    getAll: function() { return getAll(KEYS.jobs); },
    getById: function(id) { return getById(KEYS.jobs, id); },
    create: function(data) {
      data.status = data.status || 'scheduled';
      data.jobNumber = data.jobNumber || nextJobNum();
      return create(KEYS.jobs, data);
    },
    update: function(id, data) { return update(KEYS.jobs, id, data); },
    remove: function(id) { remove(KEYS.jobs, id); },
    search: function(q) { return search(KEYS.jobs, q); },
    count: function(filterFn) { return count(KEYS.jobs, filterFn); },
    getUpcoming: function() {
      var today = new Date().toISOString().split('T')[0];
      return getAll(KEYS.jobs).filter(function(j) {
        return j.scheduledDate && j.scheduledDate.substring(0, 10) >= today && j.status !== 'completed';
      }).sort(function(a, b) { return (a.scheduledDate || '').localeCompare(b.scheduledDate || ''); });
    },
    getToday: function() {
      var today = new Date().toISOString().split('T')[0];
      return getAll(KEYS.jobs).filter(function(j) {
        return j.scheduledDate && j.scheduledDate.substring(0, 10) === today;
      });
    },
    fixStatuses: function() {
      var valid = ['scheduled', 'in_progress', 'completed', 'late', 'cancelled'];
      var all = _get(KEYS.jobs);
      var changed = 0;
      all.forEach(function(j) {
        if (valid.indexOf(j.status) === -1) {
          var newStatus;
          if (j.status === 'active') { newStatus = 'in_progress'; }
          else if (j.status === 'unscheduled' || j.status === 'pending') { newStatus = 'scheduled'; }
          else if (j.status === 'done' || j.status === 'invoiced') { newStatus = 'completed'; }
          else { newStatus = 'scheduled'; }
          jobs.update(j.id, { status: newStatus });
          changed++;
        }
      });
      return changed;
    }
  };

  // ── Invoices ──
  var nextInvNum = function() {
    var all = getAll(KEYS.invoices);
    var max = all.reduce(function(m, i) { return Math.max(m, i.invoiceNumber || 0); }, 399);
    return max + 1;
  };
  var invoices = {
    getAll: function() { return getAll(KEYS.invoices); },
    getById: function(id) { return getById(KEYS.invoices, id); },
    create: function(data) {
      data.status = data.status || 'draft';
      data.invoiceNumber = data.invoiceNumber || nextInvNum();
      return create(KEYS.invoices, data);
    },
    update: function(id, data) { return update(KEYS.invoices, id, data); },
    remove: function(id) { remove(KEYS.invoices, id); },
    search: function(q) { return search(KEYS.invoices, q); },
    count: function(filterFn) { return count(KEYS.invoices, filterFn); },
    markOverdue: function() {
      var today = new Date().toISOString().split('T')[0];
      var all = _get(KEYS.invoices);
      var changed = 0;
      all.forEach(function(inv) {
        if (inv.status === 'past_due') {
          invoices.update(inv.id, { status: 'overdue' });
          changed++;
        } else if (inv.status !== 'paid' && inv.status !== 'cancelled' && inv.status !== 'overdue' && inv.status !== 'draft' && inv.dueDate && inv.dueDate.substring(0, 10) < today) {
          invoices.update(inv.id, { status: 'overdue' });
          changed++;
        }
      });
      return changed;
    },
    totalReceivable: function() {
      return getAll(KEYS.invoices).reduce(function(sum, inv) {
        if (inv.status !== 'paid') return sum + (inv.balance || inv.total || 0);
        return sum;
      }, 0);
    },
    totalRevenue: function(year, month) {
      return getAll(KEYS.invoices).reduce(function(sum, inv) {
        if (inv.status !== 'paid') return sum;
        var d = new Date(inv.paidDate || inv.createdAt);
        if (year && d.getFullYear() !== year) return sum;
        if (month !== undefined && d.getMonth() !== month) return sum;
        return sum + (inv.total || 0);
      }, 0);
    }
  };

  // ── Services Catalog ──
  var services = {
    getAll: function() { return getAll(KEYS.services); },
    create: function(data) { return create(KEYS.services, data); },
    update: function(id, data) { return update(KEYS.services, id, data); },
    remove: function(id) { remove(KEYS.services, id); },
    seed: function() {
      if (getAll(KEYS.services).length > 0) return;
      var defaults = [
        { name: 'Tree Removal', description: 'Schedule an estimate for a tree removal', type: 'service' },
        { name: 'Tree Pruning', description: 'General pruning to remove dead, damaged or crossing branches', type: 'service' },
        { name: 'Stump Removal', description: 'Stump grinding service', type: 'service' },
        { name: 'Bucket Truck', description: 'Per hour rate with operator. 2 hour minimum.', type: 'service' },
        { name: 'Cabling', description: '', type: 'service' },
        { name: 'Land Clearing', description: '', type: 'service' },
        { name: 'Snow Removal', description: 'Snow removal services for residential or corporate locations', type: 'service' },
        { name: 'Spring Clean Up', description: 'Clean out leaves, shape ornamentals. Remove material off site.', type: 'service' },
        { name: 'Gutter Clean Out', description: '', type: 'service' },
        { name: 'Haul Debris', description: 'Haul debris from site', type: 'service' },
        { name: 'Ice Dam Removal', description: 'Clearing snow and ice from impacted roof area', type: 'service' },
        { name: 'Labor', description: 'Hourly labor charge', type: 'service' },
        { name: 'Free Estimate', description: 'Please fill out the information form so we have everything ready to go', type: 'service' },
        { name: 'Arborist Letter', description: 'Letter from certified arborist detailing how work was done', type: 'service' },
        { name: 'Cat Rescue', description: 'Cat rescue', type: 'service' },
        { name: 'Firewood Bundle', description: 'Firewood', type: 'product' },
        { name: 'Firewood Cord', description: 'Firewood cord delivered within 10 miles', type: 'product' },
        { name: 'Firewood Splitting', description: 'Split your logs to firewood on site', type: 'service' },
        { name: 'Firewood Stacking', description: 'Stacking of firewood to customers desired location', type: 'service' },
        { name: 'Free Woodchips', description: 'Free Woodchips $50 delivery fee', type: 'product' },
        { name: 'Chipping Brush', description: '', type: 'service' }
      ];
      defaults.forEach(function(s) { create(KEYS.services, s); });
    }
  };

  // ── Expenses ──
  var expenses = {
    getAll: function() { try { return JSON.parse(localStorage.getItem('bm-expenses')) || []; } catch(e) { return []; } },
    count: function() { return expenses.getAll().length; },
    create: function(r) {
      var all = expenses.getAll();
      r.id = r.id || _id();
      r.date = r.date || _now();
      all.unshift(r);
      localStorage.setItem('bm-expenses', JSON.stringify(all));
      return r;
    },
    update: function(id, changes) {
      var all = expenses.getAll();
      var idx = all.findIndex(function(r) { return r.id === id; });
      if (idx < 0) return null;
      Object.assign(all[idx], changes);
      localStorage.setItem('bm-expenses', JSON.stringify(all));
      return all[idx];
    },
    remove: function(id) {
      var all = expenses.getAll().filter(function(r) { return r.id !== id; });
      localStorage.setItem('bm-expenses', JSON.stringify(all));
    },
    getById: function(id) { return expenses.getAll().find(function(r) { return r.id === id; }) || null; }
  };

  // ── Time Entries ──
  var timeEntries = {
    getAll: function() { return getAll(KEYS.timeEntries); },
    create: function(data) { return create(KEYS.timeEntries, data); },
    update: function(id, data) { return update(KEYS.timeEntries, id, data); },
    getByJob: function(jobId) { return getAll(KEYS.timeEntries).filter(function(t) { return t.jobId === jobId; }); },
    getByUser: function(userId, date) {
      return getAll(KEYS.timeEntries).filter(function(t) {
        // Support both 'userId' (DB clockIn) and 'user' (crewview clockOut) field names
        var entryUser = t.userId || t.user || '';
        if (entryUser !== userId) return false;
        if (date) {
          var entryDate = (t.date || t.clockIn || '').substring(0, 10);
          if (entryDate !== date) return false;
        }
        return true;
      });
    },
    clockIn: function(userId, jobId) {
      return create(KEYS.timeEntries, { userId: userId, user: userId, jobId: jobId, date: new Date().toISOString().split('T')[0], clockIn: _now(), clockOut: null, hours: 0 });
    },
    clockOut: function(entryId) {
      var entry = getById(KEYS.timeEntries, entryId);
      if (!entry) return null;
      var outTime = _now();
      var hours = (new Date(outTime) - new Date(entry.clockIn)) / 3600000;
      return update(KEYS.timeEntries, entryId, { clockOut: outTime, hours: Math.round(hours * 100) / 100 });
    }
  };

  // ── Dashboard Stats ──
  var dashboard = {
    getStats: function() {
      var today = new Date().toISOString().split('T')[0];
      var now = new Date();
      var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      var weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());

      return {
        todayJobs: jobs.getToday().length,
        receivables: invoices.totalReceivable(),
        weekRevenue: jobs.getUpcoming().reduce(function(s, j) { return s + (j.total || 0); }, 0),
        monthRevenue: invoices.totalRevenue(now.getFullYear(), now.getMonth()),
        totalClients: clients.count(),
        activeClients: clients.countActive(),
        leadClients: clients.countLeads(),
        newRequests: requests.countNew(),
        openQuotes: quotes.count(function(q) { return q.status === 'sent' || q.status === 'awaiting'; }),
        activeJobs: jobs.count(function(j) { return j.status !== 'completed' && j.status !== 'cancelled'; }),
        unpaidInvoices: invoices.count(function(i) { return i.status !== 'paid'; })
      };
    }
  };

  // ── Import from CSV ──
  function importCSV(key, csvText, mapFn) {
    var lines = csvText.split('\n');
    if (lines.length < 2) return 0;
    var headers = lines[0].split(',').map(function(h) { return h.trim().replace(/"/g, ''); });
    var imported = 0;
    for (var i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      // Simple CSV parse (handles quoted fields with commas)
      var vals = [];
      var inQuote = false, field = '';
      for (var c = 0; c < lines[i].length; c++) {
        var ch = lines[i][c];
        if (ch === '"') { inQuote = !inQuote; }
        else if (ch === ',' && !inQuote) { vals.push(field.trim()); field = ''; }
        else { field += ch; }
      }
      vals.push(field.trim());

      var row = {};
      headers.forEach(function(h, idx) { row[h] = vals[idx] || ''; });
      var record = mapFn ? mapFn(row) : row;
      if (record) { create(key, record); imported++; }
    }
    return imported;
  }

  // ── Seed demo data ──
  function seedDemo() {
    if (clients.count() > 0) return; // Already has data
    services.seed();

    // Demo clients
    var demoClients = [
      { name: 'Brian Heermance', address: '7 Lynwood Court, Cortlandt Manor, NY 10567', phone: '(646) 228-4455', email: 'bpwh1@outlook.com', status: 'active' },
      { name: 'Ken Phillips', company: '130 BBQ', address: '130 Smith Street, Peekskill, NY 10566', phone: '(914) 555-0102', email: 'ken@130bbq.com', status: 'active' },
      { name: 'Cynthia Ferral', address: '11 Piping Brook Lane, Bedford, NY 10506', phone: '(347) 776-1419', email: 'cynthiaferral@gmail.com', status: 'lead' },
      { name: 'Christina Eckhart', address: '7 East Willow Street, Beacon, NY 12508', phone: '(423) 740-1778', email: '', status: 'active' },
      { name: 'Marlene Colangelo', address: '25 Oak Drive, Peekskill, NY 10566', phone: '(914) 555-0199', email: 'marlene@email.com', status: 'active' },
      { name: 'George Grant', address: '44 Maple Ave, Cortlandt Manor, NY 10567', phone: '(914) 555-0177', email: 'george@email.com', status: 'active' }
    ];
    demoClients.forEach(function(c) { clients.create(c); });

    // Demo jobs
    var clientList = clients.getAll();
    jobs.create({ clientId: clientList[3].id, clientName: 'Christina Eckhart', property: '7 East Willow Street, Beacon, NY 12508', jobNumber: 312, scheduledDate: '2026-03-16', status: 'late', total: 2500, description: 'Tree removal', crew: ['Doug Brown', 'Catherine Conway', 'Ryan Knapp'] });
    jobs.create({ clientId: clientList[0].id, clientName: 'Brian Heermance', property: '7 Lynwood Court, Cortlandt Manor, NY 10567', jobNumber: 315, scheduledDate: '2026-03-22', status: 'scheduled', total: 1800, description: 'Pruning - 3 oaks', crew: ['Doug Brown'] });

    // Demo invoices
    invoices.create({ clientId: clientList[4].id, clientName: 'Marlene Colangelo', invoiceNumber: 377, subject: 'For Services Rendered', total: 108, balance: 108, status: 'sent', dueDate: '2026-03-25' });
    invoices.create({ clientId: clientList[5].id, clientName: 'George Grant', invoiceNumber: 378, subject: 'For Services Rendered', total: 46, balance: 46, status: 'sent', dueDate: '2026-03-28' });
    invoices.create({ clientId: clientList[1].id, clientName: 'Ken Phillips', invoiceNumber: 376, subject: 'For Services Rendered', total: 216.75, balance: 0, status: 'paid', paidDate: '2026-03-13' });

    // Demo requests
    requests.create({ clientId: clientList[0].id, clientName: 'Brian Heermance', property: '7 Lynwood Court, Cortlandt Manor, NY 10567', phone: '(646) 228-4455', email: 'bpwh1@outlook.com', status: 'new', source: 'Google Search', notes: '' });
    requests.create({ clientId: clientList[2].id, clientName: 'Cynthia Ferral', property: '11 Piping Brook Lane, Bedford, NY 10506', phone: '(347) 776-1419', email: 'cynthiaferral@gmail.com', status: 'new', source: 'Facebook', notes: '' });
  }

  return {
    clients: clients,
    requests: requests,
    quotes: quotes,
    jobs: jobs,
    invoices: invoices,
    services: services,
    expenses: expenses,
    timeEntries: timeEntries,
    dashboard: dashboard,
    importCSV: importCSV,
    seedDemo: seedDemo,
    KEYS: KEYS,
    auditLog: {
      getRecent: function(n) { try { var log = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]'); return n ? log.slice(0, n) : log; } catch(e) { return []; } },
      clear: function() { localStorage.removeItem(AUDIT_KEY); },
      getAll: function() { return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]'); }
    },
    getAll: getAll,
    getById: getById,
    create: create,
    update: update,
    remove: remove
  };
})();

// Auto-seed demo data on first load
DB.seedDemo();
