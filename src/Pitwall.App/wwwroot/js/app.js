// Start-up: layout canvas + widgets + data source (live WebSocket, or demo data when opened from a folder / with ?mock).
// The saved file holds several views (views.js) and the theme; the layout manager shows the current view.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {};
  var KEY = 'pitwall.layout';
  P.localPersist = {
    load: function () { try { var t = root.localStorage.getItem(KEY); return Promise.resolve(t ? JSON.parse(t) : null); } catch (e) { return Promise.resolve(null); } },
    save: function (l) { try { root.localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {} return Promise.resolve(); }
  };
  P.httpPersist = {
    load: function () { return root.fetch('/api/layout').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); },
    save: function (l) { return root.fetch('/api/layout', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(l) }).catch(function () {}); }
  };

  function boot() {
    var doc = root.document, $ = function (id) { return doc.getElementById(id); };
    var demo = root.location.protocol === 'file:' || /[?&]mock\b/.test(root.location.search);
    // several dashboards: ?view=<name> = this page shows that view (another window, a tablet ...) and keeps its own choice; saving merges with what other
    // pages saved meanwhile (views.js merge), so editing here never overwrites another device's views
    var urlView = (function () { try { return new URLSearchParams(root.location.search).get('view'); } catch (e) { return null; } })(), base = null, chain = Promise.resolve();
    function norm(l) { return JSON.parse(JSON.stringify(P.normalizeViews(l, P.defaultLayout))); }
    var syncPersist = {
      load: function () { return P.httpPersist.load().then(function (l) { base = norm(l); return l; }); },
      save: function (file) {
        chain = chain.then(function () { return P.httpPersist.load(); }).then(function (latest) {
          var merged = P.mergeLayouts(base, file, latest ? norm(latest) : null, !!urlView);
          return P.httpPersist.save(merged).then(function () {
            base = JSON.parse(JSON.stringify(merged));
            var changed = false;                                                                      // other pages' changes into this page (not the view on screen)
            Object.keys(merged.views).forEach(function (n) { if (n !== file.current && JSON.stringify(file.views[n]) !== JSON.stringify(merged.views[n])) { file.views[n] = JSON.parse(JSON.stringify(merged.views[n])); changed = true; } });
            Object.keys(file.views).forEach(function (n) { if (!(n in merged.views) && n !== file.current) { delete file.views[n]; changed = true; } });
            if (changed) fillViews();
          });
        }).catch(function () {});
        return chain;
      }
    };
    var persist = demo ? P.localPersist : syncPersist, store = new P.Store();
    var ws = new P.Workspace(persist, P.defaultLayout), editor = new P.StyleEditor(doc.body), timer = null;
    function saveSoon() { if (timer) clearTimeout(timer); timer = setTimeout(function () { timer = null; ws.save(); }, 400); }
    var toolbar = $('toolbar'), status = $('status'), hint = $('hint'), viewSel = $('viewSel');
    var SAFE = { l: 12, t: 12, r: 12, b: 46 };                                                       // edge strips no widget can go into; the bottom one = the button bar
    var lm = new P.LayoutManager({ stage: $('stage'), canvas: $('canvas'), safe: SAFE, persist: { save: function (l) { ws.setWidgets(l.widgets); return ws.save(); } },
      onEdit: function (on) { toolbar.hidden = !on; hint.hidden = true; if (!on) editor.close(); },
      editInset: function () { return toolbar.offsetHeight ? toolbar.offsetHeight + 20 : 0; },
      onStyle: function (inst) {
        var st = inst.item.settings.style = inst.item.settings.style || { colors: {}, font: '' }, th = ws.theme();
        var parts = inst.def.colors || [], byKey = {}; parts.forEach(function (s) { byKey[s.key] = s; });
        var item = inst.item;
        editor.open({ title: inst.def.title, style: st, items: parts, note: 'This widget only. A colour you did not change follows its theme colour.',
          base: function (k) { return P.theme.themeValue(byKey[k].token, th); }, onChange: function () { lm.restyle(item.id); },
          options: P.optionStates(inst.def, item.settings),
          onShow: function (key, value) { P.setOption(inst.def, item.settings, key, value); lm.reconfigure(item.id); } });
      } });
    lm.init(); root.pitwall = lm;
    // the status line, HUB and SPECTATE live in the bottom strip of the canvas: they can never cover a widget
    var bar = P.dom.box('pw-bar', $('canvas'), 0, lm.full.h - SAFE.b, lm.full.w, SAFE.b);
    ['status', 'hint', 'netBtn', 'hubBtn', 'specBtn'].forEach(function (id) { bar.appendChild($(id)); });
    // NETWORK: this dashboard on another PC / tablet at home (the app's network access, LanAccess.cs). On this PC: shows the address and switches it;
    // opened from another PC: says so (switching and the hub window are this PC's)
    var remote = !demo && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(root.location.hostname), net = null, netPanel = null;
    function netLoad() {
      if (demo) { $('netBtn').hidden = true; return; }
      root.fetch('/api/net').then(function (r) { return r.json(); }).then(function (n) {
        net = n; var b = $('netBtn');
        b.textContent = remote ? 'ON THE NETWORK · ' + root.location.host : (n.on && n.urls.length ? 'NETWORK · ' + n.urls[0].replace(/^http:\/\/|\/$/g, '') : 'NETWORK: OFF');
        b.className = n.on || remote ? 'on' : '';
        if (netPanel) netOpen();
      }, function () {});
    }
    function netDo(what) {
      return root.fetch('/api/net?do=' + what, { method: 'POST' }).then(function (r) { return r.json(); }).then(function (x) {
        if (x.result === 'setup' && root.confirm('Windows has to allow this once: an admin prompt follows.\n\nIt lets My LMU Hub use port ' + x.info.port + ' for your home network and opens the firewall for it on PRIVATE networks only (home / work, not public Wi-Fi).')) return netDo('setup');
        if (x.result && x.result !== 'setup') root.alert('Network access did not start: ' + x.result);
        netLoad();
      });
    }
    function netOpen() {
      editor.close(); if (netPanel) netPanel.remove();
      var p = netPanel = doc.createElement('div'); p.className = 'pw-panel'; doc.body.appendChild(p);
      var n = net || { on: false, urls: [] }, esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
      // a dashboard per device / window: every view has its own address (?view=); on this PC a view can also get its own window
      var base0 = remote ? root.location.origin + '/' : (n.on && n.urls.length ? n.urls[0] : null), names = ws.names();
      function addr(v) { return base0 + 'index.html?view=' + encodeURIComponent(v); }
      var perView = '<div class="pw-panel-sec">A view per screen / device</div><div class="pw-panel-note">Each view has its own address: open a different view on each device (all at the same time, same port). ' +
        'Switching views there changes only that device.</div>' + names.map(function (v) {
          return '<div class="pw-panel-row set"><span>' + esc(v) + (base0 ? '<br><small style="user-select:all;font-size:12px;color:var(--label)">' + esc(addr(v)) + '</small>' : '') + '</span>' +
            (base0 ? '<button data-copy="' + esc(addr(v)) + '">Copy</button>' : '') + (remote ? '' : '<button data-win="' + esc(v) + '" title="Open this view in its own window on this PC (for another monitor)">Window</button>') + '</div>';
        }).join('');
      p.innerHTML = '<div class="pw-panel-head"><b>Network</b><button class="pw-panel-x">×</button></div>' + (remote
        ? '<div class="pw-panel-note">You are watching the dashboard of the PC at ' + esc(root.location.host) + '. Edit mode (E) works here too: changes are saved on that PC. Switching network access is done on that PC.</div>' + perView
        : '<div class="pw-panel-note">Open this dashboard in a browser on another PC, laptop or tablet at home: same views, live, and you can edit the layout there (E). ' +
          'My LMU Hub has to run on this PC (the hub window may be minimised; this Race Control window does not need to be open).</div>' +
          (n.on ? '<div class="pw-panel-sec">Open in the other browser</div>' + (n.urls.length ? n.urls.map(function (u) { return '<div class="pw-panel-row set"><span style="user-select:all;font-size:16px">' + esc(u) + '</span><button data-copy="' + esc(u) + '">Copy</button></div>'; }).join('') : '<div class="pw-panel-note">No network address found (is this PC on a network?).</div>') +
            '<div class="pw-panel-foot"><button data-net="off">Turn off</button></div>'
          : (n.error ? '<div class="pw-panel-note" style="color:#FF6A55">' + esc(n.error) + '</div>' : '') + '<div class="pw-panel-foot"><button data-net="on">Turn on</button></div>') + perView);
      p.onclick = function (ev) {
        var t = ev.target; if (t.classList.contains('pw-panel-x')) { p.remove(); netPanel = null; return; }
        var d = t.getAttribute('data-net'); if (d) { t.disabled = true; t.textContent = 'one moment...'; netDo(d); }
        var c = t.getAttribute('data-copy'); if (c) copy(c, t);
        var w = t.getAttribute('data-win'); if (w) { lm.flush(); root.fetch('/api/open?what=racecontrol&view=' + encodeURIComponent(w), { method: 'POST' }); }
      };
    }
    // copy an address (clipboard; an older browser: the copy command on a hidden field), the button says so for a moment
    function copy(text, btn) {
      function done(ok) { if (!btn) return; var was = btn.textContent; btn.textContent = ok ? 'Copied' : 'Select + Ctrl+C'; setTimeout(function () { btn.textContent = was; }, 1500); }
      function old() { var a = doc.createElement('textarea'); a.value = text; a.style.position = 'fixed'; a.style.opacity = '0'; doc.body.appendChild(a); a.select(); var ok = false; try { ok = doc.execCommand('copy'); } catch (e) {} a.remove(); done(ok); }
      if (root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(text).then(function () { done(true); }, old); else old();
    }
    $('netBtn').onclick = function () { if (netPanel) { netPanel.remove(); netPanel = null; } else netOpen(); };
    netLoad(); if (!demo) setInterval(netLoad, 30000);
    var spec = new P.Spectate({ parent: doc.body, button: $('specBtn'),
      load: demo ? function () { return Promise.reject(); } : function () { return root.fetch('/api/spectate').then(function (r) { return r.json(); }); },
      choose: function (t) { return root.fetch('/api/spectate', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t || {}) }); } });
    // HUB: open the hub window (this window stays); opened from disk = the hub page
    $('hubBtn').onclick = function () { if (demo || remote) root.location.href = 'home.html'; else root.fetch('/api/open?what=hub', { method: 'POST' }); };   // from another PC: the hub page here
    store.subscribe(function (s) {
      lm.update(s); spec.update(s);
      status.textContent = s.status === 'demo' ? 'DEMO DATA – keys 1-5 switch scenario, E edits the layout' : (s.standings ? '' : (s.status === 'live' ? 'WAITING FOR LE MANS ULTIMATE…' : 'CONNECTING…'));
    });

    // views
    function fillViews() {
      viewSel.textContent = '';
      ws.names().forEach(function (n) { var o = doc.createElement('option'); o.value = n; o.textContent = n; viewSel.appendChild(o); });
      viewSel.value = ws.file.current;
    }
    function show() {
      editor.close(); lm.setLayout(ws.current()); fillViews();
      if (urlView !== null && root.history && root.history.replaceState) { urlView = ws.file.current; try { root.history.replaceState(null, '', '?view=' + encodeURIComponent(urlView)); } catch (e) {} }   // this page keeps its own view
      ws.save();
    }
    viewSel.addEventListener('change', function () { lm.flush(); if (ws.select(viewSel.value)) show(); });
    $('viewNew').addEventListener('click', function () {
      var n = root.prompt('Name of the new view (starts as a copy of this one)', ''); if (n === null) return;
      var why = ws.create(n); if (why) root.alert(why); else show();
    });
    $('viewRename').addEventListener('click', function () {
      var n = root.prompt('New name for "' + ws.file.current + '"', ws.file.current); if (n === null || n.trim() === ws.file.current) return;
      var why = ws.rename(n); if (why) root.alert(why); else { fillViews(); ws.save(); }
    });
    $('viewDelete').addEventListener('click', function () {
      if (!root.confirm('Delete the view "' + ws.file.current + '"?')) return;
      var why = ws.remove(); if (why) root.alert(why); else show();
    });
    // theme
    function openTheme() {
      var th = ws.theme();
      editor.open({ title: 'Theme', style: th, items: P.theme.items, foldColors: false,
        note: 'Pick a theme, then change what you like (all views). A widget part changed in its own ⚙ keeps its colour.',
        base: function (k) { return P.theme.themeValue(k, th); }, onChange: function () { P.theme.applyTheme(doc.documentElement, th); saveSoon(); },
        options: P.theme.themeOptions(th),
        onShow: function (key, v) {
          P.theme.setThemeOption(th, key, v); P.theme.applyTheme(doc.documentElement, th); saveSoon();
          if (key === 'textSize') lm.setLayout(ws.current());                                  // every widget drawn again at the new text size
          if (key === 'preset') openTheme();
        } });
    }
    $('themeBtn').addEventListener('click', openTheme);

    // sharing: Export = a file with all views + the theme (not your hotkeys); Import = adds the views of such a file (and its theme, when you say so)
    $('exportBtn').addEventListener('click', function () {
      lm.flush();
      var blob = new root.Blob([JSON.stringify(ws.exportData(), null, 1)], { type: 'application/json' }), a = doc.createElement('a');
      a.href = root.URL.createObjectURL(blob); a.download = 'My LMU Hub layout.json'; doc.body.appendChild(a); a.click();
      setTimeout(function () { root.URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
    $('importBtn').addEventListener('click', function () { $('importFile').value = ''; $('importFile').click(); });
    $('importFile').addEventListener('change', function () {
      var file = this.files && this.files[0]; if (!file) return;
      var rd = new root.FileReader();
      rd.onload = function () {
        var data; try { data = JSON.parse(rd.result); } catch (e) { root.alert('That is not a layout file.'); return; }
        if (!data || !data.views) { root.alert('That is not a layout file.'); return; }
        var theme = data.theme && root.confirm('Also use the theme (colours, fonts) of this layout?');
        lm.flush(); var added = ws.importData(data, theme);
        if (!added.length) { root.alert('No views in that file.'); return; }
        if (theme) P.theme.applyTheme(doc.documentElement, ws.theme());
        show(); root.alert('Added: ' + added.join(', '));
      };
      rd.readAsText(file);
    });

    // hotkeys: a key per view + one for "next view" (views.js). In the app they are also registered with Windows (MainWindow), so they work while the
    // game has the keyboard; the app answers { hotkey: combo }. Here: the same keys while this page has the keyboard.
    var webview = root.chrome && root.chrome.webview, capture = null, keysPanel = null, padDevices = null;
    function switchTo(target) {
      if (!target) return;
      var name = target === '>' ? ws.nextName() : target;
      if (name === ws.file.current) return;
      lm.flush(); if (ws.select(name)) show();
    }
    function sendKeys() {
      if (!webview || !webview.postMessage || urlView) return;                                        // global hotkeys: the main Race Control window only
      var k = ws.file.keys, list = [];
      if (k.next) list.push(k.next); for (var v in k.views) list.push(k.views[v]);
      try { webview.postMessage({ hotkeys: list }); } catch (e) {}
    }
    if (webview && webview.addEventListener) webview.addEventListener('message', function (ev) {
      var d = ev.data || {};
      if (d.hotkey) switchTo(ws.keyTarget(d.hotkey));
      if (d.hotkeysFailed) { failed = d.hotkeysFailed; if (keysPanel) openKeys(); }
      if (d.padDevices) { padDevices = d.padDevices; if (keysPanel && capture !== null) openKeys(); }   // the controllers the app sees (while waiting for a button)
      if (d.padLearned && capture !== null) { ws.setKey(capture, d.padLearned, d.padName); stopCapture(); ws.save(); sendKeys(); openKeys(); }   // a wheel / button box button
    });
    var failed = [];
    // setting a hotkey: a key here, or (in the app) a button on any game controller: the app watches them while this waits
    function startCapture(target) { capture = target; padDevices = null; if (webview && webview.postMessage) try { webview.postMessage({ padLearn: true }); } catch (e) {} }
    function stopCapture() { capture = null; if (webview && webview.postMessage) try { webview.postMessage({ padLearn: false }); } catch (e) {} }
    function openKeys() {
      editor.close(); if (keysPanel) keysPanel.remove();
      var p = keysPanel = doc.createElement('div'); p.className = 'pw-panel'; doc.body.appendChild(p);
      var k = ws.file.keys, rows = [['>', 'Next view (goes round)', k.next]].concat(ws.names().map(function (n) { return [n, n, k.views[n] || '']; }));
      p.innerHTML = '<div class="pw-panel-head"><b>Hotkeys: switch views</b><button class="pw-panel-x">×</button></div>' +
        '<div class="pw-panel-note">Click Set, then press a key (letters, digits, F1-F24 or numpad, with Ctrl / Alt / Shift) or a button on your wheel, button box or gamepad. ' +
        'They work while you drive (the game has the focus): pick a key or button the game does not use, for example Ctrl+Alt+1. Esc = cancel.</div>' +
        (capture !== null && padDevices ? '<div class="pw-panel-note">Controllers found: ' + (padDevices.length ? padDevices.join(', ').replace(/&/g, '&amp;').replace(/</g, '&lt;') : 'none') + '</div>' : '') +
        rows.map(function (r, i) {
          var bad = r[2] && failed.indexOf(r[2]) >= 0;
          return '<div class="pw-panel-row' + (r[2] ? ' set' : '') + '"><span>' + r[1].replace(/</g, '&lt;') + '</span><b style="min-width:92px;text-align:right' + (bad ? ';color:#FF6A55' : '') + '"' +
            (bad ? ' title="Windows refused it: another program uses this key"' : '') + '>' + (capture === r[0] ? 'press a key or button…' : (ws.keyLabel(r[2]) || '-')).replace(/</g, '&lt;') + (bad ? ' (in use)' : '') + '</b>' +
            '<button data-set="' + i + '">Set</button><button data-clear="' + i + '"' + (r[2] ? '' : ' disabled') + '>×</button></div>';
        }).join('');
      p.onclick = function (ev) {
        var t = ev.target;
        if (t.classList.contains('pw-panel-x')) { stopCapture(); p.remove(); keysPanel = null; return; }
        var s = t.getAttribute('data-set'), c = t.getAttribute('data-clear');
        if (s !== null) { startCapture(rows[+s][0]); openKeys(); }
        if (c !== null) { ws.setKey(rows[+c][0], ''); ws.save(); sendKeys(); openKeys(); }
      };
    }
    $('keysBtn').addEventListener('click', openKeys);
    doc.addEventListener('keydown', function (ev) {
      var tag = ev.target && ev.target.tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (capture !== null) {
        if (ev.key === 'Escape') { stopCapture(); openKeys(); ev.preventDefault(); ev.stopPropagation(); return; }
        var combo = P.comboOf(ev); if (!combo) return;
        ws.setKey(capture, combo); stopCapture(); failed = []; ws.save(); sendKeys(); openKeys(); ev.preventDefault(); ev.stopPropagation(); return;
      }
      var target = ws.keyTarget(P.comboOf(ev));
      if (target) { switchTo(target); ev.preventDefault(); ev.stopPropagation(); return; }
      if (ev.code === 'Space' && lm.edit && !ev.repeat) { doc.body.classList.add('preview'); lm.fit(); ev.preventDefault(); }   // hold Space: as it looks full screen
    }, true);
    doc.addEventListener('keyup', function (ev) { if (ev.code === 'Space' && doc.body.classList.contains('preview')) { doc.body.classList.remove('preview'); lm.fit(); } });

    // + Add widget: a popup with every widget; a click adds it
    var addPanel = null;
    function closeAdd() { if (addPanel) { addPanel.remove(); addPanel = null; } }
    $('addBtn').addEventListener('click', function () {
      if (addPanel) { closeAdd(); return; }
      editor.close(); var p = addPanel = doc.createElement('div'); p.className = 'pw-panel'; doc.body.appendChild(p);
      var types = Object.keys(P.widgets).sort(function (a, b) { return P.widgets[a].title.localeCompare(P.widgets[b].title); });
      p.innerHTML = '<div class="pw-panel-head"><b>Add a widget</b><button class="pw-panel-x">×</button></div>' +
        types.map(function (t) { return '<button class="pw-add-item" data-add="' + t + '">' + P.widgets[t].title.replace(/</g, '&lt;') + '</button>'; }).join('');
      p.onclick = function (ev) {
        var t = ev.target;
        if (t.classList.contains('pw-panel-x')) { closeAdd(); return; }
        var a = t.getAttribute('data-add'); if (a) { lm.addWidget(a); closeAdd(); }
      };
    });
    // Auto align: asks the space, then evens out the gaps
    var alignGap = 10;
    $('alignBtn').addEventListener('click', function () {
      var v = root.prompt('Space between widgets (px on the 2560 x 1440 dashboard):', String(alignGap)); if (v === null) return;
      var g = parseInt(v, 10); if (!(g >= 0 && g <= 100)) { root.alert('Give a number from 0 to 100.'); return; }
      alignGap = g; lm.align(g);
    });
    $('gridSel').addEventListener('change', function (e) { lm.setGrid(parseInt(e.target.value, 10) || 1); });
    $('resetBtn').addEventListener('click', function () { editor.close(); lm.setLayout(P.defaultLayout()); lm.save(); });
    $('doneBtn').addEventListener('click', function () { lm.setEdit(false); lm.flush(); });
    persist.load().then(function (l) {
      ws.load(l); if (urlView && ws.file.views[urlView]) ws.file.current = urlView;                   // ?view=: this page's own view
      P.theme.applyTheme(doc.documentElement, ws.theme()); lm.setLayout(ws.current()); fillViews(); sendKeys();
      if (demo) P.mock.start(store, (/[?&]scenario=(\w+)/.exec(root.location.search) || [])[1]); else P.connect(store);
      setTimeout(function () { hint.hidden = true; }, 7000);
    });
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
