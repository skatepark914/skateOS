/**
 * Branch Manager — Tasks & Reminders
 * Time-based task/errand system with browser notifications
 * Integrates with Team Chat channels (Errands, Maintenance)
 */
var TaskReminders = {
  _filter: 'all',
  _editing: null,
  _timerStarted: false,

  STORAGE_KEY: 'bm-tasks',

  PRIORITIES: [
    { key: 'low', label: 'Low', color: '#6c757d', bg: '#f8f9fa' },
    { key: 'medium', label: 'Medium', color: '#0d6efd', bg: '#e7f1ff' },
    { key: 'high', label: 'High', color: '#e65100', bg: '#fff3e0' },
    { key: 'urgent', label: 'Urgent', color: '#c62828', bg: '#ffebee' }
  ],

  CATEGORIES: [
    { key: 'errand', label: 'Errand', icon: '\uD83C\uDFC3' },
    { key: 'maintenance', label: 'Maintenance', icon: '\uD83D\uDD27' },
    { key: 'prep', label: 'Prep', icon: '\uD83D\uDCE6' },
    { key: 'cleanup', label: 'Cleanup', icon: '\uD83E\uDDF9' }
  ],

  RECURRENCE: [
    { key: 'none', label: 'One-time' },
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' }
  ],

  render: function() {
    // Start reminder checker on first render
    TaskReminders._startChecker();
    // Request notification permission
    TaskReminders._requestNotificationPermission();

    var tasks = TaskReminders._getAll();
    var filtered = TaskReminders._applyFilter(tasks);
    var now = new Date();

    // Stats
    var overdue = tasks.filter(function(t) { return !t.completed && t.dueDate && new Date(t.dueDate) < now; }).length;
    var dueToday = tasks.filter(function(t) {
      if (t.completed || !t.dueDate) return false;
      var d = new Date(t.dueDate);
      return d.toDateString() === now.toDateString();
    }).length;
    var active = tasks.filter(function(t) { return !t.completed; }).length;
    var completedCount = tasks.filter(function(t) { return t.completed; }).length;

    var html = '';

    // Stats row
    html += '<div class="stat-grid">'
      + TaskReminders._statCard('Active', active, 'open tasks', '')
      + TaskReminders._statCard('Due Today', dueToday, 'tasks today', '')
      + TaskReminders._statCard('Overdue', overdue, 'past due', overdue > 0 ? '#c62828' : '')
      + TaskReminders._statCard('Completed', completedCount, 'finished', '#2e7d32')
      + '</div>';

    // Action bar
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">';

    // Filter buttons
    var filters = [
      { key: 'all', label: 'All' },
      { key: 'today', label: 'Today' },
      { key: 'overdue', label: 'Overdue' },
      { key: 'mine', label: 'Mine' },
      { key: 'completed', label: 'Done' }
    ];
    html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
    filters.forEach(function(f) {
      var isActive = TaskReminders._filter === f.key;
      html += '<button onclick="TaskReminders._filter=\'' + f.key + '\';loadPage(\'taskreminders\')" '
        + 'style="padding:8px 16px;border-radius:8px;border:' + (isActive ? '2px solid var(--green-dark)' : '1px solid var(--border)') + ';'
        + 'background:' + (isActive ? 'var(--green-dark)' : 'var(--white)') + ';'
        + 'color:' + (isActive ? '#fff' : 'var(--text)') + ';font-size:14px;font-weight:' + (isActive ? '700' : '500') + ';cursor:pointer;">'
        + f.label + '</button>';
    });
    html += '</div>';

    // New task button
    html += '<button onclick="TaskReminders._showForm()" style="background:var(--green-dark);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">+ New Task</button>';
    html += '</div>';

    // Task form (hidden by default, shown on + New Task or edit)
    html += '<div id="task-form-wrapper" style="display:none;margin-bottom:16px;">' + TaskReminders._renderForm() + '</div>';

    // Task list
    if (filtered.length === 0) {
      html += '<div style="text-align:center;padding:60px 20px;color:var(--text-light);">'
        + '<div style="font-size:40px;margin-bottom:12px;">\u2705</div>'
        + '<div style="font-size:16px;font-weight:600;">No tasks here</div>'
        + '<div style="font-size:14px;margin-top:4px;">Create a task to get started</div></div>';
    } else {
      // Sort: overdue first, then by due date, completed last
      filtered.sort(function(a, b) {
        if (a.completed && !b.completed) return 1;
        if (!a.completed && b.completed) return -1;
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        var aDate = new Date(a.dueDate);
        var bDate = new Date(b.dueDate);
        var aOverdue = !a.completed && aDate < now;
        var bOverdue = !b.completed && bDate < now;
        if (aOverdue && !bOverdue) return -1;
        if (!aOverdue && bOverdue) return 1;
        return aDate - bDate;
      });

      filtered.forEach(function(task) {
        html += TaskReminders._renderCard(task, now);
      });
    }

    return html;
  },

  _statCard: function(label, value, sub, color) {
    return '<div style="background:var(--white);border-radius:12px;padding:16px;border:1px solid var(--border);text-align:center;">'
      + '<div style="font-size:24px;font-weight:800;' + (color ? 'color:' + color + ';' : '') + '">' + value + '</div>'
      + '<div style="font-size:14px;font-weight:600;margin-top:2px;">' + label + '</div>'
      + '<div style="font-size:12px;color:var(--text-light);">' + sub + '</div></div>';
  },

  _renderCard: function(task, now) {
    var isOverdue = !task.completed && task.dueDate && new Date(task.dueDate) < now;
    var pri = TaskReminders.PRIORITIES.find(function(p) { return p.key === task.priority; }) || TaskReminders.PRIORITIES[0];
    var cat = TaskReminders.CATEGORIES.find(function(c) { return c.key === task.category; }) || TaskReminders.CATEGORIES[0];
    var recur = TaskReminders.RECURRENCE.find(function(r) { return r.key === task.recurrence; });

    var borderColor = isOverdue ? '#c62828' : (task.completed ? '#ccc' : 'var(--border)');
    var bgColor = isOverdue ? '#fff5f5' : (task.completed ? '#fafafa' : 'var(--white)');

    var html = '<div onclick="TaskReminders._editTask(\'' + task.id + '\')" style="background:' + bgColor + ';border-radius:12px;padding:16px;border:2px solid ' + borderColor + ';margin-bottom:8px;cursor:pointer;'
      + (task.completed ? 'opacity:0.7;' : '') + 'transition:box-shadow 0.2s;" onmouseover="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,0.08)\'" onmouseout="this.style.boxShadow=\'none\'">';

    // Top row: checkbox, title, priority badge
    html += '<div style="display:flex;align-items:flex-start;gap:12px;">';

    // Checkbox
    html += '<button onclick="event.stopPropagation();TaskReminders._toggleComplete(\'' + task.id + '\')" '
      + 'style="width:28px;height:28px;border-radius:50%;border:2px solid ' + (task.completed ? 'var(--green-dark)' : 'var(--border)') + ';'
      + 'background:' + (task.completed ? 'var(--green-dark)' : 'transparent') + ';color:#fff;font-size:14px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;">'
      + (task.completed ? '\u2713' : '') + '</button>';

    // Title + description
    html += '<div style="flex:1;min-width:0;">'
      + '<div style="font-size:15px;font-weight:700;' + (task.completed ? 'text-decoration:line-through;color:var(--text-light);' : '') + '">' + UI.esc(task.title) + '</div>';
    if (task.description) {
      html += '<div style="font-size:13px;color:var(--text-light);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + UI.esc(task.description) + '</div>';
    }

    // Meta row: assigned, due, category, recurrence
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center;">';

    // Category tag
    html += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--bg);color:var(--text-light);">'
      + cat.icon + ' ' + cat.label + '</span>';

    // Assigned
    if (task.assignedTo) {
      html += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:#e3f2fd;color:#1565c0;">\uD83D\uDC64 ' + UI.esc(task.assignedTo) + '</span>';
    }

    // Due date
    if (task.dueDate) {
      var dueStr = TaskReminders._formatDue(task.dueDate, now);
      html += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + (isOverdue ? '#ffebee' : '#f3e5f5') + ';color:' + (isOverdue ? '#c62828' : '#7b1fa2') + ';">'
        + '\uD83D\uDD52 ' + dueStr + '</span>';
    }

    // Recurrence
    if (task.recurrence && task.recurrence !== 'none') {
      html += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:#e8f5e9;color:#2e7d32;">\uD83D\uDD01 ' + recur.label + '</span>';
    }

    html += '</div>'; // meta row
    html += '</div>'; // title block

    // Priority badge
    html += '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:' + pri.bg + ';color:' + pri.color + ';white-space:nowrap;">' + pri.label + '</span>';

    html += '</div>'; // top row

    // Completed timestamp
    if (task.completed && task.completedAt) {
      html += '<div style="font-size:11px;color:var(--text-light);margin-top:8px;margin-left:40px;">Completed ' + TaskReminders._formatDue(task.completedAt, now) + '</div>';
    }

    html += '</div>'; // card
    return html;
  },

  _renderForm: function() {
    var task = TaskReminders._editing ? TaskReminders._getById(TaskReminders._editing) : null;
    var team = TaskReminders._getTeamMembers();
    var isEdit = !!task;

    var nowLocal = new Date();
    nowLocal.setMinutes(nowLocal.getMinutes() + 30);
    var defaultDate = nowLocal.toISOString().slice(0, 16);

    var html = '<div style="background:var(--white);border-radius:12px;padding:20px;border:1px solid var(--border);">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<h3 style="font-size:16px;margin:0;">' + (isEdit ? 'Edit Task' : 'New Task') + '</h3>'
      + '<button onclick="TaskReminders._hideForm()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-light);">\u2715</button>'
      + '</div>';

    // Title
    html += '<div style="margin-bottom:12px;">'
      + '<label style="font-size:12px;color:var(--text-light);display:block;margin-bottom:4px;">Title *</label>'
      + '<input type="text" id="task-title" value="' + (task ? UI.esc(task.title) : '') + '" placeholder="e.g. Pick up chainsaw chains" '
      + 'style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:15px;box-sizing:border-box;"></div>';

    // Description
    html += '<div style="margin-bottom:12px;">'
      + '<label style="font-size:12px;color:var(--text-light);display:block;margin-bottom:4px;">Description</label>'
      + '<textarea id="task-desc" rows="2" placeholder="Additional details..." '
      + 'style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box;">' + (task ? UI.esc(task.description || '') : '') + '</textarea></div>';

    // Row: assigned, due date
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">';

    // Assigned to
    html += '<div><label style="font-size:12px;color:var(--text-light);display:block;margin-bottom:4px;">Assigned To</label>'
      + '<select id="task-assigned" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;">'
      + '<option value="">Unassigned</option>';
    team.forEach(function(name) {
      var sel = task && task.assignedTo === name ? ' selected' : '';
      html += '<option value="' + UI.esc(name) + '"' + sel + '>' + UI.esc(name) + '</option>';
    });
    html += '</select></div>';

    // Due date/time
    html += '<div><label style="font-size:12px;color:var(--text-light);display:block;margin-bottom:4px;">Due Date / Time</label>'
      + '<input type="datetime-local" id="task-due" value="' + (task && task.dueDate ? task.dueDate.slice(0, 16) : defaultDate) + '" '
      + 'style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;"></div>';
    html += '</div>';

    // Row: priority, category, recurrence
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">';

    // Priority
    html += '<div><label style="font-size:12px;color:var(--text-light);display:block;margin-bottom:4px;">Priority</label>'
      + '<select id="task-priority" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;">';
    TaskReminders.PRIORITIES.forEach(function(p) {
      var sel = task && task.priority === p.key ? ' selected' : '';
      html += '<option value="' + p.key + '"' + sel + '>' + p.label + '</option>';
    });
    html += '</select></div>';

    // Category
    html += '<div><label style="font-size:12px;color:var(--text-light);display:block;margin-bottom:4px;">Category</label>'
      + '<select id="task-category" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;">';
    TaskReminders.CATEGORIES.forEach(function(c) {
      var sel = task && task.category === c.key ? ' selected' : '';
      html += '<option value="' + c.key + '"' + sel + '>' + c.icon + ' ' + c.label + '</option>';
    });
    html += '</select></div>';

    // Recurrence
    html += '<div><label style="font-size:12px;color:var(--text-light);display:block;margin-bottom:4px;">Repeat</label>'
      + '<select id="task-recurrence" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:8px;font-size:14px;">';
    TaskReminders.RECURRENCE.forEach(function(r) {
      var sel = task && task.recurrence === r.key ? ' selected' : '';
      html += '<option value="' + r.key + '"' + sel + '>' + r.label + '</option>';
    });
    html += '</select></div>';
    html += '</div>';

    // Buttons
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
    if (isEdit) {
      html += '<button onclick="TaskReminders._deleteTask(\'' + task.id + '\')" style="background:#ffebee;color:#c62828;border:none;padding:10px 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;margin-right:auto;">Delete</button>';
    }
    html += '<button onclick="TaskReminders._hideForm()" style="background:var(--bg);color:var(--text);border:1px solid var(--border);padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">Cancel</button>';
    html += '<button onclick="TaskReminders._saveTask()" style="background:var(--green-dark);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">' + (isEdit ? 'Update' : 'Create Task') + '</button>';
    html += '</div></div>';

    return html;
  },

  // --- Form actions ---

  _showForm: function(taskId) {
    TaskReminders._editing = taskId || null;
    var wrapper = document.getElementById('task-form-wrapper');
    if (wrapper) {
      wrapper.innerHTML = TaskReminders._renderForm();
      wrapper.style.display = 'block';
      var titleInput = document.getElementById('task-title');
      if (titleInput) titleInput.focus();
    }
  },

  _hideForm: function() {
    TaskReminders._editing = null;
    var wrapper = document.getElementById('task-form-wrapper');
    if (wrapper) wrapper.style.display = 'none';
  },

  _editTask: function(id) {
    TaskReminders._showForm(id);
    // Scroll to form
    var wrapper = document.getElementById('task-form-wrapper');
    if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  _saveTask: function() {
    var title = (document.getElementById('task-title').value || '').trim();
    if (!title) { alert('Task title is required.'); return; }

    var desc = (document.getElementById('task-desc').value || '').trim();
    var assigned = document.getElementById('task-assigned').value;
    var due = document.getElementById('task-due').value;
    var priority = document.getElementById('task-priority').value;
    var category = document.getElementById('task-category').value;
    var recurrence = document.getElementById('task-recurrence').value;

    var tasks = TaskReminders._getAll();

    if (TaskReminders._editing) {
      // Update existing
      var idx = -1;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].id === TaskReminders._editing) { idx = i; break; }
      }
      if (idx >= 0) {
        tasks[idx].title = title;
        tasks[idx].description = desc;
        tasks[idx].assignedTo = assigned;
        tasks[idx].dueDate = due ? new Date(due).toISOString() : '';
        tasks[idx].priority = priority;
        tasks[idx].category = category;
        tasks[idx].recurrence = recurrence;
        tasks[idx].updatedAt = new Date().toISOString();
      }
    } else {
      // Create new
      tasks.push({
        id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        title: title,
        description: desc,
        assignedTo: assigned,
        dueDate: due ? new Date(due).toISOString() : '',
        priority: priority,
        category: category,
        recurrence: recurrence,
        completed: false,
        completedAt: null,
        notified: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    TaskReminders._saveAll(tasks);
    TaskReminders._editing = null;
    loadPage('taskreminders');
  },

  _toggleComplete: function(id) {
    var tasks = TaskReminders._getAll();
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) {
        if (!tasks[i].completed) {
          tasks[i].completed = true;
          tasks[i].completedAt = new Date().toISOString();

          // Handle recurring: spawn next occurrence
          if (tasks[i].recurrence && tasks[i].recurrence !== 'none' && tasks[i].dueDate) {
            var nextDue = TaskReminders._getNextOccurrence(tasks[i].dueDate, tasks[i].recurrence);
            tasks.push({
              id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
              title: tasks[i].title,
              description: tasks[i].description,
              assignedTo: tasks[i].assignedTo,
              dueDate: nextDue,
              priority: tasks[i].priority,
              category: tasks[i].category,
              recurrence: tasks[i].recurrence,
              completed: false,
              completedAt: null,
              notified: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          }
        } else {
          tasks[i].completed = false;
          tasks[i].completedAt = null;
        }
        break;
      }
    }
    TaskReminders._saveAll(tasks);
    loadPage('taskreminders');
  },

  _deleteTask: function(id) {
    if (!confirm('Delete this task?')) return;
    var tasks = TaskReminders._getAll().filter(function(t) { return t.id !== id; });
    TaskReminders._saveAll(tasks);
    TaskReminders._editing = null;
    loadPage('taskreminders');
  },

  // --- Recurring logic ---

  _getNextOccurrence: function(dateStr, recurrence) {
    var d = new Date(dateStr);
    switch (recurrence) {
      case 'daily': d.setDate(d.getDate() + 1); break;
      case 'weekly': d.setDate(d.getDate() + 7); break;
      case 'monthly': d.setMonth(d.getMonth() + 1); break;
    }
    return d.toISOString();
  },

  // --- Reminder checker ---

  _startChecker: function() {
    if (TaskReminders._timerStarted) return;
    TaskReminders._timerStarted = true;
    // Check immediately on load
    TaskReminders._checkReminders();
    // Then every 60 seconds
    setInterval(function() { TaskReminders._checkReminders(); }, 60000);
  },

  _checkReminders: function() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    var tasks = TaskReminders._getAll();
    var now = new Date();
    var fiveMin = 5 * 60 * 1000;
    var changed = false;

    tasks.forEach(function(task) {
      if (task.completed || task.notified || !task.dueDate) return;
      var due = new Date(task.dueDate);
      var diff = due.getTime() - now.getTime();

      // Fire notification if due within 5 minutes (and not already past by more than 5 min)
      if (diff <= fiveMin && diff > -fiveMin) {
        try {
          new Notification('Task Due: ' + task.title, {
            body: task.description || (task.assignedTo ? 'Assigned to ' + task.assignedTo : 'No description'),
            icon: 'icons/icon-192.png',
            tag: 'task-' + task.id
          });
        } catch (e) {
          // Notification may fail in some contexts
        }
        task.notified = true;
        changed = true;
      }
    });

    if (changed) TaskReminders._saveAll(tasks);
  },

  _requestNotificationPermission: function() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  },

  // --- Filters ---

  _applyFilter: function(tasks) {
    var now = new Date();
    var currentUser = TaskReminders._getCurrentUser();

    switch (TaskReminders._filter) {
      case 'today':
        return tasks.filter(function(t) {
          if (t.completed || !t.dueDate) return false;
          return new Date(t.dueDate).toDateString() === now.toDateString();
        });
      case 'overdue':
        return tasks.filter(function(t) {
          return !t.completed && t.dueDate && new Date(t.dueDate) < now;
        });
      case 'mine':
        return tasks.filter(function(t) {
          return !t.completed && (!t.assignedTo || t.assignedTo === currentUser);
        });
      case 'completed':
        return tasks.filter(function(t) { return t.completed; });
      default:
        // All: show incomplete + recently completed (last 24h)
        var dayAgo = new Date(now.getTime() - 86400000);
        return tasks.filter(function(t) {
          if (!t.completed) return true;
          return t.completedAt && new Date(t.completedAt) > dayAgo;
        });
    }
  },

  // --- Data helpers ---

  _getAll: function() {
    try {
      return JSON.parse(localStorage.getItem(TaskReminders.STORAGE_KEY) || '[]');
    } catch (e) { return []; }
  },

  _saveAll: function(tasks) {
    localStorage.setItem(TaskReminders.STORAGE_KEY, JSON.stringify(tasks));
  },

  _getById: function(id) {
    var tasks = TaskReminders._getAll();
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) return tasks[i];
    }
    return null;
  },

  _getCurrentUser: function() {
    return (typeof Auth !== 'undefined' && Auth.user) ? Auth.user.name : 'Owner';
  },

  _getTeamMembers: function() {
    var names = [];
    try {
      var team = JSON.parse(localStorage.getItem('bm-team') || '[]');
      team.forEach(function(t) { if (t.name) names.push(t.name); });
    } catch (e) {}
    var current = TaskReminders._getCurrentUser();
    if (names.indexOf(current) === -1) names.unshift(current);
    return names;
  },

  // --- Formatting ---

  _formatDue: function(dateStr, now) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (!now) now = new Date();

    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((target - today) / 86400000);

    var timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    if (diff === 0) return 'Today ' + timeStr;
    if (diff === 1) return 'Tomorrow ' + timeStr;
    if (diff === -1) return 'Yesterday ' + timeStr;
    if (diff > 1 && diff <= 6) return TaskReminders._dayName(d.getDay()) + ' ' + timeStr;

    // Fallback to short date
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + timeStr;
  },

  _dayName: function(idx) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][idx];
  },

  // --- Dashboard widget (call from dashboard) ---

  getDashboardWidget: function() {
    var tasks = TaskReminders._getAll();
    var now = new Date();
    var upcoming = tasks.filter(function(t) {
      if (t.completed) return false;
      if (!t.dueDate) return true;
      return new Date(t.dueDate).toDateString() === now.toDateString() || new Date(t.dueDate) < now;
    }).slice(0, 5);

    if (upcoming.length === 0) return '';

    var html = '<div style="background:var(--white);border-radius:12px;padding:16px;border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
      + '<h3 style="font-size:15px;margin:0;">Tasks Due</h3>'
      + '<a onclick="loadPage(\'taskreminders\')" style="font-size:13px;color:var(--green-dark);cursor:pointer;font-weight:600;">View All</a></div>';

    upcoming.forEach(function(task) {
      var isOverdue = task.dueDate && new Date(task.dueDate) < now;
      var pri = TaskReminders.PRIORITIES.find(function(p) { return p.key === task.priority; }) || TaskReminders.PRIORITIES[0];
      html += '<div onclick="loadPage(\'taskreminders\')" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bg);cursor:pointer;">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:' + (isOverdue ? '#c62828' : pri.color) + ';flex-shrink:0;"></div>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="font-size:14px;font-weight:600;' + (isOverdue ? 'color:#c62828;' : '') + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + UI.esc(task.title) + '</div>'
        + '<div style="font-size:12px;color:var(--text-light);">' + (task.dueDate ? TaskReminders._formatDue(task.dueDate, now) : 'No due date') + '</div>'
        + '</div></div>';
    });

    html += '</div>';
    return html;
  },

  // --- Team Chat integration ---

  postToChat: function(task, channel) {
    // Post task to team chat channel
    if (typeof TeamChat === 'undefined') return;
    var ch = channel || (task.category === 'maintenance' ? 'maintenance' : 'errands');
    var messages = [];
    try { messages = JSON.parse(localStorage.getItem('bm-chat-' + ch) || '[]'); } catch (e) {}
    messages.push({
      id: 'msg_' + Date.now(),
      author: TaskReminders._getCurrentUser(),
      text: 'New task assigned: ' + task.title + (task.assignedTo ? ' (' + task.assignedTo + ')' : '') + (task.dueDate ? ' - Due: ' + TaskReminders._formatDue(task.dueDate) : ''),
      task: task.title,
      timestamp: new Date().toISOString()
    });
    localStorage.setItem('bm-chat-' + ch, JSON.stringify(messages));
  }
};
