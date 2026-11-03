// Ahead / behind widget: the car one position above and below you in your class, with the gap in seconds and an arrow that slides with the gap.
// Base size = the SimHub panel (242 x 220 design units).
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format, D = P.dom;
  var S = 2.025, BASE_W = Math.round(242 * S), BASE_H = Math.round(220 * S);   // 490 x 445
  function u(v) { return Math.round(v * S); }
  var SL = P.colorSlots('cards', [
    ['bg', 'Background', 'panel'], ['border', 'Border', 'border'], ['pos', 'Position', 'label'], ['name', 'Driver name', 'muted'], ['gap', 'Gap', 'bright'],
    ['lastTitle', '"LAST" title', 'label'], ['last', 'Last lap', 'label'], ['track', 'Arrow track', 'track'], ['marker', 'Centre marker', 'marker'],
    ['arrow', 'Arrow', 'white'], ['arrowAhead', 'Arrow: car ahead within 1.5 s', 'green'], ['arrowBehind', 'Arrow: car behind within 1.5 s', 'red'],
    ['dltFaster', 'Last lap difference: car was faster than you', 'red'], ['dltSlower', 'Last lap difference: car was slower than you', 'green'], ['dltNone', 'Last lap difference: none', 'label']]);
  var K = SL.K, DLT = { theyFaster: K.dltFaster, theySlower: K.dltSlower, none: K.dltNone };

  function create(host, ctx) {
    var set = ctx && ctx.settings, showA = P.shown(set, 'ahead'), showB = P.shown(set, 'behind'), showArr = P.shown(set, 'arrows'), showLast = P.shown(set, 'last'), showDlt = P.shown(set, 'delta');
    var RANGE = P.opt(set, 'range', 10), CLOSE = P.opt(set, 'close', 1.5);
    var r = D.box('pw-cards', host, 0, 0, BASE_W, BASE_H); r.style.backgroundColor = K.bg; r.style.borderColor = K.border;
    function card(top, nameY, gapY, lastY, arrowKey) {
      var o = {};
      o.pos = D.box('pw-c-pos', r, u(6), u(nameY), u(34), u(20)); o.pos.style.cssText += ';font-size:22px;color:' + K.pos + ';font-weight:600';
      o.name = D.box('pw-c-name', r, u(44), u(nameY), u(190), u(20)); o.name.style.cssText += ';font-size:22px;color:' + K.name + ';font-weight:600;white-space:nowrap;overflow:hidden';
      o.gap = D.box('pw-c-gap', r, u(42), u(gapY), u(190), u(34)); o.gap.style.cssText += ';font-size:38px;color:' + K.gap + ';font-weight:700';
      var ll = D.box('pw-c-ll', r, u(6), u(lastY), u(40), u(14)); ll.style.cssText += ';font-size:15px;color:' + K.lastTitle + ';font-weight:600'; ll.textContent = 'LAST';
      o.last = D.box('pw-c-last', r, u(48), u(lastY - 2), u(110), u(18)); o.last.style.cssText += ';font-size:22px;color:' + K.last + ';font-weight:600';
      // the difference of the last laps, as on the leaderboard (your last lap - theirs: red = they were faster)
      o.dlt = D.box('pw-c-dlt', r, u(140), u(gapY), u(94), u(34)); o.dlt.style.cssText += ';font-size:36px;font-weight:700;text-align:right;line-height:' + u(34) + 'px;white-space:nowrap';
      o.dltCap = D.box('pw-c-dltcap', r, u(140), u(lastY), u(94), u(14)); o.dltCap.style.cssText += ';font-size:14px;font-weight:600;text-align:right;color:' + K.lastTitle; o.dltCap.textContent = 'LAST LAP Δ';
      o.all = [o.pos, o.name, o.gap]; o.lastAll = [ll, o.last]; o.dltAll = [o.dlt, o.dltCap];
      return o;
    }
    // panel is 220 units high: ahead card on top, arrow track in the middle, behind card at the bottom (mirrored)
    var ahead = card(0, 7, 31, 69, 'a'), behind = card(0, 197, 163, 145, 'b');
    var trk = D.box('pw-c-track', r, 0, u(111.5), u(240), Math.max(2, u(1.2))); trk.style.backgroundColor = K.track;
    function arrow(x) { var a = D.box('pw-c-arrow', r, u(x), u(101), u(30), u(22)); a.style.cssText += ';font-size:26px;line-height:' + u(22) + 'px;color:' + K.arrow; a.textContent = '▶'; return a; }
    var arrA = arrow(0), arrC = arrow(110), arrB = arrow(210); arrC.style.color = K.marker; arrA._dynX = arrB._dynX = true;   // the two moving arrows: placed in fill()
    var fb = P.fillBox(r, BASE_W, BASE_H, P.opt(set, 'textSize', 100) / 100 * P.textScale()), last = null;                     // a stretched box: the cards fill it
    if (!showArr) { D.show(trk, false); D.show(arrC, false); }

    function fill(o, arr, side, c, want) {
      var on = !!c && want; o.all.forEach(function (e) { D.show(e, on); }); o.lastAll.forEach(function (e) { D.show(e, on && showLast); }); var dOn = on && showDlt && !!(c && c.delta && c.delta.has); o.dltAll.forEach(function (e) { D.show(e, dOn); }); D.show(arr, on && showArr);
      if (!on) return;
      D.text(o.pos, String(c.classPos)); D.text(o.name, c.driver); D.text(o.gap, F.cardGapText(c.gap)); D.text(o.last, F.lap(c.last));
      // your last lap vs theirs: ▲ green = you were faster (more pace), ▼ red = they were faster; the size of it in seconds
      if (c.delta && c.delta.has) { D.text(o.dlt, (c.delta.value > 0 ? '▼ ' : '▲ ') + Math.abs(c.delta.value).toFixed(Math.abs(c.delta.value) < 10 ? 2 : 1)); D.color(o.dlt, F.deltaColor(c.delta.flag, DLT)); }
      var g = c.gap.value, d = Math.min(g, RANGE) / RANGE;                  // RANGE s or more = far end, 0 s = next to the centre marker
      D.left(arr, Math.round((side < 0 ? u(76 - d * 76) : u(144 + d * 66)) * fb.kx()));
      D.color(arr, g < CLOSE ? (side < 0 ? K.arrowAhead : K.arrowBehind) : K.arrow);
    }
    function update(state) {
      last = state; var st = state.standings || {};                                         // no game: the empty frame
      fill(ahead, arrA, -1, st.ahead, showA); fill(behind, arrB, 1, st.behind, showB);
    }
    function resize(w, h) { fb.resize(w, h); if (last) update(last); }
    return { update: update, resize: resize, destroy: function () { if (r.parentNode) r.parentNode.removeChild(r); }, _ahead: ahead, _behind: behind, _arrows: [arrA, arrC, arrB] };
  }
  P.registerWidget({ type: 'cards', title: 'Ahead / Behind', base: { w: BASE_W, h: BASE_H }, create: create, colors: SL.list,
    options: [{ key: 'ahead', label: 'Car ahead' }, { key: 'behind', label: 'Car behind' }, { key: 'arrows', label: 'Gap arrows' }, { key: 'last', label: 'Last lap times' },
      { key: 'delta', label: 'Last lap difference (as on the leaderboard)' },
      { key: 'range', label: 'Arrow: gap at the far end (s)', type: 'number', def: 10, min: 1, max: 120 },
      { key: 'close', label: 'Arrow turns green / red under (s)', type: 'number', def: 1.5, min: 0, max: 30, step: 0.1 },
      { key: 'textSize', label: 'Text size (%)', type: 'number', def: 100, min: 60, max: 160 }] });
  if (typeof module !== 'undefined') module.exports = { BASE_W: BASE_W, BASE_H: BASE_H, K: K };
})(typeof window !== 'undefined' ? window : globalThis);
