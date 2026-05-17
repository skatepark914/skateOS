/**
 * Branch Manager — Weather Widget
 * 5-day forecast for Peekskill, NY using Open-Meteo (free, no API key)
 */
var Weather = {
  LAT: 41.2901,
  LON: -73.9204,
  cache: null,
  cacheTime: 0,

  isEnabled: function() {
    return localStorage.getItem('bm-weather-enabled') === 'true';
  },

  toggle: function() {
    var enabled = !Weather.isEnabled();
    localStorage.setItem('bm-weather-enabled', enabled ? 'true' : 'false');
    loadPage(currentPage);
  },

  renderWidget: function() {
    var enabled = Weather.isEnabled();
    var html = '<div id="weather-widget" style="background:var(--white);border-radius:12px;padding:' + (enabled ? '16px' : '12px 16px') + ';border:1px solid var(--border);margin-bottom:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;' + (enabled ? 'margin-bottom:8px;' : '') + '">'
      + '<h4 style="font-size:14px;margin:0;">🌤 Weather — Peekskill, NY</h4>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + (enabled ? '<span style="font-size:11px;color:var(--text-light);">5-day forecast</span>' : '')
      + '<button onclick="Weather.toggle()" style="position:relative;width:36px;height:20px;border-radius:10px;border:none;cursor:pointer;background:' + (enabled ? 'var(--accent)' : '#ccc') + ';transition:background .2s;">'
      + '<span style="position:absolute;top:2px;' + (enabled ? 'left:18px' : 'left:2px') + ';width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2);"></span></button>'
      + '</div></div>';

    if (!enabled) {
      html += '</div>';
      return html;
    }

    html += '<div id="weather-data" style="font-size:13px;color:var(--text-light);">Loading...</div>'
      + '</div>';

    // Fetch weather after render
    setTimeout(function() { Weather.fetch(); }, 100);
    return html;
  },

  fetch: function() {
    // Cache for 30 min
    if (Weather.cache && Date.now() - Weather.cacheTime < 1800000) {
      Weather._render(Weather.cache);
      return;
    }

    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + Weather.LAT + '&longitude=' + Weather.LON
      + '&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m'
      + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,wind_speed_10m_max'
      + '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/New_York&forecast_days=5';

    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      Weather.cache = data;
      Weather.cacheTime = Date.now();
      Weather._render(data);
    }).catch(function(e) {
      var el = document.getElementById('weather-data');
      if (el) el.innerHTML = '<span style="color:var(--text-light);">Unable to load weather</span>';
    });
  },

  _render: function(data) {
    var el = document.getElementById('weather-data');
    if (!el || !data || !data.daily) return;

    var days = data.daily;
    var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var html = '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;text-align:center;">';

    for (var i = 0; i < 5; i++) {
      var d = new Date(days.time[i] + 'T12:00:00');
      var dayName = i === 0 ? 'Today' : dayNames[d.getDay()];
      var hi = Math.round(days.temperature_2m_max[i]);
      var lo = Math.round(days.temperature_2m_min[i]);
      var rain = days.precipitation_probability_max[i];
      var code = days.weathercode[i];
      var icon = Weather._icon(code);
      var rainWarning = rain > 60;

      html += '<div style="padding:8px 4px;border-radius:8px;' + (rainWarning ? 'background:#fff3e0;' : '') + '">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-light);">' + dayName + '</div>'
        + '<div style="font-size:22px;margin:4px 0;">' + icon + '</div>'
        + '<div style="font-size:14px;font-weight:700;">' + hi + '°</div>'
        + '<div style="font-size:11px;color:var(--text-light);">' + lo + '°</div>'
        + (rain > 0 ? '<div style="font-size:10px;color:' + (rainWarning ? '#e65100' : '#2196f3') + ';margin-top:2px;">💧 ' + rain + '%</div>' : '')
        + '</div>';
    }
    html += '</div>';

    // Rain warning for scheduling
    var rainyDays = [];
    for (var j = 0; j < 5; j++) {
      if (days.precipitation_probability_max[j] > 60) {
        var rd = new Date(days.time[j] + 'T12:00:00');
        rainyDays.push(j === 0 ? 'Today' : dayNames[rd.getDay()]);
      }
    }
    if (rainyDays.length) {
      html += '<div style="margin-top:8px;padding:8px;background:#fff3e0;border-radius:6px;font-size:12px;color:#e65100;">'
        + '⚠️ Rain likely: <strong>' + rainyDays.join(', ') + '</strong> — consider rescheduling outdoor work</div>';
    }

    // Wind warning for aerial work
    if (data.current && data.current.wind_gusts_10m > 25) {
      html += '<div style="margin-top:8px;padding:8px;background:#ffebee;border-radius:6px;font-size:12px;color:#c62828;">'
        + '💨 Wind gusts ' + Math.round(data.current.wind_gusts_10m) + ' mph — use caution with bucket truck and climbing</div>';
    }
    if (days.wind_speed_10m_max) {
      var windyDays = [];
      for (var w = 1; w < 5; w++) {
        if (days.wind_speed_10m_max[w] > 25) {
          var wd = new Date(days.time[w] + 'T12:00:00');
          windyDays.push(dayNames[wd.getDay()] + ' (' + Math.round(days.wind_speed_10m_max[w]) + ' mph)');
        }
      }
      if (windyDays.length) {
        html += '<div style="margin-top:6px;padding:8px;background:#e3f2fd;border-radius:6px;font-size:12px;color:#1565c0;">'
          + '💨 Windy days ahead: <strong>' + windyDays.join(', ') + '</strong></div>';
      }
    }

    el.innerHTML = html;
  },

  // Get compact inline HTML for a specific date (for calendar headers)
  // Returns "☀️ 55°" or "" if no data
  getInline: function(dateStr) {
    if (!Weather.isEnabled() || !Weather.cache || !Weather.cache.daily) return '';
    var days = Weather.cache.daily;
    for (var i = 0; i < days.time.length; i++) {
      if (days.time[i] === dateStr) {
        var hi = Math.round(days.temperature_2m_max[i]);
        var icon = Weather._icon(days.weathercode[i]);
        return '<span style="font-size:12px;" title="' + hi + '°F">' + icon + hi + '°</span>';
      }
    }
    return '';
  },

  _icon: function(code) {
    if (code === 0) return '☀️';
    if (code <= 3) return '⛅';
    if (code <= 49) return '🌫️';
    if (code <= 59) return '🌧️';
    if (code <= 69) return '🌨️';
    if (code <= 79) return '🌧️';
    if (code <= 82) return '⛈️';
    if (code <= 86) return '❄️';
    if (code >= 95) return '⛈️';
    return '☁️';
  }
};
