// Views: several named layouts in one file (layout.json), plus the page theme. Pure logic (unit-tested in tests/js).
// File: { version: 2, current: 'Driving', views: { 'Driving': { widgets: [...] }, ... }, theme: { colors: {}, font: '' },
//        keys: { next: 'Ctrl+Alt+N', views: { 'Driving': 'Ctrl+Alt+1' } } }   (hotkeys: a view / the next view; app.js, MainWindow registers them globally)
// A version-1 file ({ widgets: [...] }) becomes the view "Default".
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  // screen shapes (owner 2026-11-13: portrait and ultrawide screens, no setting to pick): the dashboard always fills its window; the canvas has the window's
  // shape (landscape 1440 high, portrait 1440 wide, so widgets keep their size). A view keeps one arrangement per kind of screen: its main one (widgets, made
  // on 'base', default 16:9) and the others in shapes[kind].widgets, made from the main one the first time that kind of screen shows the view.
  var KINDS = [['portrait', 'portrait screen'], ['square', '4:3 screen'], ['wide', '16:9 screen'], ['ultrawide', 'ultrawide screen (21:9)'], ['superwide', 'super ultrawide screen (32:9)']];
  function shapeClass(w, h) { var a = w > 0 && h > 0 ? w / h : 16 / 9; return a < 0.9 ? 'portrait' : a < 1.5 ? 'square' : a < 2.05 ? 'wide' : a < 2.9 ? 'ultrawide' : 'superwide'; }
  function shapeFor(w, h) { var a = w > 0 && h > 0 ? w / h : 16 / 9; return a >= 1 ? { w: Math.round(1440 * a), h: 1440 } : { w: 1440, h: Math.round(1440 / a) }; }
  function shapeLabel(k) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === k) return KINDS[i][1]; return k; }
  function isKind(k) { return KINDS.some(function (x) { return x[0] === k; }); }
  function normalize(raw, fallback) {
    var f = { version: 2, current: '', views: {}, theme: { colors: {}, font: '' }, keys: { next: '', views: {}, labels: {} } };
    if (raw && raw.views && typeof raw.views === 'object') {
      for (var n in raw.views) if (raw.views[n] && Array.isArray(raw.views[n].widgets)) {
        var rv = raw.views[n]; f.views[n] = { widgets: rv.widgets };
        if (isKind(rv.base) && rv.base !== 'wide') f.views[n].base = rv.base;                                                // the kind of screen it was made on
        for (var k in rv.shapes || {}) if (isKind(k) && rv.shapes[k] && Array.isArray(rv.shapes[k].widgets)) (f.views[n].shapes = f.views[n].shapes || {})[k] = { widgets: rv.shapes[k].widgets };
      }
      f.current = raw.current;
      if (raw.theme) {
        f.theme = { colors: Object.assign({}, raw.theme.colors), font: raw.theme.font || '' };
        ['preset', 'radius', 'strips', 'look', 'texture', 'backdrop', 'icons', 'logos', 'textSize'].forEach(function (k) { if (raw.theme[k] !== undefined) f.theme[k] = raw.theme[k]; });   // theme preset (theme.js)
      }
      if (raw.keys && typeof raw.keys === 'object') {
        f.keys.next = typeof raw.keys.next === 'string' ? raw.keys.next : '';
        for (var v in raw.keys.views || {}) if (f.views[v] && typeof raw.keys.views[v] === 'string' && raw.keys.views[v]) f.keys.views[v] = raw.keys.views[v];
        var used = [f.keys.next].concat(Object.keys(f.keys.views).map(function (n) { return f.keys.views[n]; }));
        for (var c in raw.keys.labels || {}) if (used.indexOf(c) >= 0 && typeof raw.keys.labels[c] === 'string') f.keys.labels[c] = raw.keys.labels[c];   // controller button names
      }
    } else if (raw && Array.isArray(raw.widgets) && raw.widgets.length) f.views.Default = { widgets: raw.widgets };
    if (!Object.keys(f.views).length) f.views.Default = { widgets: fallback().widgets };
    if (!f.views[f.current]) f.current = Object.keys(f.views)[0];
    return f;
  }

  function Workspace(persist, fallback) { this.persist = persist; this.fallback = fallback; this.file = normalize(null, fallback); }
  var W = Workspace.prototype;
  W.load = function (raw) { this.file = normalize(raw, this.fallback); return this.file; };
  W.names = function () { return Object.keys(this.file.views); };
  W.current = function () { return this.file.views[this.file.current]; };
  W.theme = function () { return this.file.theme; };
  W.setWidgets = function (widgets) { this.current().widgets = widgets; };
  // the current view's arrangement for a kind of screen: its widgets, or null = none yet (the page makes one from the main layout)
  W.baseKind = function () { return this.current().base || 'wide'; };
  W.arrangement = function (kind) { var v = this.current(); return kind === this.baseKind() ? v.widgets : v.shapes && v.shapes[kind] ? v.shapes[kind].widgets : null; };
  W.setArrangement = function (kind, widgets) { var v = this.current(); if (kind === this.baseKind()) v.widgets = widgets; else (v.shapes = v.shapes || {})[kind] = { widgets: widgets }; };
  W.resetArrangement = function (kind) { var v = this.current(); if (v.shapes && v.shapes[kind]) { delete v.shapes[kind]; if (!Object.keys(v.shapes).length) delete v.shapes; } };
  // a new / renamed view's name: '' = fine, else why not
  W.check = function (name) {
    var n = String(name || '').trim();
    if (!n) return 'empty name'; if (n.length > 40) return 'name too long'; if (this.file.views[n]) return '"' + n + '" already exists'; return '';
  };
  W.select = function (name) { if (!this.file.views[name]) return false; this.file.current = name; return true; };
  // new view: a copy of the current one (empty = no widgets)
  W.create = function (name, empty) {
    var why = this.check(name); if (why) return why; name = String(name).trim();
    var cur = this.current(), v = this.file.views[name] = { widgets: empty ? [] : copy(cur.widgets) };
    if (!empty) { if (cur.base) v.base = cur.base; if (cur.shapes) v.shapes = copy(cur.shapes); }
    this.file.current = name; return '';
  };
  W.rename = function (name) {
    var why = this.check(name); if (why) return why; name = String(name).trim();
    var views = {}, cur = this.file.current;                                   // rebuild to keep the order
    for (var n in this.file.views) views[n === cur ? name : n] = this.file.views[n];
    var k = this.file.keys.views; if (k[cur]) { k[name] = k[cur]; delete k[cur]; }                // the hotkey goes with the view
    this.file.views = views; this.file.current = name; return '';
  };
  W.remove = function () {
    var names = this.names(); if (names.length < 2) return 'the last view cannot be deleted';
    var i = names.indexOf(this.file.current); delete this.file.views[this.file.current]; delete this.file.keys.views[this.file.current];
    this.file.current = this.names()[Math.max(0, i - 1)]; return '';
  };
  // hotkeys: set / clear (combo '' = none) for a view or 'next'; a combo belongs to one thing only. The view a combo opens: name, '>' = the next view, null = none.
  W.setKey = function (target, combo, label) {
    var k = this.file.keys; combo = String(combo || ''); k.labels = k.labels || {};
    if (combo && label) k.labels[combo] = label;
    if (combo) { if (k.next === combo) k.next = ''; for (var v in k.views) if (k.views[v] === combo) delete k.views[v]; }
    if (target === '>') k.next = combo; else if (this.file.views[target]) { if (combo) k.views[target] = combo; else delete k.views[target]; }
  };
  W.keyTarget = function (combo) {
    if (!combo) return null; var k = this.file.keys; if (k.next === combo) return '>';
    for (var v in k.views) if (k.views[v] === combo) return v; return null;
  };
  // how a hotkey is shown: a controller button by its device name ('Fanatec ... · button 12'), a key as itself
  W.keyLabel = function (combo) { return combo ? ((this.file.keys.labels || {})[combo] || combo) : ''; };
  W.nextName = function () { var n = this.names(), i = n.indexOf(this.file.current); return n[(i + 1) % n.length]; };
  // sharing: a file with views + theme (not your hotkeys); importing adds its views (a name that exists gets " (2)", " (3)" ...), the theme only when asked.
  // Returns the names added; '' / [] = nothing usable in it.
  W.exportData = function (names) {
    var out = { pitwallLayout: 1, views: {}, theme: copy(this.file.theme) }, self = this;
    (names || this.names()).forEach(function (n) { if (self.file.views[n]) out.views[n] = copy(self.file.views[n]); });
    return out;
  };
  W.importData = function (data, takeTheme) {
    var f = normalize(data && data.views ? data : null, function () { return { widgets: [] }; }), added = [], self = this;
    if (!data || !data.views) return added;
    Object.keys(f.views).forEach(function (n) {
      var name = n, i = 2; while (self.file.views[name]) name = n + ' (' + (i++) + ')';
      self.file.views[name] = copy(f.views[n]); added.push(name);
    });
    if (takeTheme && data.theme) this.file.theme = f.theme;
    if (added.length) this.file.current = added[0];
    return added;
  };
  W.save = function () { return this.persist ? this.persist.save(this.file) : null; };

  // a key press -> its hotkey name ('Ctrl+Alt+1', 'Shift+F5', 'Num3'); null = only a modifier, or a key a hotkey cannot use. Letters, digits, F1-F24, numpad digits.
  function comboOf(ev) {
    var c = ev.code || '', m = /^Key([A-Z])$/.exec(c) || /^Digit([0-9])$/.exec(c) || /^(F(?:[1-9]|1[0-9]|2[0-4]))$/.exec(c), key = m ? m[1] : null;
    var n = /^Numpad([0-9])$/.exec(c); if (n) key = 'Num' + n[1];
    if (!key) return null;
    return (ev.ctrlKey ? 'Ctrl+' : '') + (ev.altKey ? 'Alt+' : '') + (ev.shiftKey ? 'Shift+' : '') + key;
  }

  // several dashboards on one layout file (other windows / devices on the network save too): a three-way merge so nobody overwrites the others.
  // base = the file as this page last loaded / saved it, mine = this page's file now, latest = the file on disk now. What THIS page changed since base wins
  // (a view's widgets, a new / deleted / renamed view, the theme, the hotkeys); everything else keeps the latest. ownCurrent = this page shows its own view
  // (opened with ?view=): the file's default view is then left as it is.
  function merge(base, mine, latest, ownCurrent) {
    base = base || { views: {} }; latest = latest || mine;
    function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    var out = copy(latest); out.views = {};
    Object.keys(latest.views || {}).forEach(function (n) {
      if (n in base.views && !(n in mine.views)) return;                                 // deleted (or renamed) here
      out.views[n] = n in mine.views && !same(mine.views[n], base.views[n]) ? copy(mine.views[n]) : copy(latest.views[n]);
    });
    Object.keys(mine.views).forEach(function (n) { if (!(n in out.views) && (!(n in base.views) || !same(mine.views[n], base.views[n]))) out.views[n] = copy(mine.views[n]); });   // new here
    ['theme', 'keys'].forEach(function (k) { if (!same(mine[k], base[k])) out[k] = copy(mine[k]); });
    if (!ownCurrent && mine.current !== base.current) out.current = mine.current;
    if (!out.views[out.current]) out.current = Object.keys(out.views)[0];
    return out;
  }

  P.shapeClass = shapeClass; P.shapeFor = shapeFor; P.shapeLabel = shapeLabel;
  P.Workspace = Workspace; P.normalizeViews = normalize; P.comboOf = comboOf; P.mergeLayouts = merge;
  if (typeof module !== 'undefined') module.exports = { Workspace: Workspace, normalize: normalize, comboOf: comboOf, merge: merge };
})(typeof window !== 'undefined' ? window : globalThis);
