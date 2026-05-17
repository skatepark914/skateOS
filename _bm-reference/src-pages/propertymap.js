/**
 * Branch Manager — Property Map
 * Satellite view with draggable equipment placement for quotes/jobs
 * Uses MapLibre GL + ESRI satellite tiles (free)
 */
var PropertyMap = {
  render: function() {
    var jobs = DB.jobs.getAll().filter(function(j) { return j.property || j.clientName; });
    jobs.sort(function(a, b) { return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0); });

    var html = '<div style="max-width:800px;">'
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:20px;">'
      + '<div style="font-weight:700;font-size:15px;margin-bottom:8px;">🗺 Property Map</div>'
      + '<div style="font-size:13px;color:var(--text-light);margin-bottom:14px;line-height:1.6;">Open a satellite map for any address and drag equipment icons (bucket truck, chipper, crane, crew) to plan job logistics. Save the layout with a quote or job.</div>'
      + '<div style="display:flex;gap:8px;">'
      + '<input type="text" id="propmap-address-input" placeholder="Enter any address to open map..." style="flex:1;padding:10px 14px;border:2px solid var(--border);border-radius:8px;font-size:14px;" onkeydown="if(event.key===\'Enter\')PropertyMap._openFromInput();">'
      + '<button class="btn btn-primary" onclick="PropertyMap._openFromInput()">Open Map</button>'
      + '</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">';

    PropertyMap.equipmentList.forEach(function(eq) {
      html += '<div style="font-size:11px;padding:4px 10px;background:' + eq.color + '22;color:' + eq.color + ';border-radius:12px;font-weight:600;border:1px solid ' + eq.color + '44;">' + eq.label + '</div>';
    });
    html += '</div></div>';

    // Recent jobs
    if (jobs.length) {
      html += '<div style="font-weight:700;font-size:13px;margin-bottom:10px;">Recent Jobs</div>';
      jobs.slice(0, 30).forEach(function(j) {
        var address = j.property || '';
        var hasSavedMap = j.mapMarkers && j.mapMarkers.length > 0;
        html += '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:12px;">'
          + '<div style="min-width:0;">'
          + '<div style="font-weight:600;font-size:14px;">' + UI.esc(j.clientName || '') + (j.jobNumber ? ' · Job #' + j.jobNumber : '') + '</div>'
          + '<div style="font-size:12px;color:var(--text-light);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + UI.esc(address || 'No address') + '</div>'
          + '</div>'
          + '<div style="display:flex;gap:6px;flex-shrink:0;">'
          + (hasSavedMap ? '<span style="font-size:11px;color:var(--green-dark);padding:3px 8px;background:#e8f5e9;border-radius:10px;font-weight:600;">📍 Saved</span>' : '')
          + (address ? '<button onclick="PropertyMap.show(\'' + address.replace(/'/g, "\\'") + '\',' + (hasSavedMap ? 'DB.jobs.getById(\'' + j.id + '\').mapMarkers' : 'null') + ');" style="background:var(--accent);color:#fff;border:none;padding:7px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Open Map</button>' : '')
          + '</div></div>';
      });
    } else {
      html += '<div class="empty-state"><div class="empty-icon">🗺</div><h3>No jobs yet</h3><p>Property maps open per job. Start by entering an address above or opening a job.</p></div>';
    }

    html += '</div>';
    return html;
  },

  _openFromInput: function() {
    var input = document.getElementById('propmap-address-input');
    var address = input ? input.value.trim() : '';
    if (!address) { UI.toast('Enter an address first', 'error'); return; }
    PropertyMap.show(address, null);
  },

  map: null,
  markers: [],
  // Equipment with relative dimensions (w x h in feet) for scaled rectangles on map
  equipmentList: [
    { id: 'bucket', label: 'Bucket Truck', color: '#2196f3', w: 35, h: 10 },
    { id: 'chipper', label: 'Chipper', color: '#4caf50', w: 14, h: 6 },
    { id: 'crane', label: 'Crane', color: '#ff9800', w: 50, h: 12 },
    { id: 'truck', label: 'Chip Truck', color: '#607d8b', w: 28, h: 9 },
    { id: 'ram', label: 'Ram 2500', color: '#9c27b0', w: 20, h: 7 },
    { id: 'loader', label: 'Loader', color: '#e91e63', w: 18, h: 8 },
    { id: 'trailer', label: 'Trailer', color: '#78909c', w: 22, h: 8 },
    { id: 'climber', label: 'Climber', color: '#f44336', w: 4, h: 4 },
    { id: 'ground', label: 'Ground Crew', color: '#00bcd4', w: 4, h: 4 },
    { id: 'dropzone', label: 'Drop Zone', color: '#ff5722', w: 30, h: 30 },
    { id: 'hazard', label: 'Hazard', color: '#f44336', w: 6, h: 6 },
    { id: 'powerline', label: 'Power Lines', color: '#ffc107', w: 4, h: 40 }
  ],

  show: function(address, existingMarkers) {
    // Load MapLibre if not already loaded
    if (!window.maplibregl) {
      var link = document.createElement('link');
      link.href = 'https://unpkg.com/maplibre-gl@4.1.2/dist/maplibre-gl.css';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
      var script = document.createElement('script');
      script.src = 'https://unpkg.com/maplibre-gl@4.1.2/dist/maplibre-gl.js';
      script.onload = function() { PropertyMap._init(address, existingMarkers); };
      document.head.appendChild(script);
    } else {
      PropertyMap._init(address, existingMarkers);
    }
  },

  _init: function(address, existingMarkers) {
    var self = PropertyMap;
    var isMobile = window.innerWidth < 768;

    // ── Build equipment buttons (shared between mobile and desktop) ──
    var eqButtons = '';
    self.equipmentList.forEach(function(eq) {
      var pw = Math.max(Math.round(eq.w * 0.8), 8);
      var ph = Math.max(Math.round(eq.h * 0.8), 6);
      if (isMobile) {
        // Mobile: compact grid buttons
        eqButtons += '<button type="button" style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--white);border:1px solid var(--border);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;" '
          + 'onclick="PropertyMap.addEquipment(\'' + eq.id + '\')">'
          + '<span style="display:inline-block;width:' + pw + 'px;height:' + ph + 'px;background:' + eq.color + ';border-radius:2px;flex-shrink:0;"></span>'
          + eq.label + '</button>';
      } else {
        // Desktop: vertical list
        eqButtons += '<button class="btn btn-outline" style="width:100%;margin-bottom:6px;font-size:11px;padding:6px 8px;display:flex;align-items:center;gap:8px;" '
          + 'onclick="PropertyMap.addEquipment(\'' + eq.id + '\')">'
          + '<span style="display:inline-block;width:' + pw + 'px;height:' + ph + 'px;background:' + eq.color + ';border-radius:2px;flex-shrink:0;opacity:.85;"></span>'
          + eq.label + '</button>';
      }
    });

    var html;
    if (isMobile) {
      // ── MOBILE: Full page layout with bottom equipment drawer ──
      html = '<div id="propmap-fullpage" style="position:fixed;inset:0;z-index:9999;background:var(--white);display:flex;flex-direction:column;">'
        // Top bar
        + '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--white);border-bottom:1px solid var(--border);z-index:10;">'
        + '<button onclick="PropertyMap.closeMobile()" style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px;">✕</button>'
        + '<input type="text" id="map-address" value="' + (address || '') + '" placeholder="Enter address..." style="flex:1;padding:8px 10px;border:2px solid var(--border);border-radius:8px;font-size:14px;font-weight:600;">'
        + '<button class="btn btn-primary" style="padding:6px 12px;font-size:13px;" onclick="PropertyMap.geocode()">Go</button>'
        + '</div>'
        // Map (fills available space)
        + '<div style="flex:1;position:relative;">'
        + '<div id="prop-map" style="width:100%;height:100%;"></div>'
        // Placed count badge
        + '<div id="placed-count" style="position:absolute;top:10px;right:10px;background:var(--accent);color:#fff;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;display:none;">0 placed</div>'
        + '</div>'
        // Equipment drawer (bottom, scrollable horizontal)
        + '<div style="background:var(--bg);border-top:1px solid var(--border);padding:10px 12px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
        + '<span style="font-size:12px;font-weight:700;">Tap to place equipment</span>'
        + '<button class="btn btn-outline" style="font-size:11px;padding:4px 8px;" onclick="PropertyMap.clearMarkers()">Clear</button>'
        + '</div>'
        + '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;">'
        + eqButtons
        + '</div>'
        + '</div>'
        // Bottom action bar
        + '<div style="padding:10px 12px;background:var(--white);border-top:1px solid var(--border);display:flex;gap:8px;">'
        + '<button class="btn btn-outline" style="flex:1;" onclick="PropertyMap.closeMobile()">Cancel</button>'
        + '<button class="btn btn-primary" style="flex:1;" onclick="PropertyMap.saveToRecord();PropertyMap.closeMobile();">Save to Quote</button>'
        + '</div>'
        + '</div>';

      // Inject into body (not a modal)
      var container = document.createElement('div');
      container.id = 'propmap-container';
      container.innerHTML = html;
      document.body.appendChild(container);
    } else {
      // ── DESKTOP: Side-by-side in modal ──
      html = '<div style="display:flex;gap:12px;height:70vh;min-height:400px;">'
        + '<div style="flex:1;position:relative;">'
        + '<div id="prop-map" style="width:100%;height:100%;border-radius:10px;overflow:hidden;"></div>'
        + '<div style="position:absolute;top:10px;left:10px;z-index:10;">'
        + '<div style="background:rgba(255,255,255,.95);border-radius:8px;padding:8px 12px;box-shadow:0 2px 8px rgba(0,0,0,.2);font-size:13px;">'
        + '<input type="text" id="map-address" value="' + (address || '') + '" placeholder="Enter address..." style="border:none;outline:none;font-size:14px;width:250px;font-weight:600;">'
        + ' <button class="btn btn-primary" style="padding:4px 12px;font-size:12px;" onclick="PropertyMap.geocode()">Go</button>'
        + '</div></div></div>'
        + '<div style="width:180px;background:var(--white);border-radius:10px;border:1px solid var(--border);padding:12px;overflow-y:auto;">'
        + '<h4 style="font-size:13px;margin-bottom:8px;">Equipment</h4>'
        + '<p style="font-size:11px;color:var(--text-light);margin-bottom:10px;">Click to place. Drag to move.</p>'
        + eqButtons
        + '<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;">'
        + '<button class="btn btn-outline" style="width:100%;font-size:12px;" onclick="PropertyMap.clearMarkers()">Clear All</button>'
        + '</div></div></div>'
        + '<div id="placed-equipment" style="margin-top:12px;"></div>';

      UI.showModal('Property Map', html, {
        wide: true,
        footer: '<button class="btn btn-outline" onclick="UI.closeModal()">Cancel</button>'
          + ' <button class="btn btn-primary" onclick="PropertyMap.saveToRecord()">Save to Quote/Job</button>'
      });
    }

    // Init map after modal renders
    setTimeout(function() {
      self.map = new maplibregl.Map({
        container: 'prop-map',
        style: {
          version: 8,
          sources: {
            'satellite': {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256, maxzoom: 19
            },
            'labels': {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256, maxzoom: 19
            }
          },
          layers: [
            { id: 'satellite-layer', type: 'raster', source: 'satellite' },
            { id: 'labels-layer', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.6 } }
          ]
        },
        center: [-73.9204, 41.2890], // Peekskill default
        zoom: 18,
        maxPitch: 60
      });
      self.map.addControl(new maplibregl.NavigationControl(), 'top-right');
      self.markers = [];

      // If address provided, geocode immediately
      if (address) {
        setTimeout(function() { self.geocode(); }, 500);
      }

      // Restore existing markers
      if (existingMarkers && existingMarkers.length) {
        existingMarkers.forEach(function(m) {
          self._placeMarker(m.id, m.lng, m.lat, m.notes);
        });
      }
    }, 300);
  },

  geocode: function() {
    var address = document.getElementById('map-address').value.trim();
    if (!address) return;

    fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(address) + '&limit=1')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.length > 0) {
          var lat = parseFloat(data[0].lat);
          var lng = parseFloat(data[0].lon);
          PropertyMap.map.flyTo({ center: [lng, lat], zoom: 19, duration: 1500 });
        } else {
          UI.toast('Address not found', 'error');
        }
      })
      .catch(function() { UI.toast('Geocoding failed', 'error'); });
  },

  addEquipment: function(eqId) {
    var self = PropertyMap;
    if (!self.map) return;
    var center = self.map.getCenter();
    // Offset slightly so multiple items don't stack
    var offset = self.markers.length * 0.00003;
    self._placeMarker(eqId, center.lng + offset, center.lat + offset, '');
  },

  // Convert feet to pixels at current zoom level
  _feetToPixels: function(feet) {
    if (!PropertyMap.map) return feet;
    var zoom = PropertyMap.map.getZoom();
    // At zoom 20, ~1ft = 1px. Each zoom level halves the scale.
    var pixelsPerFoot = Math.pow(2, zoom - 20) * 1.0;
    return Math.max(feet * pixelsPerFoot, 1);
  },

  _placeMarker: function(eqId, lng, lat, notes) {
    var self = PropertyMap;
    var eq = self.equipmentList.find(function(e) { return e.id === eqId; });
    if (!eq) return;

    // Create scaled rectangle element with rotation support
    var el = document.createElement('div');
    var rotation = 0;
    var minW = Math.max(eq.w * 1.5, 30);
    var minH = Math.max(eq.h * 1.5, 16);
    el.style.cssText = 'width:' + minW + 'px;height:' + minH + 'px;background:' + eq.color + ';'
      + 'border-radius:3px;display:flex;align-items:center;justify-content:center;'
      + 'font-size:9px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.03em;'
      + 'border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.5);cursor:grab;'
      + 'text-shadow:0 1px 2px rgba(0,0,0,.5);line-height:1.1;text-align:center;padding:1px 3px;'
      + 'opacity:.85;transition:transform 0.2s ease;position:relative;';
    el.textContent = eq.label;
    el.title = eq.label + ' — tap to rotate, drag to move';

    // Rotate handle (small circle at corner)
    var handle = document.createElement('div');
    handle.style.cssText = 'position:absolute;top:-8px;right:-8px;width:16px;height:16px;'
      + 'background:#fff;border:2px solid ' + eq.color + ';border-radius:50%;cursor:pointer;'
      + 'display:flex;align-items:center;justify-content:center;font-size:9px;color:' + eq.color + ';'
      + 'box-shadow:0 1px 4px rgba(0,0,0,.3);z-index:5;';
    handle.textContent = '↻';
    handle.title = 'Click to rotate 45°';
    el.appendChild(handle);

    // Click handle to rotate 45° each click
    handle.addEventListener('click', function(e) {
      e.stopPropagation();
      rotation = (rotation + 45) % 360;
      el.style.transform = 'rotate(' + rotation + 'deg)';
      markerData.rotation = rotation;
    });

    // Right-click on equipment to rotate 45° (desktop alternative)
    el.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      e.stopPropagation();
      rotation = (rotation + 45) % 360;
      el.style.transform = 'rotate(' + rotation + 'deg)';
      markerData.rotation = rotation;
    });

    // Update size on zoom (preserve rotation)
    var updateSize = function() {
      var scale = Math.pow(2, (self.map.getZoom() - 18)) * 1.5;
      scale = Math.max(scale, 0.5);
      scale = Math.min(scale, 4);
      el.style.width = Math.max(eq.w * scale, 28) + 'px';
      el.style.height = Math.max(eq.h * scale, 14) + 'px';
      el.style.fontSize = Math.max(7 * scale, 7) + 'px';
      el.style.transform = 'rotate(' + rotation + 'deg)';
    };
    self.map.on('zoom', updateSize);

    var marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([lng, lat])
      .addTo(self.map);

    var markerData = { id: eqId, label: eq.label, lng: lng, lat: lat, rotation: rotation, notes: notes || '', marker: marker, cleanup: function() { self.map.off('zoom', updateSize); } };
    self.markers.push(markerData);

    marker.on('dragend', function() {
      var pos = marker.getLngLat();
      markerData.lng = pos.lng;
      markerData.lat = pos.lat;
    });

    self._updatePlacedList();
  },

  _updatePlacedList: function() {
    var self = PropertyMap;

    // Update mobile badge
    var badge = document.getElementById('placed-count');
    if (badge) {
      badge.style.display = self.markers.length > 0 ? '' : 'none';
      badge.textContent = self.markers.length + ' placed';
    }

    var el = document.getElementById('placed-equipment');
    if (!el) return;

    if (self.markers.length === 0) {
      el.innerHTML = '';
      return;
    }

    var html = '<div style="background:var(--white);border-radius:10px;border:1px solid var(--border);padding:12px;">'
      + '<h4 style="font-size:13px;margin-bottom:8px;">Placed Equipment (' + self.markers.length + ')</h4>';
    self.markers.forEach(function(m, i) {
      var mEq = PropertyMap.equipmentList.find(function(e){return e.id===m.id;}) || {};
      html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f0f0f0;font-size:13px;">'
        + '<span style="display:inline-block;width:20px;height:10px;background:' + (mEq.color||'#999') + ';border-radius:2px;flex-shrink:0;"></span>'
        + '<span style="flex:1;">' + m.label + '</span>'
        + '<button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;" onclick="PropertyMap.removeMarker(' + i + ')">&times;</button>'
        + '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  },

  removeMarker: function(index) {
    var self = PropertyMap;
    if (self.markers[index]) {
      self.markers[index].marker.remove();
      self.markers.splice(index, 1);
      self._updatePlacedList();
    }
  },

  clearMarkers: function() {
    var self = PropertyMap;
    self.markers.forEach(function(m) { m.marker.remove(); });
    self.markers = [];
    self._updatePlacedList();
  },

  getMarkerData: function() {
    return PropertyMap.markers.map(function(m) {
      return { id: m.id, label: m.label, icon: m.icon, lng: m.lng, lat: m.lat, rotation: m.rotation || 0, notes: m.notes };
    });
  },

  saveToRecord: function() {
    var data = PropertyMap.getMarkerData();
    PropertyMap._savedData = data;
    UI.toast(data.length + ' equipment positions saved');
    UI.closeModal();
  },

  closeMobile: function() {
    var container = document.getElementById('propmap-container');
    if (container) container.remove();
    if (PropertyMap.map) {
      PropertyMap.map.remove();
      PropertyMap.map = null;
    }
  }
};
