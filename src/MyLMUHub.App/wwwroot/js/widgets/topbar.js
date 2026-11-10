// The SimHub top bar as three widgets (placed side by side they make the original bar). Data: state.top (TopBarView).
//   session  - position, session name + time left, lap, laps left
//   laptimes - last / best / current / estimated lap
//   delta    - live delta and the three sectors
// Same geometry, sizes and colours as the SimHub top bar (design units x 2.025; font sizes are pixels).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, F = P.format, D = P.dom;
  var S = 2.025, Y0 = 4, H = 61.7;
  function u(v) { return Math.round(v * S); }
  function has(d) { return d !== null && d !== undefined; }
  var NONE = { has: false, session: -1, timeLeft: -1, lapsLeft: -1, sectors: [] };

  // one widget = one SimHub panel strip starting at design x0, w units wide; slots = its colour parts; options = what can be hidden ([key, label]).
  // build(txt, panel, e, K, settings) creates the texts and returns fill(top); it may set e.width (design units) when it closed up hidden parts.
  function define(type, title, x0, w, slots, options, build) {
    var BASE_W = u(w), BASE_H = u(H), SL = P.colorSlots(type, slots), K = SL.K;
    function create(host, ctx) {
      var r = D.box('pw-tb', host, 0, 0, BASE_W, BASE_H);
      function panel(x, pw, bg, accent) {
        var p = D.box('pw-tb-p', r, u(x - x0), 0, u(pw), BASE_H); p.style.backgroundColor = bg; p.style.borderColor = K.border;
        D.box('pw-tb-ac', r, u(x - x0 + 4.9), 0, u(34), Math.max(3, u(2.2))).style.backgroundColor = accent;
      }
      // x, y, w, h (design units), font px, weight, align, colour, fixed text
      function txt(x, y, tw, th, font, weight, align, color, t) {
        var e = D.box('pw-tb-t', r, u(x - x0), u(y - Y0), u(tw), u(th)), s = e.style;
        s.fontSize = font + 'px'; s.fontWeight = weight; s.textAlign = align; s.lineHeight = u(th) + 'px'; s.color = color;
        if (t) e.textContent = t;
        return e;
      }
      var e = {}, fill = build(txt, panel, e, K, ctx && ctx.settings), W = e.width ? u(e.width) : BASE_W; r.style.width = W + 'px';
      var fb = P.fillBox(r, W, BASE_H, P.opt(ctx && ctx.settings, 'textSize', 100) / 100 * P.textScale());       // a stretched box: the strip fills it (layout.js)
      function update(state) { fill(state.top || NONE); }                                          // no game: dashes
      function resize(rw, rh) { fb.resize(rw, rh); }
      return { update: update, resize: resize, destroy: function () { if (r.parentNode) r.parentNode.removeChild(r); }, size: { w: W, h: BASE_H }, _e: e };
    }
    P.registerWidget({ type: type, title: title, base: { w: BASE_W, h: BASE_H }, create: create, colors: SL.list,
      options: options.map(function (o) { return Array.isArray(o) ? { key: o[0], label: o[1] } : o; }).concat([{ key: 'textSize', label: 'Text size (%)', type: 'number', def: 100, min: 60, max: 160 }]) });
    return { BASE_W: BASE_W, BASE_H: BASE_H, K: K };
  }

  var session = define('session', 'Session info', 8, 370, [
    ['bg', 'Background', 'panel'], ['border', 'Border', 'border'], ['strip', 'Top strip', 'yellow'], ['titles', 'Titles (POS, LAP, LEFT, session)', 'label'],
    ['pos', 'Class position', 'white'], ['overall', 'Overall position', 'label'], ['time', 'Time left', 'white'], ['lap', 'Lap', 'white'], ['left', 'Laps left', 'label']],
    [['pos', 'Position (class)'], ['overall', 'Overall position'], ['time', 'Session + time left'], ['lap', 'Lap'], ['left', 'Laps left']],
  function (txt, panel, e, K, set) {
    var show = function (k) { return P.shown(set, k); };
    panel(8, 370, K.bg, K.strip);
    if (show('pos')) txt(18, 6, 100, 13.9, 17, 600, 'left', K.titles, 'POS');
    if (show('lap')) txt(274, 6, 100, 13.9, 17, 600, 'left', K.titles, 'LAP');
    if (show('left')) txt(330, 6, 50, 13.9, 17, 600, 'left', K.titles, 'LEFT');
    e.sess = txt(120, 6, 200, 13.9, 17, 600, 'center', K.titles);
    e.pos = txt(14, 23.8, 66, 39.8, 44, 700, 'left', K.pos); e.overall = txt(84, 23.8, 40, 39.8, 40, 600, 'left', K.overall);
    e.time = txt(124, 23.8, 150, 39.8, 40, 700, 'left', K.time); e.lap = txt(270, 23.8, 60, 39.8, 44, 700, 'left', K.lap);
    e.left = txt(326, 23.8, 50, 39.8, 38, 600, 'left', K.left);
    [['pos', e.pos], ['overall', e.overall], ['time', e.sess], ['time', e.time], ['lap', e.lap], ['left', e.left]].forEach(function (x) { if (!show(x[0])) D.show(x[1], false); });
    return function (t) {
      D.text(e.sess, F.sessionName(t.session)); D.text(e.time, F.hms(t.timeLeft));
      D.text(e.pos, t.has ? 'P' + t.classPos : ''); D.text(e.overall, t.has ? String(t.overall) : '');
      D.text(e.lap, t.has ? 'L' + t.lap : ''); D.text(e.left, F.lapsLeft(t.lapsLeft));
    };
  });

  // four boxes of 89 units, 4 apart; hidden boxes close up and the strip gets shorter
  var laptimes = define('laptimes', 'Session lap info', 392, 368, [
    ['bg', 'Background', 'panelDark'], ['border', 'Border', 'border'], ['titles', 'Titles', 'label'],
    ['stripLast', 'Strip: last lap', 'green'], ['stripBest', 'Strip: best lap', 'purple'], ['stripCur', 'Strip: current lap', 'yellow'], ['stripEst', 'Strip: estimated lap', 'blue'],
    ['time', 'Lap times', 'white'], ['classBest', 'Lap time: class best', 'purple'], ['ownBest', 'Lap time: personal best', 'green'],
    ['faster', 'Faster than your best', 'green'], ['slower', 'Slower than your best', 'red'], ['noDiff', 'Difference: none', 'label']],
    [['last', 'Last lap'], ['lastDiff', 'Last lap vs the lap before (+ slower / - faster)'], ['best', 'Best lap'], ['cur', 'Current lap'], ['est', 'Estimated lap']],
  function (txt, panel, e, K, set) {
    var LAP = { classBest: K.classBest, ownBest: K.ownBest, normal: K.time }, DIFF = { none: K.noDiff, slower: K.slower, faster: K.faster }, n = 0;
    function box(key, title, strip) {                                              // one box at the next free place (design x)
      if (!P.shown(set, key)) return null;
      var x = 392 + 93 * n++; panel(x, 89, K.bg, strip); txt(x + 5, 6, 60, 13.9, 16, 600, 'left', K.titles, title);
      return txt(x, 23.8, 89, 39.8, 28, 700, 'center', K.time);
    }
    var x0 = 392 + 93 * n; e.last = box('last', 'LAST LAP', K.stripLast);
    if (e.last && P.shown(set, 'lastDiff')) e.lastD = txt(x0 + 48, 6, 46, 13.9, 15, 700, 'right', K.noDiff);
    e.best = box('best', 'BEST LAP', K.stripBest); e.cur = box('cur', 'CURR LAP', K.stripCur); e.est = box('est', 'EST LAP', K.stripEst);
    e.width = Math.max(1, n) * 93 - 4;
    function put(el, t, c) { if (el) { D.text(el, t); D.color(el, c); } }
    return function (t) {
      put(e.last, F.lap(t.last), F.lastColor(t.lastFlag, LAP)); put(e.lastD, F.diff(t.lastDiff, 2), F.diffColor(t.lastDiff, DIFF));
      put(e.best, F.lap(t.best), F.lastColor(t.bestFlag, LAP));
      put(e.cur, F.lap(t.cur), has(t.delta) ? F.diffColor(t.delta, DIFF) : K.time);
      put(e.est, F.lap(t.est), t.est > 0 ? F.diffColor(t.delta, DIFF) : K.time);
    };
  });

  var delta = define('delta', 'Delta', 775, 483, [
    ['bg', 'Background', 'panel'], ['border', 'Border', 'border'], ['strip', 'Top strip', 'green'], ['titles', 'Titles', 'label'],
    ['ahead', 'Delta: ahead of your best', 'green'], ['behind', 'Delta: behind your best', 'red'], ['none', 'Delta: none', 'label'],
    ['secClass', 'Sector: class best', 'purple'], ['secOwn', 'Sector: personal best', 'green'], ['secSlower', 'Sector: slower', 'yellow'], ['secNone', 'Sector: none yet', 'label'],
    ['gain', 'Sector difference: gained', 'green'], ['loss', 'Sector difference: lost', 'red']],
    [['delta', 'Live delta'], ['s1', 'Sector 1'], ['s2', 'Sector 2'], ['s3', 'Sector 3'], ['secDiff', 'Sector differences (+/-)'],
     { key: 'decimals', label: 'Live delta decimals', type: 'select', def: 3, choices: [[3, '3 (+0.123)'], [2, '2 (+0.12)'], [1, '1 (+0.1)']] }],
  function (txt, panel, e, K, set) {
    panel(775, 483, K.bg, K.strip);
    if (P.shown(set, 'delta')) { txt(784, 6, 100, 13.9, 17, 600, 'left', K.titles, 'DELTA'); e.delta = txt(784, 21.9, 150, 41.8, 42, 700, 'left', K.none); }
    e.sec = [];
    [975, 1075, 1175].forEach(function (x, i) {
      if (!P.shown(set, 's' + (i + 1))) { e.sec.push(null); return; }
      txt(x, 6, 26, 13.9, 17, 600, 'left', K.titles, 'S' + (i + 1));
      e.sec.push({ d: P.shown(set, 'secDiff') ? txt(x + 24, 6, 70, 13.9, 16, 700, 'left', K.secNone) : null, v: txt(x, 23.8, 95, 39.8, 34, 700, 'left', K.secNone) });
    });
    var DEC = P.opt(set, 'decimals', 3), DLT = { none: K.none, slower: K.behind, faster: K.ahead }, SEC = { classBest: K.secClass, ownBest: K.secOwn, slower: K.secSlower, none: K.secNone };
    var SD = { none: K.secNone, slower: K.loss, faster: K.gain };
    return function (t) {
      if (e.delta) { D.text(e.delta, F.liveDelta(t.delta, DEC)); D.color(e.delta, F.diffColor(t.delta, DLT)); }
      for (var i = 0; i < 3; i++) {
        var o = e.sec[i]; if (!o) continue;
        var s = (t.sectors || [])[i] || { value: -1, diff: null, flag: 0 };
        D.text(o.v, F.sector(s.value)); D.color(o.v, F.sectorBoxColor(s.flag, SEC));
        if (o.d) { D.text(o.d, F.diff(s.diff, 3)); D.color(o.d, F.diffColor(s.diff, SD)); }
      }
    };
  });
  if (typeof module !== 'undefined') module.exports = { session: session, laptimes: laptimes, delta: delta };
})(typeof window !== 'undefined' ? window : globalThis);
