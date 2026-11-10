// Drawing kit for the widgets copied from SimHub panels. Coordinates are SimHub design units (x 2.025 = pixels) in the DASHBOARD's space, so the item lists
// read exactly like the original SimHub dashboard; x0/y0 = the panel's corner. Font sizes are pixels. Align: 'left' | 'center' | 'right'.
// Resizing FILLS the box: the layout stretches in width and height separately (wider = items further apart, longer = more room between rows); the text
// scales with the smaller of the two (it only gets smaller when the box is smaller than the design size both ways), times the widget's 'Text size'.
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, D = P.dom;
  var S = 2.025;
  function u(v) { return Math.round(v * S); }

  // a panel x0, y0, w, h (design units) with background, border and the accent strip (colours: K.bg, K.border, K.strip); ts = text size factor
  P.panel = function (host, x0, y0, w, h, K, ts) {
    var W = u(w), H = u(h), r = D.box('pw-tb', host, 0, 0, W, H), p = D.box('pw-tb-p', r, 0, 0, W, H);
    p.style.backgroundColor = K.bg; p.style.borderColor = K.border;
    var items = [], hooks = [], kx = 1, ky = 1; ts = ts > 0 ? ts : 1;
    function keep(e, x, y, w_, h_, font) { items.push({ e: e, x: x, y: y, w: w_, h: h_, font: font }); return e; }
    keep(D.box('pw-tb-ac', r, u(4.9), 0, u(34), Math.max(3, u(2.2))), u(4.9), 0, u(34), Math.max(3, u(2.2))).style.backgroundColor = K.strip;
    var k = {
      root: r, W: W, H: H, u: u,
      // a size in design units as it is drawn now (the box may be stretched): for bars and other items a widget sizes itself
      ux: function (v) { return u(v) * kx; }, uy: function (v) { return u(v) * ky; },
      rect: function (x, y, w_, h_, color) {
        var X = u(x - x0), Y = u(y - y0), Wd = u(w_), Hd = Math.max(1, u(h_)), e = keep(D.box('pw-p-r', r, X, Y, Wd, Hd), X, Y, Wd, Hd);
        if (color) e.style.backgroundColor = color; return e;
      },
      txt: function (x, y, w_, h_, font, weight, align, color, t) {
        var X = u(x - x0), Y = u(y - y0), Wd = u(w_), Hd = u(h_), e = keep(D.box('pw-tb-t', r, X, Y, Wd, Hd), X, Y, Wd, Hd, font), s = e.style;
        s.fontSize = Math.round(font * ts) + 'px'; s.fontWeight = weight; s.textAlign = align; s.lineHeight = Hd + 'px'; s.color = color;
        if (t) e.textContent = t;
        return e;
      },
      img: function (x, y, w_, h_, src) {
        var X = u(x - x0), Y = u(y - y0), Wd = u(w_), Hd = u(h_), e = D.el('img', 'pw-p-img', r);
        e.style.cssText = 'position:absolute;left:' + X + 'px;top:' + Y + 'px;width:' + Wd + 'px;height:' + Hd + 'px;object-fit:contain';
        keep(e, X, Y, Wd, Hd);
        if (src) D.src(e, src);
        return e;
      },
      // called after every resize (e.g. the track map redraws for its new box)
      onResize: function (fn) { hooks.push(fn); },
      // widget plumbing: fill the box, remove it. An item a widget sizes itself keeps that width / height (e._dynW / e._dynH).
      resize: function (rw, rh) {
        if (!(rw > 0 && rh > 0)) return;
        var sx = rw / W, sy = rh / H, f = Math.max(0.01, Math.min(sx, sy)), nx = sx / f, ny = sy / f;
        if (nx !== kx || ny !== ky) {
          kx = nx; ky = ny;
          items.forEach(function (it) {
            var s = it.e.style; s.left = Math.round(it.x * kx) + 'px'; s.top = Math.round(it.y * ky) + 'px';
            if (!it.e._dynW) s.width = Math.round(it.w * kx) + 'px';
            if (!it.e._dynH) s.height = Math.max(1, Math.round(it.h * ky)) + 'px';
            if (it.font) s.lineHeight = Math.round(it.h * ky) + 'px';
          });
          [r, p].forEach(function (e) { e.style.width = Math.round(W * kx) + 'px'; e.style.height = Math.round(H * ky) + 'px'; });
          hooks.forEach(function (fn) { fn(); });
        }
        r.style.transform = 'scale(' + f + ')'; r.style.transformOrigin = '0 0';
      },
      destroy: function () { if (r.parentNode) r.parentNode.removeChild(r); }
    };
    return k;
  };
  var TEXT = { key: 'textSize', label: 'Text size (%)', type: 'number', def: 100, min: 60, max: 160 };
  // register a SimHub panel widget. strip = theme colour of its accent strip; slots = its own colour parts ([key, name, theme colour]; Background, Border and
  // Top strip are added in front). options = what can be hidden ([key, label]) or set (option objects, see registry.js); kit.show(key) / kit.opt(key, def) read them.
  // Every panel also gets 'Text size'. build(kit, e, K) creates the items (keep them in e) and returns fill(state) (or false to hide the panel)
  P.panelWidget = function (type, title, x0, y0, w, h, strip, slots, options, build) {
    var SL = P.colorSlots(type, [['bg', 'Background', 'panel'], ['border', 'Border', 'border'], ['strip', 'Top strip', strip]].concat(slots)), K = SL.K;
    P.registerWidget({ type: type, title: title, base: { w: u(w), h: u(h) }, colors: SL.list,
      options: options.map(function (o) { return Array.isArray(o) ? { key: o[0], label: o[1] } : o; }).concat([TEXT]), create: function (host, ctx) {
      var set = ctx && ctx.settings, k = P.panel(host, x0, y0, w, h, K, P.opt(set, 'textSize', 100) / 100 * P.textScale()), e = {}, last = null;
      k.show = function (key) { return P.shown(set, key); };
      k.opt = function (key, def) { return P.opt(set, key, def); };
      // hide items of a part that is switched off (they still get their values, nobody sees them)
      k.hideIf = function (key, items) { if (!k.show(key)) items.forEach(function (x) { if (x) D.show(x, false); }); };
      var fill = build(k, e, K);
      function update(state) { last = state; var on = fill(state) !== false; D.show(k.root, on); }
      function resize(rw, rh) { k.resize(rw, rh); if (last) update(last); }                     // sizes a widget sets itself follow the new box
      return { update: update, resize: resize, destroy: k.destroy, _e: e };
    } });
    return { BASE_W: u(w), BASE_H: u(h), K: K };
  };
  P.panelUnits = u;
  // the theme's 'Text size of all widgets' (theme.js), 1 = 100 %
  P.textScale = function () { return (P.theme && P.theme.textScale) || 1; };
  P.TEXT_SIZE_OPTION = TEXT;
  // the same filling for a widget drawn its own way (top strips, ahead / behind): root r drawn at W x H with absolutely placed children. The children's
  // places are read once (their inline px); resize stretches them like a panel; ts = text size factor. kx() / ky() = the stretch now, for what a widget
  // places itself (e._dynW / e._dynH / e._dynX: left alone).
  P.fillBox = function (r, W, H, ts) {
    var items = null, kx = 1, ky = 1; ts = ts > 0 ? ts : 1;
    function px(v) { return parseFloat(v) || 0; }
    function read() {
      items = [].slice.call(r.children).map(function (e) {
        var s = e.style, it = { e: e, x: px(s.left), y: px(s.top), w: px(s.width), h: px(s.height), lh: px(s.lineHeight), fs: px(s.fontSize) };
        if (it.fs && ts !== 1) s.fontSize = Math.round(it.fs * ts) + 'px';
        return it;
      });
    }
    return {
      kx: function () { return kx; }, ky: function () { return ky; },
      resize: function (rw, rh) {
        if (!(rw > 0 && rh > 0)) return;
        if (!items) read();
        var sx = rw / W, sy = rh / H, f = Math.max(0.01, Math.min(sx, sy)), nx = sx / f, ny = sy / f;
        if (nx !== kx || ny !== ky) {
          kx = nx; ky = ny;
          items.forEach(function (it) {
            var s = it.e.style;
            if (!it.e._dynX) s.left = Math.round(it.x * kx) + 'px';
            s.top = Math.round(it.y * ky) + 'px';
            if (it.w && !it.e._dynW) s.width = Math.round(it.w * kx) + 'px';
            if (it.h && !it.e._dynH) s.height = Math.max(1, Math.round(it.h * ky)) + 'px';
            if (it.lh) s.lineHeight = Math.round(it.lh * ky) + 'px';
          });
          r.style.width = Math.round(W * kx) + 'px'; r.style.height = Math.round(H * ky) + 'px';
        }
        r.style.transform = 'scale(' + f + ')'; r.style.transformOrigin = '0 0';
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
