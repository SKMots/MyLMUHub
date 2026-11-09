// My LMU Hub pages (home, Race Pace): the shared header (logo, live line, menu, your name) and small helpers.
// Race Control opens as its own app window (POST api/open) so it can sit full screen on another monitor; outside the app (index.html opened from disk) it is a link.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format;
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
      '<nav class="nav"><a href="home.html"' + (active === 'home' ? ' class="on"' : '') + '>Home</a><a href="#" id="navRc">Race Control</a>' +
      '<a href="pace.html"' + (active === 'pace' ? ' class="on"' : '') + '>Race Pace</a><a href="potential.html"' + (active === 'potential' ? ' class="on"' : '') + '>Improve</a><a href="strategy.html"' + (active === 'strategy' ? ' class="on"' : '') + '>Strategy</a><a href="coach.html"' + (active === 'coach' ? ' class="on"' : '') + '>AI Coach</a></nav>' +
      '<span class="upd" id="upd"></span>' +
      '<select class="sel themeSel" id="hubTheme" title="Hub theme (Race Control has its own, in its edit mode)">' + HUB_THEMES.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === hubTheme() ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select>' +
      '<button class="btn" id="guestBtn" title="A friend drives on your rig: keep his laps apart from yours">Guest</button>' +
      '<button class="who" id="who" title="Your driver names"><span>?</span><em>Your names</em></button>' +
      '<div class="pop" id="whoPop" hidden></div><div class="pop" id="guestPop" hidden></div>';
    h.parentNode.insertBefore(document.getElementById('whoPop'), h.nextSibling); h.parentNode.insertBefore(document.getElementById('guestPop'), h.nextSibling);
    document.getElementById('guestBtn').onclick = function () { var p = document.getElementById('guestPop'); document.getElementById('whoPop').hidden = true; if (p.hidden) guestPanel(p); else p.hidden = true; };
    guestState();
    document.getElementById('navRc').onclick = function (e) { e.preventDefault(); openRaceControl(); };
    document.getElementById('who').onclick = function () { var p = document.getElementById('whoPop'); if (p.hidden) names(p); else p.hidden = true; };
    document.getElementById('hubTheme').onchange = function () { try { localStorage.setItem('pw-hub-theme', this.value); } catch (e) {} applyHubTheme(); };
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
    // in the app: the window's title bar takes this theme's page background and text colour (MainWindow.OnMessage)
    var w = root.chrome && root.chrome.webview, cs = root.getComputedStyle ? getComputedStyle(document.documentElement) : null;
    if (w && w.postMessage && cs) { try { w.postMessage({ titleBar: cs.getPropertyValue('--bg').trim(), titleText: cs.getPropertyValue('--text').trim() }); } catch (e) {} }
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
      b.textContent = g.current ? 'Guest: ' + g.current : 'Guest'; b.className = 'btn' + (g.current ? ' lime' : '');
      b.title = g.current ? 'Guest mode is on: these pages show ' + g.current + '\'s laps, not yours' : 'A friend drives on your rig: keep his laps apart from yours';
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
      if (old.length) h += '<div class="pop-h" style="margin-top:16px">Earlier guests (hidden from you)</div><div class="pop-list">' + old.map(function (x) {
        return '<div class="pop-row" style="cursor:default"><span>' + esc(x.name) + '</span><small>' + esc(F.day(x.from)) + ' · ' + x.files + ' result files</small>' +
          (here ? '<button class="btn" data-del="' + esc(x.name) + '" style="padding:4px 10px">Delete</button>' : '') + '</div>';
      }).join('') + '</div>';
      p.innerHTML = h;
      function del(name) { return confirm('Delete everything of ' + name + '?\n\nHis result files (from his time at the wheel) go to the Recycle Bin, his segments are removed. Your own data stays.') ? act('do=delete&name=' + encodeURIComponent(name)) : Promise.reject(); }
      var s = document.getElementById('gStart'), st = document.getElementById('gStop'), d = document.getElementById('gDel');
      if (s) s.onclick = function () { var n = document.getElementById('gName').value.trim(); if (n) act('do=start&name=' + encodeURIComponent(n)).then(done, function () {}); };
      if (st) st.onclick = function () { act('do=stop').then(done, function () {}); };
      if (d) d.onclick = function () { var n = g.current; del(n).then(done, function () {}); };
      [].forEach.call(p.querySelectorAll('[data-del]'), function (b) { b.onclick = function () { del(b.getAttribute('data-del')).then(done, function () {}); }; });
    }, function () { p.innerHTML = '<div class="muted">Could not load guest mode.</div>'; });
  }

  // the name panel under your name: which driver names in the result files are you (Race Pace), and the results folder
  function names(p) {
    p.hidden = false; p.innerHTML = '<div class="muted">Loading...</div>';
    if (!inApp) { p.innerHTML = '<div class="muted">Open the hub in the app to set your names.</div>'; return; }
    json('api/pace?light=1').then(function (i) {
      var mine = {}, all = (i.candidates || []).slice();
      (i.names || []).forEach(function (n) { mine[n.toLowerCase()] = 1; if (!all.some(function (c) { return c.name.toLowerCase() === n.toLowerCase(); })) all.unshift({ name: n, files: 0 }); });
      p.innerHTML = '<a class="btn" href="sessions.html" style="width:100%;justify-content:center;margin-bottom:14px">My sessions: hide or delete sessions someone else drove</a><div class="pop-h">Your driver names</div><div class="muted" style="margin-bottom:10px">Tick every name you race under (online and offline). Race Pace counts only these drivers\' laps. Most seen in your result files:</div>' +
        '<div class="pop-list">' + all.map(function (c) {
          return '<label class="pop-row"><input type="checkbox" value="' + esc(c.name) + '"' + (mine[c.name.toLowerCase()] ? ' checked' : '') + '><span>' + esc(c.name) + '</span>' +
            (c.files ? '<small>' + c.files + ' files</small>' : '') + '</label>';
        }).join('') + '</div>' +
        '<label class="field" style="margin-top:12px">Add a name (exactly as in the game)<input class="input" id="popAdd" placeholder="e.g. Alex D#1234"></label>' +
        '<label class="field" style="margin-top:10px">Results folder (empty = found through Steam)<input class="input" id="popFolder" value="' + esc(i.folder || '') + '"></label>' +
        '<div class="bar" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="popCancel">Cancel</button><button class="btn lime" id="popSave">Save</button></div>';
      document.getElementById('popCancel').onclick = function () { p.hidden = true; };
      document.getElementById('popSave').onclick = function () {
        var list = [].slice.call(p.querySelectorAll('input[type=checkbox]:checked')).map(function (x) { return x.value; }), add = document.getElementById('popAdd').value.trim();
        if (add) list.push(add);
        var folder = document.getElementById('popFolder').value.trim();
        fetch('api/pace', { method: 'PUT', body: JSON.stringify({ names: list, folder: folder === (i.folder || '') ? null : folder }) })
          .then(function () { p.hidden = true; setWho(list[0]); document.dispatchEvent(new CustomEvent('pw-names')); });
      };
    }, function () { p.innerHTML = '<div class="muted">Could not load the names.</div>'; });
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
      else json('api/pace').then(done, function (e) { done({ error: String(e), sessions: [], names: [], candidates: [] }); });
    }, function (e) { done({ error: String(e), sessions: [], names: [], candidates: [] }); });
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

  P.hub = { esc: esc, json: json, header: header, setWho: setWho, live: live, openRaceControl: openRaceControl, inApp: inApp, loadPace: loadPace, watchPace: watchPace };
})(typeof window !== 'undefined' ? window : globalThis);
