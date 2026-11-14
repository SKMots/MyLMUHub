// Start-up: layout canvas + widgets + data source (live WebSocket, or demo data when opened from a folder / with ?mock).
// The saved file holds several views (views.js) and the theme; the layout manager shows the current view.
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  var KEY = 'pitwall.layout';
  P.pageId = 'p' + Math.random().toString(36).slice(2, 10);                            // sent with a layout save: the app tells the other pages, this one skips its own
  P.localPersist = {
    load: function () { try { var t = root.localStorage.getItem(KEY); return Promise.resolve(t ? JSON.parse(t) : null); } catch (e) { return Promise.resolve(null); } },
    save: function (l) { try { root.localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {} return Promise.resolve(); }
  };
  P.httpPersist = {
    load: function () { return root.fetch('/api/layout').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); },
    save: function (l) { return root.fetch('/api/layout', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Page': P.pageId }, body: JSON.stringify(l) }).catch(function () {}); }
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
    var lm = new P.LayoutManager({ stage: $('stage'), canvas: $('canvas'), safe: SAFE, persist: { save: function (l) { ws.setArrangement(kind, l.widgets); return ws.save(); } },
      onEdit: function (on) { toolbar.hidden = !on; hint.hidden = true; if (!on) editor.close(); },
      editInset: function () { return toolbar.offsetHeight ? toolbar.offsetHeight + 20 : 0; },
      onCanvas: function (c) { if (bar) { bar.style.top = (c.h - SAFE.b) + 'px'; bar.style.width = c.w + 'px'; } fillShape(); },
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
    var bar = null; bar = P.dom.box('pw-bar', $('canvas'), 0, lm.full.h - SAFE.b, lm.full.w, SAFE.b);
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
    // another page saved the layout file (the hub's Race Control page: theme, text size, hotkeys, which view to show): take those over
    var lastMsg = 0;
    function fromFile() {
      if (demo) return;
      P.httpPersist.load().then(function (latest) {
        if (!latest) return;
        var n = norm(latest), f = ws.file, oldTh = JSON.stringify(f.theme), oldSize = f.theme && f.theme.textSize;
        f.theme = n.theme; f.keys = n.keys; if (base) { base.theme = JSON.parse(JSON.stringify(n.theme)); base.keys = JSON.parse(JSON.stringify(n.keys)); }
        Object.keys(n.views).forEach(function (v) { if (v !== f.current) f.views[v] = n.views[v]; });
        Object.keys(f.views).forEach(function (v) { if (!(v in n.views) && v !== f.current) delete f.views[v]; });
        if (JSON.stringify(f.theme) !== oldTh) { P.theme.applyTheme(doc.documentElement, f.theme); if ((f.theme && f.theme.textSize) !== oldSize) lm.setLayout(onScreen()); }
        sendKeys();
        if (!urlView && !lm.edit && n.current !== f.current && f.views[n.current]) { lm.flush(); if (ws.select(n.current)) show(); } else fillViews();
      });
    }
    store.subscribe(function (s) {
      if (s.layoutMsg && s.layoutMsg.at !== lastMsg) { lastMsg = s.layoutMsg.at; if (s.layoutMsg.by !== P.pageId) fromFile(); }
      lm.update(s); spec.update(s);
      status.textContent = s.status === 'demo' ? 'DEMO DATA – keys 1-5 switch scenario, E edits the layout' : (s.standings ? '' : (s.status === 'live' ? 'WAITING FOR LE MANS ULTIMATE…' : 'CONNECTING…'));
    });

    // views
    function fillViews() {
      viewSel.textContent = '';
      ws.names().forEach(function (n) { var o = doc.createElement('option'); o.value = n; o.textContent = n; viewSel.appendChild(o); });
      viewSel.value = ws.file.current;
    }
    // screen shapes: the dashboard fills its window; the view on screen in its arrangement for this kind of screen (views.js), made from the main layout the
    // first time (reflowWidgets) and saved. kind = the arrangement being shown (and edited)
    var kind = 'wide', made = false;
    function onScreen() {
      var w = root.innerWidth || 2560, h = root.innerHeight || 1440, c = P.shapeFor(w, h), k = P.shapeClass(w, h), a = ws.arrangement(k);
      if (!a) { a = P.reflowWidgets(JSON.parse(JSON.stringify(ws.current().widgets)), c.w - SAFE.l - SAFE.r, c.h - SAFE.t - SAFE.b); ws.setArrangement(k, a); made = true; }
      kind = k; return { widgets: a, canvas: c };
    }
    function fillShape() {
      var main = kind === ws.baseKind();
      $('shapeLbl').textContent = 'Layout for this ' + P.shapeLabel(kind) + (main ? ' (main)' : '');
      $('shapeReset').hidden = main;
    }
    function showLayout() { lm.setLayout(onScreen()); fillShape(); if (made) { made = false; lm.save(); } }
    $('shapeReset').addEventListener('click', function () {
      if (!root.confirm('Start this ' + P.shapeLabel(kind) + ' layout again from the main layout of "' + ws.file.current + '"?')) return;
      editor.close(); ws.resetArrangement(kind); showLayout();
    });
    // the window changed size: the canvas follows its shape (another kind of screen: that arrangement)
    var resizeT = null, lastWin = (root.innerWidth || 0) + 'x' + (root.innerHeight || 0);
    if (root.addEventListener) root.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () { var now = root.innerWidth + 'x' + root.innerHeight; if (now === lastWin) return; lastWin = now; lm.flush(); showLayout(); }, 300);
    });
    function show() {
      editor.close(); showLayout(); fillViews();
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
          if (key === 'textSize') lm.setLayout(onScreen());                                    // every widget drawn again at the new text size
          if (key === 'preset') openTheme();
        } });
    }
    $('themeBtn').addEventListener('click', openTheme);

    // hotkeys: a key per view and one for "next view" (views.js; set on the hub's Race Control page). In the app they are also
    // registered with Windows (MainWindow), so they work while the game has the keyboard; the app answers { hotkey: combo }. Here: the same keys while
    // this page has the keyboard.
    var webview = root.chrome && root.chrome.webview;
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
      if (d.hotkeysFailed) root.fetch('/api/hotkey-status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ failed: d.hotkeysFailed, at: Date.now() }) }).catch(function () {});   // shown on the hub's Race Control page
    });
    doc.addEventListener('keydown', function (ev) {
      var tag = ev.target && ev.target.tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
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
    $('resetBtn').addEventListener('click', function () {
      editor.close(); var d = P.defaultLayout().widgets, c = P.shapeFor(root.innerWidth, root.innerHeight);
      if (kind !== 'wide') P.reflowWidgets(d, c.w - SAFE.l - SAFE.r, c.h - SAFE.t - SAFE.b);
      lm.setLayout({ widgets: d, canvas: c }); lm.save();
    });
    $('doneBtn').addEventListener('click', function () { lm.setEdit(false); lm.flush(); });
    persist.load().then(function (l) {
      ws.load(l); if (urlView && ws.file.views[urlView]) ws.file.current = urlView;                   // ?view=: this page's own view
      P.theme.applyTheme(doc.documentElement, ws.theme()); showLayout(); fillViews(); sendKeys();
      if (demo) P.mock.start(store, (/[?&]scenario=(\w+)/.exec(root.location.search) || [])[1]); else P.connect(store);
      setTimeout(function () { hint.hidden = true; }, 7000);
    });
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
