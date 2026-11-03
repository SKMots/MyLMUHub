// Fuel + virtual energy (SimHub "FuP"): what is left with a bar, estimated laps, average of the last 5 laps (~ = estimate from the lap so far), last lap, and what to
// add for the rest of the race. Data: state.car.fuel / state.car.ve (UsageView, counted by the app: pit laps and the first partial lap are left out).
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format, D = P.dom;
  var ROWS = [552.9, 583.7, 614.5, 645.4];                                          // label y; the value sits 12.9 below
  var T = P.panelWidget('fuel', 'Fuel / energy', 520, 482.3, 245, 218.8, 'green', [
    ['titles', 'Titles + row names', 'label'], ['values', 'Values', 'white'], ['divider', 'Middle divider', 'track'], ['barBg', 'Bar background', 'rowLine'],
    ['fuelBar', 'Fuel bar', 'green'], ['veText', 'Energy %', 've'], ['veBar', 'Energy bar', 've'],
    ['mid', 'Under 30 % (text + bar)', 'yellow'], ['low', 'Under 15 % (text + bar)', 'red'], ['none', 'Energy: none', 'label'], ['race', 'Race laps left', 'label']],
    [['fuel', 'Fuel (left side)'], ['ve', 'Virtual energy (right side)'], ['estLaps', 'Estimated laps'], ['avg', 'Average of 5 laps'], ['lastLap', 'Last lap use'],
     ['add', 'Refuel / add energy'], ['race', 'Race laps left (bottom line)']],
  function (k, e, K) {
    var div = k.rect(642, 505.2, 0.8, 171, K.divider), ROWKEYS = ['estLaps', 'avg', 'lastLap', 'add'];
    function side(key, x, title, labels) {
      var o = { rows: [] }, all = [k.txt(x, 486.2, 108, 13.9, 15, 600, 'left', K.titles, title)];
      o.now = k.txt(x, 500.2, 108, 35.8, 30, 700, 'left', K.values);
      all.push(o.now, k.rect(x, 538, 108, 7, K.barBg)); o.bar = k.rect(x, 538, 108, 7, K.fuelBar); o.bar._dynW = true; o.full = function () { return k.ux(108); }; all.push(o.bar);
      ROWS.forEach(function (y, i) {
        var l = k.txt(x, y, 108, 12.9, 13, 600, 'left', K.titles, labels[i]), v = k.txt(x, y + 12.9, 108, 23.8, 24, 700, 'left', K.values);
        o.rows.push(v); all.push(l, v); k.hideIf(ROWKEYS[i], [l, v]);
      });
      k.hideIf(key, all);
      return o;
    }
    e.fuel = side('fuel', 528, 'FUEL', ['EST LAPS', 'AVG 5 LAPS', 'LAST LAP', 'REFUEL (L)']);
    e.ve = side('ve', 650, 'VIRTUAL ENERGY', ['EST LAPS', 'AVG 5 LAPS', 'LAST LAP', 'ADD ENERGY (%)']);
    e.race = k.txt(524, 679.2, 236, 13.9, 14, 700, 'center', K.race); k.hideIf('race', [e.race]);
    if (!k.show('fuel') || !k.show('ve')) D.show(div, false);
    var LVL = { none: K.none, low: K.low, mid: K.mid };
    function bar(o, p, okColor) {
      var w = p >= 0 ? Math.round(Math.min(100, p) / 100 * o.full()) : 0;
      if (o.bar._w !== w) { o.bar.style.width = w + 'px'; o.bar._w = w; } D.bg(o.bar, F.levelColor(p, okColor, LVL));
    }
    return function (state) {
      var c = state.car || {};                                              // no game: the frame with dashes
      var f = c.fuel || {}, v = c.ve || {};
      D.text(e.fuel.now, F.litres(f.now, 1)); bar(e.fuel, f.pct, K.fuelBar);
      D.text(e.fuel.rows[0], F.laps1(f.laps)); D.text(e.fuel.rows[1], F.perLap(f, 'L')); D.text(e.fuel.rows[2], f.last > 0 ? F.litres(f.last, 2) : '--'); D.text(e.fuel.rows[3], f.add > 0 ? F.litres(f.add, 1) : '--');
      D.text(e.ve.now, F.pct(v.now)); D.color(e.ve.now, F.levelColor(v.now, K.veText, LVL)); bar(e.ve, v.now, K.veBar);
      D.text(e.ve.rows[0], F.laps1(v.laps)); D.text(e.ve.rows[1], F.perLap(v, '%')); D.text(e.ve.rows[2], v.last > 0 ? F.pct(v.last, 2) : '--'); D.text(e.ve.rows[3], v.add > 0 ? F.pct(v.add) : '--');
      D.text(e.race, F.raceLaps(c.lapsLeft));
    };
  });
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
