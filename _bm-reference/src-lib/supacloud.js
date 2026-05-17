/**
 * Branch Manager — Supabase Cloud Data Layer
 * Caches Supabase data locally for fast reads, syncs writes to cloud
 * This bridges the gap: app uses synchronous DB calls, cloud is async
 *
 * Strategy: On init, pull all data from Supabase into localStorage cache.
 * Reads come from cache (fast, synchronous). Writes go to both cache + cloud.
 */
var CloudSync = {
  tables: ['clients', 'requests', 'quotes', 'jobs', 'invoices', 'services', 'expenses', 'time_entries'],
  syncing: false,
  lastSync: 0,

  init: async function() {
    if (!SupabaseDB || !SupabaseDB.ready) return;
    CloudSync.syncing = true;

    var sb = SupabaseDB.client;
    var totalRows = 0;

    for (var i = 0; i < CloudSync.tables.length; i++) {
      var table = CloudSync.tables[i];
      var localKey = 'bm-' + table.replace(/_/g, '-');

      try {
        // Pull all rows from Supabase
        // Paginate: fetch up to 5000 rows in batches of 1000
        var allData = [];
        var page = 0;
        var hasMore = true;
        while (hasMore && page < 5) {
          var { data: batch, error } = await sb.from(table).select('*').order('created_at', { ascending: false }).range(page * 1000, (page + 1) * 1000 - 1);
          if (error) break;
          if (batch && batch.length > 0) { allData = allData.concat(batch); page++; }
          if (!batch || batch.length < 1000) hasMore = false;
        }
        var data = allData;
        if (error) {
          // Table doesn't exist in Supabase yet — remove from sync list silently
          if (error.message && error.message.includes('schema cache')) {
            CloudSync.tables = CloudSync.tables.filter(function(t) { return t !== table; });
          } else {
            console.warn('CloudSync: error fetching ' + table + ':', error.message);
          }
          continue;
        }

        if (data && data.length > 0) {
          // Convert snake_case to camelCase for app compatibility
          var converted = data.map(function(row) {
            var newRow = {};
            Object.keys(row).forEach(function(key) {
              var camelKey = key.replace(/_([a-z])/g, function(m, p1) { return p1.toUpperCase(); });
              newRow[camelKey] = row[key];
            });
            return newRow;
          });

          localStorage.setItem(localKey, JSON.stringify(converted));
          totalRows += converted.length;
          if (typeof SupabaseDB !== 'undefined' && SupabaseDB._debug) console.log('CloudSync: loaded ' + converted.length + ' ' + table);
        }
      } catch (e) {
        console.warn('CloudSync: failed ' + table + ':', e);
      }
    }

    CloudSync.syncing = false;
    CloudSync.lastSync = Date.now();
    if (typeof SupabaseDB !== 'undefined' && SupabaseDB._debug) console.log('CloudSync: done — ' + totalRows + ' total rows cached');

    // Refresh page if we loaded new data
    if (totalRows > 0 && typeof loadPage === 'function') {
      loadPage('dashboard');
    }
  },

  // Override DB write methods to also push to Supabase
  wrapWrites: function() {
    if (!SupabaseDB || !SupabaseDB.ready) return;
    var sb = SupabaseDB.client;

    CloudSync.tables.forEach(function(table) {
      var localKey = 'bm-' + table.replace(/_/g, '-');
      var dbSection = table === 'time_entries' ? DB.timeEntries : DB[table];
      if (!dbSection) return;

      var origCreate = dbSection.create;
      var origUpdate = dbSection.update;
      var origRemove = dbSection.remove;

      // Wrap create — pre-assign UUID so local + cloud IDs always match
      dbSection.create = function(record) {
        // Inject UUID before local create so both sides use the same ID
        if (!record.id || record.id.indexOf('-') === -1) {
          record.id = CloudSync._uuid();
        }
        var result = origCreate.call(dbSection, record);
        var cloudRecord = CloudSync._toSnake(result);
        // ID is already a UUID — no need to overwrite
        sb.from(table).insert(cloudRecord).then(function(res) {
          if (res.error) {
            console.warn('Cloud create error (' + table + '):', res.error.message);
            CloudSync._markUnsynced();
          }
        }).catch(function() { CloudSync._markUnsynced(); });
        return result;
      };

      // Wrap update — find record in local cache and update cloud by same ID
      if (origUpdate) {
        dbSection.update = function(id, changes) {
          var result = origUpdate.call(dbSection, id, changes);
          var cloudChanges = CloudSync._toSnake(changes);
          cloudChanges.updated_at = new Date().toISOString();
          var all = JSON.parse(localStorage.getItem(localKey) || '[]');
          var record = all.find(function(r) { return r.id === id; });
          if (record && record.id) {
            sb.from(table).update(cloudChanges).eq('id', record.id).then(function(res) {
              if (res.error) { console.warn('Cloud update error (' + table + '):', res.error.message); CloudSync._markUnsynced(); }
            }).catch(function() { CloudSync._markUnsynced(); });
          }
          return result;
        };
      }

      // Wrap remove — delete from cloud when deleted locally
      if (origRemove) {
        dbSection.remove = function(id) {
          var result = origRemove.call(dbSection, id);
          sb.from(table).delete().eq('id', id).then(function(res) {
            if (res.error) { console.warn('Cloud delete error (' + table + '):', res.error.message); CloudSync._markUnsynced(); }
          }).catch(function() { CloudSync._markUnsynced(); });
          return result;
        };
      }
    });

    if (typeof SupabaseDB !== 'undefined' && SupabaseDB._debug) console.log('CloudSync: write methods wrapped');
  },

  // Show unsynced indicator in topbar
  _markUnsynced: function() {
    var el = document.getElementById('sync-indicator');
    if (!el) {
      var topbar = document.querySelector('.topbar-actions');
      if (topbar) {
        var indicator = document.createElement('span');
        indicator.id = 'sync-indicator';
        indicator.title = 'Some changes not synced to cloud';
        indicator.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#f59e0b;display:inline-block;margin-right:4px;animation:pulse 2s infinite;';
        topbar.insertBefore(indicator, topbar.firstChild);
      }
    }
  },

  _clearUnsynced: function() {
    var el = document.getElementById('sync-indicator');
    if (el) el.remove();
  },

  // Convert camelCase object to snake_case
  _toSnake: function(obj) {
    var result = {};
    Object.keys(obj).forEach(function(key) {
      var snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      result[snakeKey] = obj[key];
    });
    return result;
  },

  _uuid: function() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },

  // Manual refresh
  refresh: async function() {
    UI.toast('Syncing with cloud...');
    await CloudSync.init();
    UI.toast('Data refreshed from cloud!');
  }
};

// Auto-init after Supabase connects — retry until connected
(function waitForSupabase(attempts) {
  if (SupabaseDB && SupabaseDB.ready) {
    // Check if we need to sync (no local data or stale)
    var localClients = localStorage.getItem('bm-clients');
    var hasLocal = localClients && JSON.parse(localClients).length > 0;
    if (!hasLocal || (Date.now() - CloudSync.lastSync > 3600000)) {
      CloudSync.init().then(function() { CloudSync.wrapWrites(); });
    } else {
      CloudSync.wrapWrites();
      if (typeof SupabaseDB !== 'undefined' && SupabaseDB._debug) console.log('CloudSync: using cached data (' + JSON.parse(localClients).length + ' clients)');
    }
  } else if (attempts > 0) {
    setTimeout(function() { waitForSupabase(attempts - 1); }, 1000);
  }
})(15); // Try for 15 seconds
