// Hub page "Race Control": the dashboard's settings in one place (owner 2026-11-11: quicker than the dashboard's edit mode). Open the dashboard; VE goal per
// track (vegoals.json, the fuel widget reads it); theme + text size, which view the dashboard shows, export / import, hotkeys (all in layout.json: saving it
// tells an open dashboard, which takes them over: DashServer 'layout' message, app.js fromFile); network access (api/net); whose car to follow (api/spectate).
(function (root) {
  'use strict';
  var P = root.MyLMUHub, H = P.hub, R = P.paceRef, F = P.format, esc = H.esc;
  var $ = function (id) { return document.getElementById(id); };
  H.header('rc');
  if (H.inApp) H.json('api/pace?light=1').then(function (i) { H.setWho(i.names && i.names[0]); }, function () {});   // your name top right, as on the other pages
  var pageId = 'hub' + Math.random().toString(36).slice(2, 8);

  $('openBtn').onclick = function () { H.openRaceControl(); $('openInfo').textContent = H.inApp ? 'Opening...' : ''; setTimeout(function () { $('openInfo').textContent = ''; }, 2500); };
  if (!H.inApp) {
    document.querySelectorAll('.grid .card').forEach(function (c) { c.querySelector('.sub').insertAdjacentHTML('afterend', '<div class="faint">Open this page in the app to change this.</div>'); });
    return;
  }

  // ---------- VE goal per track ----------
  var goals = {}, tracks = [], goalTimer = null;
  function saveGoals() {
    clearTimeout(goalTimer);
    goalTimer = setTimeout(function () {
      var out = {}; Object.keys(goals).forEach(function (k) { if (k && goals[k] > 0) out[k] = goals[k]; });
      fetch('api/vegoals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) }).then(function () { $('goalInfo').textContent = 'Saved.'; setTimeout(function () { $('goalInfo').textContent = ''; }, 1500); });
    }, 400);
  }
  function trackOptions(sel) {
    var list = tracks.slice(); if (sel && list.indexOf(sel) < 0) list.unshift(sel);
    return '<option value="">Pick a track</option>' + list.map(function (t) { return '<option' + (t === sel ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
  }
  function renderGoals() {
    var keys = Object.keys(goals);
    $('goalTbl').innerHTML = '<thead><tr><th>Track</th><th class="num">VE per lap (%)</th><th></th></tr></thead><tbody>' + (keys.length ? keys.map(function (k, i) {
      return '<tr data-i="' + i + '"><td><select class="sel cell" data-f="track">' + trackOptions(k) + '</select></td><td class="num"><input class="input cell mono" data-f="goal" value="' + (goals[k] > 0 ? goals[k] : '') + '" placeholder="e.g. 3.8" style="width:90px"></td>' +
        '<td><button class="xbtn" data-del="' + i + '" title="Remove">×</button></td></tr>';
    }).join('') : '<tr><td colspan="3" class="empty">No goals yet. Add a track.</td></tr>') + '</tbody>';
  }
  $('goalTbl').onchange = function (e) {
    var tr = e.target.closest('tr[data-i]'); if (!tr) return;
    var keys = Object.keys(goals), k = keys[Number(tr.getAttribute('data-i'))], f = e.target.getAttribute('data-f');
    if (f === 'track') {
      var v = e.target.value, n = {}; keys.forEach(function (x) { if (x === k) { if (v && !(v in goals && v !== k)) n[v] = goals[k]; else n[x] = goals[x]; } else n[x] = goals[x]; });
      goals = n; renderGoals();
    } else if (f === 'goal') { var g = Number(String(e.target.value).replace(',', '.')); goals[k] = g > 0 ? Math.round(g * 100) / 100 : 0; }
    saveGoals();
  };
  $('goalTbl').onclick = function (e) { var d = e.target.getAttribute('data-del'); if (d === null) return; delete goals[Object.keys(goals)[Number(d)]]; renderGoals(); saveGoals(); };
  $('goalAdd').onclick = function () { if (!('' in goals)) goals[''] = 0; renderGoals(); };
  H.json('api/vegoals').then(function (j) { goals = j && typeof j === 'object' ? j : {}; renderGoals(); }, function () { goals = {}; renderGoals(); });
  H.json('api/reference').then(function (r) { tracks = Object.keys(R.parse(r.csv)).sort(); renderGoals(); }, function () {});

  // ---------- the layout file: theme, views, hotkeys ----------
  var ws = null, saving = Promise.resolve();
  function load() {
    return fetch('api/layout').then(function (r) { return r.ok ? r.json() : null; }).then(function (raw) {
      if (!raw || !(raw.views || raw.widgets)) { ws = null; return; }
      ws = new P.Workspace({ save: function (file) { return fetch('api/layout', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Page': pageId }, body: JSON.stringify(file) }); } }, function () { return { widgets: [] }; });
      ws.load(raw);
    }, function () { ws = null; });
  }
  // change the file: read it fresh (the dashboard may have saved meanwhile), change, save; the open dashboard takes it over
  function change(fn, info) {
    saving = saving.then(load).then(function () { if (!ws) return; fn(ws); return ws.save(); }).then(function () { renderLayout(); if (info) { $(info).textContent = 'Saved: the dashboard follows.'; setTimeout(function () { $(info).textContent = ''; }, 2000); } });
  }
  function renderLayout() {
    var none = '<div class="faint">Open the dashboard once first: it makes its layout file.</div>';
    if (!ws) { $('themeForm').innerHTML = none; $('viewSel').innerHTML = ''; $('keyList').innerHTML = none; return; }
    // theme: the same choices as the dashboard's Theme panel (theme.js themeOptions)
    $('themeForm').innerHTML = P.theme.themeOptions(ws.theme()).map(function (o) {
      var input = o.type === 'select' ? '<select class="sel" data-t="' + o.key + '">' + o.choices.map(function (c) { return '<option value="' + esc(c[0]) + '"' + (c[0] === o.value ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select>'
        : o.type === 'bool' ? '<select class="sel" data-t="' + o.key + '"><option value="1"' + (o.on ? ' selected' : '') + '>On</option><option value="0"' + (o.on ? '' : ' selected') + '>Off</option></select>'
        : '<input class="input short" data-t="' + o.key + '" value="' + esc(o.value) + '">';
      return '<label class="field">' + esc(o.label) + input + '</label>';
    }).join('');
    $('viewSel').innerHTML = ws.names().map(function (n) { return '<option' + (n === ws.file.current ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
    renderKeys();
  }
  $('themeForm').onchange = function (e) {
    var k = e.target.getAttribute('data-t'); if (!k) return;
    var v = e.target.value; if (k === 'strips') v = v === '1';
    change(function (w) { P.theme.setThemeOption(w.theme(), k, v); }, 'themeInfo');
  };
  $('viewSel').onchange = function () { var v = this.value; change(function (w) { w.select(v); }, 'viewInfo'); };
  $('exportBtn').onclick = function () {
    if (!ws) return;
    var blob = new Blob([JSON.stringify(ws.exportData(), null, 1)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'My LMU Hub layout.json'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  $('importBtn').onclick = function () { $('importFile').value = ''; $('importFile').click(); };
  $('importFile').onchange = function () {
    var file = this.files && this.files[0]; if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var data; try { data = JSON.parse(rd.result); } catch (e) { alert('That is not a layout file.'); return; }
      if (!data || !data.views) { alert('That is not a layout file.'); return; }
      var theme = data.theme && confirm('Also use the theme (colours, fonts) of this layout?'), added = [];
      change(function (w) { added = w.importData(data, theme); }, 'viewInfo');
      saving.then(function () { alert(added.length ? 'Added: ' + added.join(', ') : 'No views in that file.'); });
    };
    rd.readAsText(file);
  };

  // ---------- hotkeys (layout.json keys; the dashboard window registers them with Windows) ----------
  var webview = root.chrome && root.chrome.webview, capture = null;
  function renderKeys() {
    if (!ws) return;
    var k = ws.file.keys, rows = [['>', 'Next view (goes round)', k.next]].concat(ws.names().map(function (n) { return [n, n, k.views[n] || '']; }));
    $('keyList').innerHTML = '<table class="tbl"><tbody>' + rows.map(function (r, i) {
      return '<tr><td>' + esc(r[1]) + '</td><td class="num mono">' + (capture === r[0] ? '<span style="color:var(--lime)">press a key or button…</span>' : esc(ws.keyLabel(r[2]) || '-')) + '</td>' +
        '<td style="text-align:right"><button class="btn" data-set="' + i + '">Set</button> <button class="btn" data-clear="' + i + '"' + (r[2] ? '' : ' disabled') + '>×</button></td></tr>';
    }).join('') + '</tbody></table>';
    $('keyList')._rows = rows;
  }
  function startCapture(t) { capture = t; if (webview && webview.postMessage) try { webview.postMessage({ padLearn: true }); } catch (e) {} renderKeys(); }
  function stopCapture() { capture = null; if (webview && webview.postMessage) try { webview.postMessage({ padLearn: false }); } catch (e) {} renderKeys(); }
  function setKey(target, combo, label) { stopCapture(); change(function (w) { w.setKey(target, combo, label); }); }
  $('keyList').onclick = function (e) {
    var rows = $('keyList')._rows, s = e.target.getAttribute('data-set'), c = e.target.getAttribute('data-clear');
    if (s !== null) startCapture(rows[+s][0]);
    if (c !== null) setKey(rows[+c][0], '');
  };
  document.addEventListener('keydown', function (ev) {
    if (capture === null) return;
    if (ev.key === 'Escape') { stopCapture(); ev.preventDefault(); return; }
    var combo = P.comboOf(ev); if (!combo) return;
    setKey(capture, combo); ev.preventDefault(); ev.stopPropagation();
  }, true);
  if (webview && webview.addEventListener) webview.addEventListener('message', function (ev) { var d = ev.data || {}; if (d.padLearned && capture !== null) setKey(capture, d.padLearned, d.padName); });
  window.addEventListener('beforeunload', function () { if (capture !== null) stopCapture(); });

  load().then(renderLayout);

  // ---------- network ----------
  function netLoad() {
    H.json('api/net').then(function (n) {
      var h = n.on ? (n.urls.length ? n.urls.map(function (u) { return '<div style="display:flex;gap:10px;align-items:center;margin:4px 0"><span class="mono" style="user-select:all">' + esc(u) + '</span><button class="btn" data-copy="' + esc(u) + '">Copy</button></div>'; }).join('')
          : '<div class="faint">No network address found (is this PC on a network?).</div>') + '<div style="margin-top:10px"><button class="btn" data-net="off">Turn off</button></div>'
        : (n.error ? '<div style="color:var(--red)">' + esc(n.error) + '</div>' : '') + '<div>Off.</div><div style="margin-top:10px"><button class="btn lime" data-net="on">Turn on</button></div>';
      if (n.on && ws) h += '<div class="sub" style="margin:12px 0 4px 0">A view per device: each view has its own address.</div>' + ws.names().map(function (v) {
        var a = n.urls[0] + 'index.html?view=' + encodeURIComponent(v); return '<div style="display:flex;gap:10px;align-items:center;margin:4px 0"><b>' + esc(v) + '</b><span class="mono faint" style="user-select:all">' + esc(a) + '</span><button class="btn" data-copy="' + esc(a) + '">Copy</button></div>';
      }).join('');
      $('netBody').innerHTML = h; $('netBody').className = '';
    }, function () { $('netBody').textContent = 'Not available.'; });
  }
  function netDo(what) {
    return H.json('api/net?do=' + what, { method: 'POST' }).then(function (x) {
      if (x.result === 'setup' && confirm('Windows has to allow this once: an admin prompt follows.\n\nIt lets My LMU Hub use port ' + x.info.port + ' for your home network and opens the firewall for it on PRIVATE networks only (home / work, not public Wi-Fi).')) return netDo('setup');
      if (x.result && x.result !== 'setup') alert('Network access did not start: ' + x.result);
      netLoad();
    });
  }
  $('netBody').onclick = function (e) {
    var t = e.target, d = t.getAttribute('data-net'), c = t.getAttribute('data-copy');
    if (d) { t.disabled = true; t.textContent = 'one moment...'; netDo(d); }
    if (c && navigator.clipboard) navigator.clipboard.writeText(c).then(function () { var was = t.textContent; t.textContent = 'Copied'; setTimeout(function () { t.textContent = was; }, 1500); });
  };
  netLoad();

  // ---------- spectate ----------
  var spec = null;
  function specLoad() { H.json('api/spectate').then(function (i) { spec = i || { target: null, cars: [] }; specRender(); }, function () { $('specList').textContent = 'Not available.'; }); }
  function specRender() {
    if (!spec) return;
    var t = spec.target, q = $('specFind').value.trim().toLowerCase(), order = {}, cars = (spec.cars || []).slice(), cls = null, n = 0, h = '';
    cars.forEach(function (c) { if (!(c.cls in order)) order[c.cls] = Object.keys(order).length; });
    cars.sort(function (a, b) { return order[a.cls] - order[b.cls] || a.place - b.place; });
    h += '<div class="spec-row' + (t ? '' : ' on') + '" data-i="-1">Automatic: my car / my names</div>';
    cars.forEach(function (c, i) {
      if (c.cls !== cls) { cls = c.cls; n = 0; if (!q) h += '<div class="faint" style="margin:10px 0 4px 0;font-weight:700">' + esc(cls || '-') + '</div>'; }
      n++;
      if (q && (c.driver + ' ' + c.entry).toLowerCase().indexOf(q) < 0) return;
      h += '<div class="spec-row' + (t && t.driver === c.driver ? ' on' : '') + '" data-i="' + i + '"><span class="faint">P' + n + '</span> <b>' + esc(c.driver) + (c.player ? ' (you)' : '') + '</b> <span class="faint">' + esc(c.entry) + '</span></div>';
    });
    if (!cars.length) h += '<div class="faint" style="margin-top:8px">No session: start Le Mans Ultimate and join one.</div>';
    $('specList').innerHTML = h; $('specList').className = ''; $('specList')._cars = cars;
  }
  $('specList').onclick = function (e) {
    var r = e.target.closest('[data-i]'); if (!r) return;
    var i = Number(r.getAttribute('data-i')), c = $('specList')._cars[i], body = i < 0 ? {} : { driver: c.driver, entry: c.entry };
    fetch('api/spectate', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(specLoad);
  };
  $('specFind').oninput = specRender; $('specRefresh').onclick = specLoad;
  specLoad(); setInterval(function () { if (!document.hidden) specLoad(); }, 10000);
})(typeof window !== 'undefined' ? window : globalThis);
