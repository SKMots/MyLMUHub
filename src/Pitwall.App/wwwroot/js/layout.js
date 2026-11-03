// Layout manager: places widgets on a fixed design canvas (2560 x 1440 by default) that is scaled to fit the window.
// Edit mode (key E): drag a widget to move it, drag a handle to resize it, Del removes it, arrow keys nudge, "+ Add" adds one, the gear edits its colours / font.
// Layout is saved as JSON (one view; views.js keeps several).
// Moving / resizing locks onto the grid and onto the other widgets' edges (orange guide line); hold Alt to place freely.
// Ctrl+click selects several widgets: they move and resize as one box (each scales with it). Widgets in the way are pushed aside (and push the next);
// moving where they cannot be pushed (canvas border, a full dashboard), they jump aside instead: to a free place, the place the moved one left (a swap,
// resized to it when needed) or they shrink around it (layoutMath.arrange). Resizing still stops at the border. Widgets never overlap unless Alt is held.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, M = P.layoutMath, D = P.dom;
  var HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  function LayoutManager(o) {
    this.win = o.win || root; this.stage = o.stage; this.canvas = o.canvas; this.persist = o.persist; this.registry = o.registry || P.widgets;
    // safe = strips kept free at the canvas edges (left / top / right / bottom, canvas px: the bottom one holds the HUB / SPECTATE buttons); widgets live in
    // the area inside, and all their coordinates are relative to it (this.design = its size; this.full = the whole canvas)
    var full = o.design || { w: 2560, h: 1440 }, sf = o.safe || { l: 0, t: 0, r: 0, b: 0 }; this.full = full; this.safe = sf;
    this.design = { w: full.w - sf.l - sf.r, h: full.h - sf.t - sf.b }; this.grid = 10; this.edit = false; this.k = 1; this.inst = {}; this.order = []; this.sel = null;
    this.layout = { version: 1, design: this.design, widgets: [] }; this.state = null; this.timer = null; this.onEdit = o.onEdit || function () {};
    this.onStyle = o.onStyle || function () {};                                                          // the gear on a widget (edit mode): open its style editor
    this.editInset = o.editInset || function () { return 0; };                                           // window px kept free at the top in edit mode (the toolbar)
    this.canvas.style.width = full.w + 'px'; this.canvas.style.height = full.h + 'px'; this.canvas.style.transformOrigin = '0 0';
    this.area = D.box('pw-area', this.canvas, sf.l, sf.t, this.design.w, this.design.h);
    this.snapTol = 16;                                                                                   // canvas px: how close an edge must come to lock onto another widget
    this.guideX = D.box('pw-guide pw-guide-x', this.area, 0, 0, 2, this.design.h); this.guideY = D.box('pw-guide pw-guide-y', this.area, 0, 0, this.design.w, 2);
    D.show(this.guideX, false); D.show(this.guideY, false);
    this.setGrid(this.grid);
    this.selected = [];                                                                                  // ids; Ctrl+click adds / removes, a click on the empty canvas clears
    var self = this;
    if (this.canvas.addEventListener) this.canvas.addEventListener('pointerdown', function (ev) { if (self.edit && (ev.target === self.canvas || ev.target === self.area)) self._select([]); });
  }
  var LM = LayoutManager.prototype;

  LM.init = function () {
    var self = this;
    this.fit();
    if (this.win.addEventListener) {
      this.win.addEventListener('resize', function () { self.fit(); });
      this.win.addEventListener('keydown', function (ev) { self._key(ev); });
    }
  };
  // edit mode: the canvas fits below the toolbar so the bar never covers widgets
  LM.fit = function () {
    var top = this.edit ? Math.max(0, this.editInset() || 0) : 0;
    var f = M.stageFit(this.win.innerWidth || this.full.w, Math.max(1, (this.win.innerHeight || this.full.h) - top), this.full.w, this.full.h);
    this.k = f.k; this.canvas.style.transform = 'translate(' + f.ox + 'px,' + (f.oy + top) + 'px) scale(' + f.k + ')';
  };
  LM.setLayout = function (layout) {
    for (var id in this.inst) this._unmount(id);
    this.layout = { version: 1, design: this.design, widgets: (layout && layout.widgets) ? layout.widgets.slice() : [] };
    this._intoArea(this.layout.widgets);
    for (var i = 0; i < this.layout.widgets.length; i++) this._mount(this.layout.widgets[i]);
  };
  // a layout made for the whole canvas (before the edge strips, or a bigger canvas) is scaled once into the area: same arrangement, nothing in the strips
  LM._intoArea = function (ws) {
    var W = this.design.w, H = this.design.h, out = ws.some(function (w) { return w.x < 0 || w.y < 0 || w.x + w.w > W + 0.5 || w.y + w.h > H + 0.5; });
    if (!out || !ws.length) return false;
    var from = { x: 0, y: 0, w: Math.max(this.full.w, M.bbox(ws).x + M.bbox(ws).w), h: Math.max(this.full.h, M.bbox(ws).y + M.bbox(ws).h) };
    var to = M.scaleInto(ws, from, { x: 0, y: 0, w: W, h: H });
    ws.forEach(function (w, i) { w.x = to[i].x; w.y = to[i].y; w.w = to[i].w; w.h = to[i].h; });
    return true;
  };
  LM.update = function (state) {
    this.state = state;
    for (var id in this.inst) { try { this.inst[id].widget.update(state); } catch (e) { if (root.console) console.error('widget ' + id, e); } }
  };

  LM._mount = function (item) {
    var def = this.registry[item.type]; if (!def) return null;
    var self = this, el = D.box('pw-widget', this.area, item.x, item.y, item.w, item.h); el.setAttribute('data-id', item.id);
    item.settings = item.settings || {};
    if (P.theme) { P.theme.migrate(item.settings.style, def.colors); P.theme.apply(el, item.settings.style, def.colors || []); }   // the widget's own colours / font
    var op = P.opt ? P.opt(item.settings, 'opacity', 100) : 100; if (op < 100) el.style.opacity = String(op / 100);           // general option
    var body = D.box('pw-body', el, 0, 0, item.w, item.h); body.style.overflow = 'hidden';
    var widget = def.create(body, { settings: item.settings });
    var ov = D.box('pw-edit', el, 0, 0, item.w, item.h);
    var title = D.box('pw-title', ov, 0, 0); title.textContent = def.title; var del = D.box('pw-del', ov); del.textContent = '\u00D7'; del.setAttribute('data-del', '1');
    var gear = D.box('pw-gear', ov); gear.textContent = '\u2699'; gear.setAttribute('data-gear', '1');
    HANDLES.forEach(function (h) { var e = D.box('pw-h pw-h-' + h, ov); e.setAttribute('data-h', h); });
    var size = D.box('pw-size', ov);                                                                      // edit mode: its size, live while resizing
    var inst = { item: item, el: el, body: body, ov: ov, widget: widget, def: def, size: size };
    this.inst[item.id] = inst; this.order.push(item.id);
    ov.addEventListener('pointerdown', function (ev) { self._down(inst, ev); });
    ov.addEventListener('pointermove', function (ev) { self._move(ev); });
    ov.addEventListener('pointerup', function (ev) { self._up(ev); });
    this._place(inst);
    if (P.isFloat(item.settings)) this._front(inst);                                                    // a floating one: on top from the start
    if (this.state) { try { widget.update(this.state); } catch (e) { if (root.console) console.error(e); } }
    return inst;
  };
  LM._unmount = function (id) {
    var inst = this.inst[id]; if (!inst) return;
    try { inst.widget.destroy(); } catch (e) {}
    if (inst.el.parentNode) inst.el.parentNode.removeChild(inst.el);
    delete this.inst[id]; this.order = this.order.filter(function (x) { return x !== id; });
    if (this.selected.indexOf(id) >= 0) this._select(this.selected.filter(function (x) { return x !== id; }));
  };
  LM._place = function (inst) {
    var it = inst.item, s = inst.el.style;
    s.left = it.x + 'px'; s.top = it.y + 'px';
    if (inst._w === it.w && inst._h === it.h) return;                                                    // only moved (e.g. pushed): no re-layout of the widget
    inst._w = it.w; inst._h = it.h; s.width = it.w + 'px'; s.height = it.h + 'px'; if (inst.size) inst.size.textContent = Math.round(it.w) + ' × ' + Math.round(it.h);
    inst.body.style.width = it.w + 'px'; inst.body.style.height = it.h + 'px'; inst.ov.style.width = it.w + 'px'; inst.ov.style.height = it.h + 'px';
    inst.widget.resize(it.w, it.h);
  };

  LM.setEdit = function (on) {
    this.edit = !!on; this.canvas.className = 'pw-canvas' + (this.edit ? ' edit' : ''); this.onEdit(this.edit);
    if (!this.edit) this._select([]);
    this.fit();
  };
  // snap grid in canvas px (1 = off); the grid drawn in edit mode is the same grid
  LM.setGrid = function (g) {
    this.grid = g > 1 ? g : 1; var s = this.area.style;
    s.backgroundImage = this.grid > 1 ? '' : 'none'; s.backgroundSize = this.grid > 1 ? this.grid + 'px ' + this.grid + 'px' : '';
  };
  LM._guides = function (g) {
    var on = !!g && g.x !== null && g.x !== undefined; D.show(this.guideX, on); if (on) D.left(this.guideX, g.x - 1);
    on = !!g && g.y !== null && g.y !== undefined; D.show(this.guideY, on); if (on && this.guideY._top !== g.y) { this.guideY.style.top = (g.y - 1) + 'px'; this.guideY._top = g.y; }
  };
  // ids = the selection (an id, an array, or null / [] for none); sel = the last one picked
  LM._select = function (ids) {
    ids = ids ? (Array.isArray(ids) ? ids : [ids]) : [];
    this.selected = ids.filter(function (id) { return id in this.inst; }, this); this.sel = this.selected.length ? this.selected[this.selected.length - 1] : null;
    for (var k in this.inst) { var c = 'pw-widget' + (this.selected.indexOf(k) >= 0 ? ' sel' : ''); if (this.inst[k].el.className !== c) this.inst[k].el.className = c; }
  };
  // floating widgets (settings 'float', registry.js) always stay above the others
  LM._front = function (inst) { inst.el.style.zIndex = String(P.isFloat(inst.item.settings) ? 5000 + (this._zf = (this._zf || 0) + 1) : (++this._z || (this._z = 10))); };
  LM._floats = function (w) { return P.isFloat(w.settings); };
  function rectOf(it) { return { x: it.x, y: it.y, w: it.w, h: it.h }; }
  function minOf(def) { return { w: Math.max(80, Math.round(def.base.w * 0.15)), h: Math.max(60, Math.round(def.base.h * 0.15)) }; }

  LM._down = function (inst, ev) {
    if (!this.edit) return;
    var t = ev.target, h = t && t.getAttribute ? t.getAttribute('data-h') : null, del = t && t.getAttribute ? t.getAttribute('data-del') : null, id = inst.item.id;
    if (del) { this.removeWidget(id); return; }
    if (t && t.getAttribute && t.getAttribute('data-gear')) { this._select(id); this._front(inst); this.onStyle(inst); return; }
    var isSel = this.selected.indexOf(id) >= 0;
    if (ev.ctrlKey || ev.metaKey) {                                                                       // Ctrl+click: add to / remove from the selection
      if (isSel) { this._select(this.selected.filter(function (x) { return x !== id; })); return; }
      this._select(this.selected.concat([id]));
    } else if (!isSel) this._select(id);                                                                  // a click on a selected one keeps the group (to drag it)
    else this._select(this.selected.filter(function (x) { return x !== id; }).concat([id]));
    var self = this, ids = this.selected.slice();
    ids.forEach(function (x) { self._front(self.inst[x]); });
    var start = {}; ids.forEach(function (x) { start[x] = rectOf(self.inst[x].item); });
    // floating widgets neither push nor get pushed: they are left out of 'others' (what gets pushed); every other widget still gives edges to line up with
    var rest = this.layout.widgets.filter(function (w) { return w.id in self.inst && ids.indexOf(w.id) < 0; });
    var floatDrag = ids.every(function (x) { return P.isFloat(self.inst[x].item.settings); });
    var others = floatDrag ? [] : rest.filter(function (w) { return !P.isFloat(w.settings); }).map(function (w) { return { id: w.id, r: rectOf(w) }; });
    this.drag = { inst: inst, mode: h || 'move', ids: ids, start: start, box: M.bbox(ids.map(function (x) { return start[x]; })), others: others, snap: rest.map(rectOf),
                  x0: ev.clientX, y0: ev.clientY, pid: ev.pointerId };
    if (inst.ov.setPointerCapture) { try { inst.ov.setPointerCapture(ev.pointerId); } catch (e) {} }
    if (ev.preventDefault) ev.preventDefault();
  };
  // the selection moves / resizes as ONE box (all widgets scale with it); the other widgets are pushed out of the way, starting from where they were when the drag began
  LM._move = function (ev) {
    var d = this.drag; if (!d) return;
    var dx = (ev.clientX - d.x0) / this.k, dy = (ev.clientY - d.y0) / this.k, cw = this.design.w, ch = this.design.h, self = this;
    var free = !!ev.altKey, grid = free ? 1 : this.grid;                                                 // Alt = place freely (no grid, no snapping, no pushing)
    var edges = free ? null : M.edgesOf(d.snap, cw, ch, this.snapTol), keep = d.mode.length === 2 && !ev.shiftKey;   // corners keep the shape unless Shift
    var sx = 0, sy = 0;                                                                                   // the group can shrink until one member reaches its minimum
    d.ids.forEach(function (x) { var m = minOf(self.inst[x].def), s = d.start[x]; sx = Math.max(sx, m.w / s.w); sy = Math.max(sy, m.h / s.h); });
    function at(mx, my) {
      var r = d.mode === 'move' ? M.drag(d.box, mx, my, grid, cw, ch, edges) : M.resize(d.box, d.mode, mx, my, grid, { w: d.box.w * sx, h: d.box.h * sy }, cw, ch, keep, edges);
      var starts = d.ids.map(function (x) { return d.start[x]; }), rects = M.scaleInto(starts, d.box, r), olds = d.others.map(function (o) { return o.r; });
      var dir = { x: Math.sign(dx), y: Math.sign(dy) };                                                  // moving: widgets in the way are pushed, else jump aside (swap)
      return { r: r, rects: rects, pushed: free ? { ok: true, rects: olds } : (d.mode === 'move' ? M.arrange : M.push)(rects, olds, cw, ch, dir, starts) };
    }
    var res = at(dx, dy);
    if (!res.pushed.ok) {                                                                                 // no room for all of it: go as far as fits (also after a fast mouse jump)
      var lo = 0, hi = 1, best = null;
      for (var i = 0; i < 10; i++) { var t = (lo + hi) / 2, c = at(dx * t, dy * t); if (c.pushed.ok) { best = c; lo = t; } else hi = t; }
      if (!best) return;
      res = best;
    }
    d.ids.forEach(function (x, i) { self._set(self.inst[x], res.rects[i]); });
    d.others.forEach(function (o, i) { self._set(self.inst[o.id], res.pushed.rects[i]); });
    this._guides(res.r.guides);
  };
  LM._set = function (inst, r) {
    var it = inst.item; if (it.x === r.x && it.y === r.y && it.w === r.w && it.h === r.h) return;
    it.x = r.x; it.y = r.y; it.w = r.w; it.h = r.h; this._place(inst);
  };
  LM._up = function (ev) {
    if (!this.drag) return;
    var inst = this.drag.inst; this.drag = null; this._guides(null);
    if (inst.ov.releasePointerCapture) { try { inst.ov.releasePointerCapture(ev.pointerId); } catch (e) {} }
    this.save();
  };
  LM._key = function (ev) {
    var key = ev.key, tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (key === 'e' || key === 'E') { this.setEdit(!this.edit); return; }
    if (!this.edit) return;
    if (key === 'Escape') { this.setEdit(false); return; }
    if ((key === 'a' || key === 'A') && (ev.ctrlKey || ev.metaKey)) { this._select(Object.keys(this.inst)); if (ev.preventDefault) ev.preventDefault(); return; }
    if (!this.selected.length) return;
    var self = this, ids = this.selected.slice(), step = (ev.shiftKey ? 5 : 1) * this.grid;
    if (key === 'Delete') { ids.forEach(function (id) { self.removeWidget(id); }); return; }
    var dx = key === 'ArrowLeft' ? -step : (key === 'ArrowRight' ? step : 0), dy = key === 'ArrowUp' ? -step : (key === 'ArrowDown' ? step : 0);
    if (!dx && !dy) return;
    if (ev.preventDefault) ev.preventDefault();
    var box = M.bbox(ids.map(function (id) { return self.inst[id].item; })), to = M.clampRect({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, this.design.w, this.design.h);
    var rects = ids.map(function (id) { var it = self.inst[id].item; return { x: it.x + to.x - box.x, y: it.y + to.y - box.y, w: it.w, h: it.h }; });
    var others = ids.every(function (id) { return P.isFloat(self.inst[id].item.settings); }) ? [] : this.layout.widgets.filter(function (w) { return w.id in self.inst && ids.indexOf(w.id) < 0 && !P.isFloat(w.settings); });
    var pushed = M.push(rects, others.map(rectOf), this.design.w, this.design.h, { x: Math.sign(dx), y: Math.sign(dy) }, ids.map(function (id) { return rectOf(self.inst[id].item); }));
    if (!pushed.ok) return;
    ids.forEach(function (id, i) { self._set(self.inst[id], rects[i]); }); others.forEach(function (w, i) { self._set(self.inst[w.id], pushed.rects[i]); });
    this.save();
  };

  LM.addWidget = function (type) {
    var def = this.registry[type]; if (!def) return null;
    var n = 1; while (this.inst[type + '-' + n]) n++;
    var off = 40 * (this.layout.widgets.length % 6);
    var item = { id: type + '-' + n, type: type, x: 40 + off, y: 40 + off, w: def.base.w, h: def.base.h, settings: {} };
    var self = this, spot = M.freeSpot(this.layout.widgets.filter(function (w) { return w.id in self.inst && !P.isFloat(w.settings); }).map(rectOf), item.w, item.h, this.design.w, this.design.h);
    if (spot) { item.x = spot.x; item.y = spot.y; }                                                      // a free place if there is one, else on top (make room by hand)
    var r = M.clampRect(item, this.design.w, this.design.h); item.x = r.x; item.y = r.y; item.w = r.w; item.h = r.h;
    this.layout.widgets.push(item); var inst = this._mount(item); this._select(item.id); this._front(inst); this.save(); return inst;
  };
  // auto align (toolbar): the same space between all widgets (layoutMath.align); gap / reach in canvas px
  LM.align = function (gap, reach) {
    var self = this, ws = this.layout.widgets.filter(function (w) { return w.id in self.inst && !P.isFloat(w.settings); });   // floating widgets stay where they are
    var to = M.align(ws.map(rectOf), this.design.w, this.design.h, gap, reach || 200, ws.map(function (w) { return minOf(self.inst[w.id].def); }));
    ws.forEach(function (w, i) { self._set(self.inst[w.id], to[i]); });
    this.save();
  };
  // after item.settings.show changed: build the widget again; when it is now drawn at another shape (columns hidden / shown) the box takes that shape
  // (same height, new width), staying on the canvas and pushing the widgets in the way if it got wider
  LM.reconfigure = function (id) {
    var inst = this.inst[id]; if (!inst) return null;
    var self = this, it = inst.item, z = inst.el.style.zIndex, sel = this.selected.slice(), was = inst.widget.size || inst.def.base;
    this._unmount(id); var n = this._mount(it); n.el.style.zIndex = z; if (P.isFloat(it.settings) && !(Number(z) >= 5000)) this._front(n); this._select(sel);   // just made floating: on top
    var now = n.widget.size || n.def.base, cw = this.design.w, ch = this.design.h;
    if (Math.abs(now.w / now.h - was.w / was.h) > 1e-6) {
      var h = it.h, w = Math.round(h * now.w / now.h);
      if (now.w === was.w) { w = it.w; h = Math.round(w * now.h / now.w); }                             // only the height changed (e.g. fewer rows): keep the width
      if (w > cw) { w = cw; h = Math.round(w * now.h / now.w); }
      if (h > ch) { h = ch; w = Math.round(h * now.w / now.h); }
      var r = M.clampRect({ x: it.x, y: it.y, w: w, h: h }, cw, ch);
      var others = P.isFloat(it.settings) ? [] : this.layout.widgets.filter(function (x) { return x.id in self.inst && x.id !== id && !P.isFloat(x.settings); });
      var p = M.push([r], others.map(rectOf), cw, ch, { x: r.w > it.w ? 1 : 0, y: r.h > it.h ? 1 : 0 }, [rectOf(it)]);
      if (p.ok) { others.forEach(function (x, i) { self._set(self.inst[x.id], p.rects[i]); }); this._set(n, r); }   // no room: the box stays, the content scales inside it
    }
    this.save();
    return n;
  };
  // after item.settings.style changed (style editor): repaint that widget and save
  LM.restyle = function (id) { var inst = this.inst[id]; if (!inst) return; if (P.theme) P.theme.apply(inst.el, inst.item.settings.style, inst.def.colors || []); this.save(); };
  LM.removeWidget = function (id) {
    this.layout.widgets = this.layout.widgets.filter(function (w) { return w.id !== id; }); this._unmount(id); this.save();
  };
  LM.save = function () {
    var self = this; if (this.timer && this.win.clearTimeout) this.win.clearTimeout(this.timer);
    var run = function () { self.timer = null; if (self.persist) self.persist.save(self.layout); };
    if (this.win.setTimeout) this.timer = this.win.setTimeout(run, 400); else run();
  };
  LM.flush = function () { if (this.timer && this.win.clearTimeout) this.win.clearTimeout(this.timer); this.timer = null; if (this.persist) return this.persist.save(this.layout); };

  P.LayoutManager = LayoutManager;
  P.defaultLayout = function () {
    return { version: 1, design: { w: 2560, h: 1440 }, widgets: [
      { id: 'leaderboard-1', type: 'leaderboard', x: 20, y: 20, w: 1523, h: 804, settings: {} },
      { id: 'cards-1', type: 'cards', x: 1580, y: 20, w: 490, h: 445, settings: {} } ] };
  };
  if (typeof module !== 'undefined') module.exports = LayoutManager;
})(typeof window !== 'undefined' ? window : globalThis);
