// My LMU Hub pages (home, Race Pace): the shared header (logo, live line, menu, your name) and small helpers.
// Race Control opens as its own app window (POST api/open) so it can sit full screen on another monitor; outside the app (index.html opened from disk) it is a link.
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, F = P.format;
  var inApp = /^https?:/.test(location.protocol);

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function json(url, opt) { return fetch(url, opt).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  var here = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);              // false = opened from another PC on the network
  function openRaceControl() { if (inApp && here) fetch('api/open?what=racecontrol', { method: 'POST' }); else location.href = 'index.html'; }

  function header(active) {
    var h = document.getElementById('hdr');
    h.className = 'hdr';
    h.innerHTML = '<a class="brand" href="home.html"><img src="assets/logo.svg" alt=""><b><i>my</i>lmu<i>hub</i></b><small>sim<br>racing</small></a>' +
      '<div class="rule" id="liveRule">offline</div>' +
      '<nav class="nav"><a href="home.html"' + (active === 'home' ? ' class="on"' : '') + '>Home</a><a href="racecontrol.html"' + (active === 'rc' ? ' class="on"' : '') + '>Race Control</a>' +
      '<a href="pace.html"' + (active === 'pace' ? ' class="on"' : '') + '>Race Pace</a><a href="potential.html"' + (active === 'potential' ? ' class="on"' : '') + '>Improve</a><a href="strategy.html"' + (active === 'strategy' ? ' class="on"' : '') + '>Strategy</a><a href="team.html"' + (active === 'team' ? ' class="on"' : '') + '>Team</a><a href="coach.html"' + (active === 'coach' ? ' class="on"' : '') + '>AI Coach</a></nav>' +
      '<span class="upd" id="upd"></span>' +
      // guest mode: switched on Settings; here only a badge while it is on (owner 2026-11-16: a cleaner header)
      '<a class="btn lime" id="guestBtn" href="settings.html#guest" hidden></a>' +
      // your name: the Settings page (driver names, team server, phone, theme; owner 2026-11-16: one place instead of popups and lists in the header)
      '<a class="who' + (active === 'settings' ? ' on' : '') + '" id="who" href="settings.html" title="Settings: your names, team server, phone, theme"><span>?</span><em>Your names</em></a>' +
      '';
    guestState();
    if (inApp && here) update();                                                          // the update button: only on the PC the app runs on
  }
  // the app version and, when a newer one is out, the Update button (UpdateService.cs: download, swap, restart). A dev build says "dev" and never updates.
  var updTimer = null;
  function update(post) {
    var u = document.getElementById('upd'); if (!u) return;
    json('api/update' + (post ? '?do=' + post : ''), post ? { method: 'POST' } : undefined).then(function (s) {
      var v = 'v' + s.current, html = '', soon = 60000;
      if (s.state === 'available') html = '<button class="btn lime" id="updGo" title="' + esc(s.notes || 'A new version is out') + '">Update to v' + esc(s.latest) + '</button>';
      else if (s.state === 'downloading') { html = '<span class="muted">Downloading update ' + Math.round(s.progress * 100) + '%</span>'; soon = 1000; }
      else if (s.state === 'ready') html = '<span class="muted">Restarting...</span>';
      else if (s.state === 'error') html = '<span class="upd-err" title="' + esc(s.error) + '">Update failed</span> <button class="btn" id="updRetry">Try again</button>';
      else html = '<span class="faint" title="' + (s.enabled ? 'You have the newest version' : 'Dev build: does not update itself') + '">' + esc(v) + (s.enabled ? '' : ' dev') + '</span>';
      if (u._h !== html) { u.innerHTML = html; u._h = html; }
      var go = document.getElementById('updGo'), re = document.getElementById('updRetry');
      if (go) go.onclick = function () { if (confirm('Update My LMU Hub to v' + s.latest + '?\n\n' + (s.notes ? 'What is new since your version (v' + s.current + '):\n\n' + s.notes + '\n\n' : '') + 'The app downloads it and restarts (your settings and layouts stay).')) update('install'); };
      if (re) re.onclick = function () { update('check'); setTimeout(function () { update(); }, 3000); };
      clearTimeout(updTimer); updTimer = setTimeout(function () { update(); }, soon);
    }, function () { clearTimeout(updTimer); updTimer = setTimeout(function () { update(); }, 60000); });
  }
  // the hub's theme ('' = lime): saved in this browser / the app's WebView; the page's <head> applies it before drawing (no flash)
  var HUB_THEMES = [['', 'Theme: Lime'], ['teal', 'Theme: Teal'], ['daylight', 'Theme: Daylight'], ['navy', 'Theme: Navy']];
  function hubTheme() { try { return localStorage.getItem('pw-hub-theme') || ''; } catch (e) { return ''; } }
  function applyHubTheme() {
    var t = hubTheme(); if (t) document.documentElement.setAttribute('data-hub-theme', t); else document.documentElement.removeAttribute('data-hub-theme');
    // in the app: the window's title bar in this theme's card colour, the title and the line round the window in its accent (MainWindow.OnMessage)
    var w = root.chrome && root.chrome.webview, cs = root.getComputedStyle ? getComputedStyle(document.documentElement) : null;
    if (w && w.postMessage && cs) { try { var acc = cs.getPropertyValue('--lime').trim(); w.postMessage({ titleBar: cs.getPropertyValue('--card').trim(), titleText: acc, titleBorder: acc }); } catch (e) {} }
  }
  applyHubTheme();
  function setWho(name) {
    var w = document.getElementById('who'); if (!w) return;
    w.querySelector('span').textContent = name ? name.trim().charAt(0).toUpperCase() : '?'; w.querySelector('em').textContent = name || 'Your names';
  }

  // guest mode (Guests.cs): a friend drives on your rig under YOUR game account, so only the time tells his laps from yours. While it is on, every page
  // shows only his data (and nothing of it ever goes into yours); afterwards keep it hidden, or delete it (his result files to the Recycle Bin).
  function guestState() {
    if (!inApp) return;
    json('api/guest').then(function (g) {
      var b = document.getElementById('guestBtn'); if (!b) return;
      b.hidden = !g.current; b.textContent = g.current ? 'Guest: ' + g.current : '';
      b.title = g.current ? 'Guest mode is on: these pages show ' + g.current + '\'s laps, not yours. Click to switch it off (Settings).' : '';
    }, function () {});
  }
  function guestPanel(p) {
    p.hidden = false; p.innerHTML = '<div class="muted">Loading...</div>';
    if (!inApp) { p.innerHTML = '<div class="muted">Open the hub in the app for guest mode.</div>'; return; }
    function act(q) { return fetch('api/guest?' + q, { method: 'POST' }).then(function (r) { if (!r.ok) throw new Error(r.status); }); }
    function done() { location.reload(); }
    json('api/guest').then(function (g) {
      var h = '';
      if (g.current) {
        h = '<div class="pop-h">Guest mode: ' + esc(g.current) + '</div><div class="muted" style="margin-bottom:12px">On since ' + esc(F.wallClock(g.since * 1000)) + '. Everything driven now is ' + esc(g.current) +
          '\'s: these pages show only his laps, and none of it goes into yours.<br><br>A session\'s result file is written when the session ENDS: switch off after his last session has ended (back in the game\'s menu).</div>' +
          (here ? '<div class="bar" style="flex-wrap:wrap;gap:8px"><button class="btn" id="gStop">Stop: keep his data (hidden from you)</button><button class="btn" id="gDel">Stop and delete his data</button></div>' : '<div class="faint">Switch it on the PC the app runs on.</div>');
      } else {
        h = '<div class="pop-h">Guest driver</div><div class="muted" style="margin-bottom:12px">A friend drives on your rig? He drives under your game account, so the app tells his laps from yours by the time: switch this on when he sits down.' +
          ' Until you switch it off, the app shows his laps (Race Pace, Improve, best lap ever, segments) and keeps them out of yours.</div>' +
          (here ? '<div class="bar" style="gap:8px"><input class="input" id="gName" placeholder="His name" maxlength="40" style="min-width:0;flex:1"><button class="btn lime" id="gStart">Start</button></div>' : '<div class="faint">Switch it on the PC the app runs on.</div>');
      }
      var old = (g.guests || []).filter(function (x) { return x.name !== g.current; });
      // an earlier guest keeps his profile (his result files, segments, best laps): "Drive again" switches guest mode on for him, his data carries on
      if (old.length) h += '<div class="pop-h" style="margin-top:16px">Earlier guests (hidden from you)</div><div class="pop-list">' + old.map(function (x) {
        return '<div class="pop-row" style="cursor:default"><span>' + esc(x.name) + '</span><small>' + esc(F.day(x.from)) + ' · ' + x.files + ' result files</small>' +
          (here ? '<button class="btn lime" data-again="' + esc(x.name) + '" style="padding:4px 10px">Drive again</button><button class="btn" data-del="' + esc(x.name) + '" style="padding:4px 10px">Delete</button>' : '') + '</div>';
      }).join('') + '</div>';
      p.innerHTML = h;
      function del(name) { return confirm('Delete everything of ' + name + '?\n\nHis result files (from his time at the wheel) go to the Recycle Bin, his segments are removed. Your own data stays.') ? act('do=delete&name=' + encodeURIComponent(name)) : Promise.reject(); }
      var s = document.getElementById('gStart'), st = document.getElementById('gStop'), d = document.getElementById('gDel');
      if (s) s.onclick = function () { var n = document.getElementById('gName').value.trim(); if (n) act('do=start&name=' + encodeURIComponent(n)).then(done, function () {}); };
      if (st) st.onclick = function () { act('do=stop').then(done, function () {}); };
      if (d) d.onclick = function () { var n = g.current; del(n).then(done, function () {}); };
      [].forEach.call(p.querySelectorAll('[data-again]'), function (b) { b.onclick = function () { act('do=start&name=' + encodeURIComponent(b.getAttribute('data-again'))).then(done, function () {}); }; });
      [].forEach.call(p.querySelectorAll('[data-del]'), function (b) { b.onclick = function () { del(b.getAttribute('data-del')).then(done, function () {}); }; });
    }, function () { p.innerHTML = '<div class="muted">Could not load guest mode.</div>'; });
  }

  // the game's state every 3 s (cheap: the last message the dashboard got). cb(state or null). The header line shows LIVE + track + session.
  function live(cb) {
    function tick() {
      if (!inApp) { show(null); return; }
      json('api/state').then(show, function () { show(null); });
    }
    function show(s) {
      var on = !!(s && s.standings), r = document.getElementById('liveRule');
      if (r) { r.className = 'rule' + (on ? ' live' : ''); r.textContent = on ? 'live · ' + ((s.track && s.track.name) || '') + (s.top && s.top.session >= 0 ? ' · ' + F.sessionName(s.top.session).toLowerCase() : '') : 'game not running'; }
      if (cb) cb(on ? s : null);
    }
    tick(); setInterval(tick, 3000);
  }

  // the Race Pace data (api/pace). While the app is still reading result files: progress(info) every second, then done(info with sessions).
  function loadPace(progress, done) {
    if (!inApp) { done({ error: 'Open this page in the app to read your result files.', sessions: [], names: [], candidates: [] }); return; }
    json('api/pace?light=1').then(function (i) {
      if (i.scanning) { progress(i); setTimeout(function () { loadPace(progress, done); }, 1000); }
      else json('api/pace').then(function (d) { done(d); shareMine(d); }, function (e) { done({ error: String(e), sessions: [], names: [], candidates: [] }); });
    }, function (e) { done({ error: String(e), sessions: [], names: [], candidates: [] }); });
  }

  // My stats on the website (2026-11-16): the Race Pace page's overview (pace.js, its default view: race sessions, all time, current game version), one row
  // per track (every layout its own track) and class, with the alien race pace and hotlap of the reference sheet; the car = your fastest car there.
  // Sent to the team server only when it changed (Settings: on by default; only you see it there).
  // Not while a guest drives (the pages then show his files). Pages without the pace maths (pace-ref.js, pace-math.js) send nothing.
  var mineBusy = false;
  function shareMine(data) {
    var R = P.paceRef, M = P.paceMath;
    if (!inApp || mineBusy || !R || !M || !data || !data.sessions || !data.sessions.length) return;
    mineBusy = true;
    Promise.all([json('api/guest').catch(function () { return {}; }), json('api/reference').catch(function () { return null; })]).then(function (a) {
      if (a[0] && a[0].current) return;
      var ref = a[1] && a[1].csv ? R.parse(a[1].csv) : {};
      var refFor = function (s, cls) { var t = ref[R.trackName(s.track, s.layout)], c = R.className(cls); return t && c ? t[c] || null : null; };
      var all = data.sessions, cur = null;
      all.forEach(function (s) { var m = R.major(s.version); if (m && (!cur || m > cur)) cur = m; });
      var list = all.filter(function (s) { var rf = refFor(s, s['class']); return !R.isOld(s.version, rf && rf.patch, cur); });
      var by = function (l, kf) { var m = {}, out = []; l.forEach(function (s) { var k = kf(s); if (!m[k]) { m[k] = { key: k, sessions: [], last: 0, laps: 0 }; out.push(m[k]); } m[k].sessions.push(s); m[k].last = Math.max(m[k].last, s.time); m[k].laps += s.laps.length; }); return out; };
      var tracks = by(list, function (s) { return R.trackKey(s.track, s.layout); }), per = {};
      tracks.forEach(function (t) { var s0 = t.sessions[t.sessions.length - 1]; t.base = R.trackName(s0.track, s0.layout) || s0.track; t.layout = s0.layout; per[t.base] = (per[t.base] || 0) + 1; });
      var rows = [];
      tracks.forEach(function (t) {
        var name = per[t.base] > 1 && t.layout ? t.base + ' · ' + R.variantLabel(t.base, t.layout) : t.base;
        by(t.sessions, function (s) { return s['class']; }).forEach(function (c) {
          var d = M.combine(c.sessions, 0.05, ['Race']).dry, rf = refFor(c.sessions[0], c.key), bc = null;
          by(c.sessions, function (s) { return s.car; }).forEach(function (k) { k.best = M.combine(k.sessions, 0.05, ['Race']).dry.best; if (k.best && (!bc || k.best < bc.best)) bc = k; });
          var nc = {}; c.sessions.forEach(function (s) { nc[s.car] = 1; });
          rows.push({ track: name.slice(0, 80), car: (bc ? bc.key : c.sessions[0].car || '?').slice(0, 80), cls: c.key || '', best: d.best || 0, optimal: d.optimal || 0, pace: d.pace || 0, sd: d.sd > 0 ? d.sd : 0,
                      clean: d.clean || 0, laps: c.laps, last: c.last, refPace: rf && rf.race && rf.race[0] > 0 ? rf.race[0] : 0, refHot: rf && rf.hot > 0 ? rf.hot : 0, sessions: c.sessions.length, cars: Object.keys(nc).length });
        });
      });
      rows = rows.filter(function (r) { return r.track && r.car && r.laps > 0 && r.last > 1400000000; }).sort(function (a, b) { return b.last - a.last; }).slice(0, 400);
      var sig = JSON.stringify(rows), h = sig.length + ':' + sig.slice(-300), old2 = null;
      try { old2 = localStorage.getItem('pw-my-pace'); } catch (e) {}
      if (old2 === h) return;
      return fetch('api/team?op=myPace', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MLH': '1' }, body: JSON.stringify({ rows: rows }) }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { if (r.ok && !j.off) try { localStorage.setItem('pw-my-pace', h); } catch (e) {} });
      });
    }).catch(function () {}).then(function () { mineBusy = false; });
  }

  // keeps a page's Race Pace data up to date: every 5 s a tiny check of the change number (gen: a new / changed result file, other names, a lap you just
  // drove); only when it changed is the whole data loaded again and done(info) called. Nothing while the page is hidden (minimised / another tab).
  function watchPace(gen, done) {
    if (!inApp) return;
    setInterval(function () {
      if (document.hidden) return;
      json('api/pace?light=1').then(function (i) {
        if (i.scanning || i.gen === gen) return;
        gen = i.gen; json('api/pace').then(done, function () {});
      }, function () {});
    }, 5000);
  }

  function setTheme(t) { try { localStorage.setItem('pw-hub-theme', t || ''); } catch (e) {} applyHubTheme(); }
  P.hub = { esc: esc, json: json, header: header, setWho: setWho, guestPanel: guestPanel, themes: HUB_THEMES, theme: hubTheme, setTheme: setTheme, live: live, openRaceControl: openRaceControl, inApp: inApp, loadPace: loadPace, watchPace: watchPace };
})(typeof window !== 'undefined' ? window : globalThis);
