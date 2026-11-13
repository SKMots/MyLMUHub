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
  var webview = root.chrome && root.chrome.webview, capture = null, refused = [];
  function keyStatus() { H.json('api/hotkey-status').then(function (o) { var f = (o && o.failed) || []; if (JSON.stringify(f) !== JSON.stringify(refused)) { refused = f; renderKeys(); } }, function () {}); }
  keyStatus(); setInterval(function () { if (!document.hidden) keyStatus(); }, 10000);
  function renderKeys() {
    if (!ws) return;
    var k = ws.file.keys, al = k.alert || {}, rows = [['>', 'Next view (goes round)', k.next]].concat(ws.names().map(function (n) { return [n, n, k.views[n] || '']; }))
      .concat([['!accept', 'Race alert: accept', al.accept || ''], ['!ignore', 'Race alert: ignore', al.ignore || ''], ['!later', 'Race alert: later', al.later || '']]);
    $('keyList').innerHTML = '<table class="tbl"><tbody>' + rows.map(function (r, i) {
      var bad = r[2] && refused.indexOf(r[2]) >= 0;                                                     // Windows refused it: another program uses it
      return '<tr><td>' + esc(r[1]) + '</td><td class="num mono"' + (bad ? ' style="color:var(--red)" title="Windows refused it: another program uses this key. Pick another one."' : '') + '>' +
        (capture === r[0] ? '<span style="color:var(--lime)">press a key or button…</span>' : esc(ws.keyLabel(r[2]) || '-') + (bad ? ' (in use)' : '')) + '</td>' +
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

  // ---------- race alerts (api/alerts: on / off, which, sound, how long; your own sound: api/alert-sound) ----------
  var al = null, AL = { enabled: true, box: true, strategy: true, sound: 'voice', volume: 80, showSec: 20 };
  function alSave() { fetch('api/alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(al) }); }
  function alRender() {
    var c = function (k, t) { return '<label class="coach-ok" style="margin:6px 0"><input type="checkbox" data-al="' + k + '"' + (al[k] !== false ? ' checked' : '') + '> ' + t + '</label>'; };
    $('alertForm').className = '';
    // everything below 'Race alerts on' is greyed out (and cannot be changed) while alerts are off
    var on = al.enabled !== false, voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    $('alertForm').innerHTML = c('enabled', 'Race alerts on') + '<fieldset style="border:0;padding:0;margin:0;min-width:0' + (on ? '' : ';opacity:.4') + '"' + (on ? '' : ' disabled') + '>' +
      c('box', 'BOX THIS LAP: on the lap before a planned stop') + c('strategy', 'PUSH / LIFT: when another stint length is now best') +
      '<div class="form" style="margin-top:10px"><label class="field">Sound<select class="sel" data-al="sound">' + [['voice', 'A voice says it'], ['chime', 'Chime'], ['file', 'My own sound file'], ['none', 'No sound']].map(function (o) {
        return '<option value="' + o[0] + '"' + (al.sound === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field">Volume (%)<input class="input short" data-al="volume" value="' + esc(al.volume) + '"></label>' +
      (al.sound === 'voice' ? '<label class="field">Voice<select class="sel" data-al="voice"><option value="">Windows default</option>' + voices.map(function (v) {
          return '<option value="' + esc(v.name) + '"' + (al.voice === v.name ? ' selected' : '') + '>' + esc(v.name.replace(/^Microsoft /, '') + (v.lang ? ' (' + v.lang + ')' : '')) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field">Speed (%)<input class="input short" data-al="rate" value="' + esc(al.rate || 105) + '"></label>' +
        '<label class="field">Pitch (%)<input class="input short" data-al="pitch" value="' + esc(al.pitch || 100) + '"></label>' : '') +
      '<label class="field">Show PUSH / LIFT for (s)<input class="input short" data-al="showSec" value="' + esc(al.showSec) + '"></label></div>' +
      '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:10px;align-items:center"><button class="btn" id="alTest">Test the sound</button>' +
      (al.sound === 'file' ? '<button class="btn" id="alPick">Pick a sound file</button><input type="file" id="alFile" accept="audio/*" hidden><span class="faint">' + (al.fileAt ? 'Your sound is set.' : 'No file yet (mp3 / wav, up to 5 MB).') + '</span>' : '') +
      '<span class="faint" id="alInfo"></span></div>' +
      (al.sound === 'voice' ? '<div class="faint" style="margin-top:8px">The voices are the ones installed on this PC. More (other languages and accents): Windows Settings, Time &amp; language, Speech, Add voices.</div>' : '') +
      '</fieldset>';
  }
  $('alertForm').onchange = function (e) {
    var k = e.target.getAttribute('data-al'); if (!k || !al) return;
    if (e.target.type === 'checkbox') al[k] = e.target.checked;
    else if (k === 'volume' || k === 'showSec') { var v = Number(e.target.value); if (isFinite(v)) al[k] = Math.max(0, Math.min(k === 'volume' ? 100 : 120, v)); }
    else if (k === 'rate' || k === 'pitch') { var r = Number(e.target.value); if (isFinite(r)) al[k] = Math.max(k === 'rate' ? 50 : 0, Math.min(200, Math.round(r))); }
    else al[k] = e.target.value;
    alSave(); alRender();
    if (e.target.id === 'alFile') return;
  };
  $('alertForm').onclick = function (e) {
    if (e.target.id === 'alTest') testSound();
    if (e.target.id === 'alPick') $('alFile').click();
  };
  $('alertForm').addEventListener('change', function (e) {
    if (e.target.id !== 'alFile' || !e.target.files || !e.target.files[0]) return;
    var f = e.target.files[0]; if (f.size > 5000000) { alert('That file is over 5 MB.'); return; }
    fetch('api/alert-sound', { method: 'PUT', body: f }).then(function (r) { if (r.ok) { al.fileAt = Date.now(); alSave(); alRender(); $('alInfo').textContent = 'Saved.'; } else alert('Could not save that file.'); });
  });
  // the same sounds as the dashboard (widgets/alert.js)
  function testSound() {
    var vol = Math.max(0, Math.min(100, Number(al.volume) || 0)) / 100;
    if (al.sound === 'none' || !vol) return;
    if (al.sound === 'voice' && window.speechSynthesis) { var u = new SpeechSynthesisUtterance('Box this lap. Push, 4.5 percent a lap.'); voiceOf(u, al, vol); speechSynthesis.cancel(); speechSynthesis.speak(u); return; }
    if (al.sound === 'file') { var a = new Audio('api/alert-sound?t=' + (al.fileAt || 0)); a.volume = vol; a.play().catch(function () { $('alInfo').textContent = 'No sound file yet.'; }); return; }
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; var ctx = new AC();
    [880, 1320].forEach(function (fq, i) { var o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + i * 0.18; o.frequency.value = fq; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35 * vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16); o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.17); });
  }
  // the voice settings on an utterance (the same in the dashboard: widgets/alert.js)
  function voiceOf(u, s, vol) {
    u.volume = vol; u.rate = (Number(s.rate) || 105) / 100; u.pitch = (s.pitch === 0 ? 0 : Number(s.pitch) || 100) / 100;
    var v = s.voice && speechSynthesis.getVoices().filter(function (x) { return x.name === s.voice; })[0]; if (v) u.voice = v;
  }
  if (window.speechSynthesis && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', function () { if (al) alRender(); });   // the list comes a moment later
  H.json('api/alerts').catch(function () { return null; }).then(function (o) { al = Object.assign({}, AL, o || {}); alRender(); });

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
