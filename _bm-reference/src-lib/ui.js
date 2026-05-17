/**
 * Branch Manager — UI Components
 * Reusable modal, form builder, table builder, status badges
 */
var UI = (function() {

  // ── Modal ──
  function showModal(title, content, options) {
    options = options || {};
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal' + (options.wide ? ' modal-wide' : '') + (options.full ? ' modal-full' : '') + '">'
      + '<div class="modal-header">'
      + '<h3>' + title + '</h3>'
      + '<button class="modal-close" onclick="UI.closeModal()">&times;</button>'
      + '</div>'
      + '<div class="modal-body">' + content + '</div>'
      + (options.footer ? '<div class="modal-footer">' + options.footer + '</div>' : '')
      + '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) UI.closeModal(); });

    // ESC key closes the modal
    var escHandler = function(e) { if (e.key === 'Escape') UI.closeModal(); };
    document.addEventListener('keydown', escHandler);
    overlay._escHandler = escHandler;

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('open'); });
    return overlay;
  }
  function closeModal() {
    var m = document.querySelector('.modal-overlay');
    if (m) {
      if (m._escHandler) document.removeEventListener('keydown', m._escHandler);
      m.classList.remove('open');
      setTimeout(function() { m.remove(); }, 200);
    }
  }

  // ── Status Badge ──
  function statusBadge(status) {
    var map = {
      active: 'status-active', lead: 'status-lead', new: 'status-new',
      scheduled: 'status-sent', late: 'status-late', completed: 'status-active',
      cancelled: 'status-draft', draft: 'status-draft', sent: 'status-sent',
      awaiting: 'status-sent', approved: 'status-active', declined: 'status-late',
      paid: 'status-paid', overdue: 'status-late', upcoming: 'status-sent'
    };
    return '<span class="status-badge ' + (map[status] || 'status-draft') + '">' + (status || '—') + '</span>';
  }

  // ── HTML Escaping (XSS protection) ──
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ── Format helpers ──
  function money(n) { return '$' + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function moneyInt(n) { return '$' + Math.round(n || 0).toLocaleString(); }
  function dateShort(d) {
    if (!d) return '—';
    var dt;
    // Handle ISO timestamps (from Supabase) and plain dates
    if (d.length > 10) {
      dt = new Date(d);
    } else {
      dt = new Date(d + 'T12:00:00');
    }
    if (isNaN(dt.getTime())) return '—';
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear();
  }
  function dateRelative(d) {
    if (!d) return '—';
    var now = new Date(); var dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    var diff = Math.floor((now - dt) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return diff + ' days ago';
    return dateShort(d);
  }
  function phone(p) {
    if (!p) return '—';
    var d = p.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.substr(1);
    if (d.length === 10) return '(' + d.substr(0,3) + ') ' + d.substr(3,3) + '-' + d.substr(6);
    return p;
  }

  // ── Form Builder ──
  function formField(label, type, id, value, options) {
    options = options || {};
    var html = '<div class="form-group">';
    html += '<label for="' + id + '">' + label + '</label>';
    if (type === 'textarea') {
      html += '<textarea id="' + id + '" rows="' + (options.rows || 3) + '" placeholder="' + esc(options.placeholder || '') + '">' + esc(value || '') + '</textarea>';
    } else if (type === 'select') {
      html += '<select id="' + id + '">';
      (options.options || []).forEach(function(o) {
        var val = typeof o === 'object' ? o.value : o;
        var label = typeof o === 'object' ? o.label : o;
        html += '<option value="' + val + '"' + (val === value ? ' selected' : '') + '>' + label + '</option>';
      });
      html += '</select>';
    } else {
      html += '<input type="' + type + '" id="' + id + '" value="' + esc(value || '') + '" placeholder="' + esc(options.placeholder || '') + '"' + (options.required ? ' required' : '') + '>';
    }
    html += '</div>';
    return html;
  }

  // ── Stat Card ──
  function statCard(label, value, sub, trend, trendText, onclick) {
    return '<div class="stat-card"' + (onclick ? ' onclick="' + onclick + '" style="cursor:pointer;"' : '') + '>'
      + '<div class="stat-label">' + label + '</div>'
      + '<div class="stat-value">' + value + '</div>'
      + (sub ? '<div class="stat-sub">' + sub + (trendText ? ' <span class="stat-trend ' + trend + '">' + trendText + '</span>' : '') + '</div>' : '')
      + '</div>';
  }

  // ── Empty State ──
  function emptyState(icon, title, desc, actionText, actionFn) {
    return '<div class="empty-state">'
      + '<div class="empty-icon">' + icon + '</div>'
      + '<h3>' + title + '</h3>'
      + '<p>' + desc + '</p>'
      + (actionText ? '<button class="btn btn-primary" style="margin-top:16px;" onclick="' + actionFn + '">' + actionText + '</button>' : '')
      + '</div>';
  }

  // ── Confirm Dialog ──
  function confirm(message, onYes, onNo) {
    window._uiConfirmYes = onYes;
    window._uiConfirmNo = onNo;
    showModal('Confirm', '<p style="font-size:15px;margin-bottom:16px;">' + message + '</p>',
      { footer: '<button class="btn btn-outline" onclick="UI.closeModal();if(window._uiConfirmNo)window._uiConfirmNo();">Cancel</button> <button class="btn btn-primary" onclick="UI.closeModal();if(window._uiConfirmYes)window._uiConfirmYes();">Yes, Continue</button>' });
  }

  // ── Toast / Notification ──
  function toast(message, type) {
    type = type || 'success';
    var t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = message;
    document.body.appendChild(t);
    requestAnimationFrame(function() { t.classList.add('show'); });
    setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 300); }, 3000);
  }

  // ── Loading Spinner ──
  function showLoading(text) {
    var el = document.getElementById('pageContent');
    if (el) el.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px;gap:16px;">'
      + '<div style="width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;"></div>'
      + '<span style="font-size:14px;color:var(--text-light);">' + (text || 'Loading...') + '</span></div>';
  }

  // ── Validate Required Fields ──
  function validateForm(fields) {
    var errors = [];
    fields.forEach(function(f) {
      var el = document.getElementById(f.id);
      if (!el) return;
      var val = el.value.trim();
      if (f.required && !val) {
        errors.push(f.label + ' is required');
        el.style.borderColor = '#e53e3e';
        el.style.background = '#fff5f5';
      } else if (f.type === 'email' && val && !/\S+@\S+\.\S+/.test(val)) {
        errors.push(f.label + ' must be a valid email');
        el.style.borderColor = '#e53e3e';
      } else if (f.type === 'phone' && val && val.replace(/\D/g,'').length < 10) {
        errors.push(f.label + ' must be a valid phone number');
        el.style.borderColor = '#e53e3e';
      } else {
        el.style.borderColor = '';
        el.style.background = '';
      }
    });
    if (errors.length) {
      toast(errors[0], 'error');
      return false;
    }
    return true;
  }

  // ── Time Ago (short) ──
  function timeAgo(d) {
    if (!d) return '';
    var s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    if (s < 604800) return Math.floor(s/86400) + 'd ago';
    return dateShort(d.split('T')[0]);
  }

  return {
    showModal: showModal,
    closeModal: closeModal,
    statusBadge: statusBadge,
    money: money,
    moneyInt: moneyInt,
    dateShort: dateShort,
    dateRelative: dateRelative,
    timeAgo: timeAgo,
    phone: phone,
    formField: formField,
    statCard: statCard,
    emptyState: emptyState,
    confirm: confirm,
    toast: toast,
    showLoading: showLoading,
    validateForm: validateForm,
    esc: esc
  };
})();
