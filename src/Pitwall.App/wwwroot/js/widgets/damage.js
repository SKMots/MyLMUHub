// Damage (SimHub "DmP"): the car's 8 body zones coloured by dent severity, the 4 wheels (purple = detached, blue = flat), and AERO / BODY / SUSP condition.
// BODY = 1 - dent sum / 16. AERO and SUSP come from the game's web API (repair screen, DamageParse): only for your own car, -- while you watch someone else
// or when the game does not give them. Data: state.car (focus car's telemetry).
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format, D = P.dom;
  // zone positions (design units) and the dent index the game uses for them
  var ZONES = [[859, 517.1, 1], [881, 517.1, 0], [903, 517.1, 7], [859, 554.9, 2], [903, 554.9, 6], [859, 592.6, 3], [881, 592.6, 4], [903, 592.6, 5]];
  var WHEELS = [[842, 521.1], [927, 521.1], [842, 596.6], [927, 596.6]];
  var T = P.panelWidget('damage', 'Damage', 775, 482.3, 235, 218.8, 'redAccent', [
    ['titles', 'Titles', 'label'], ['carCentre', 'Car centre', 'carBody'],
    ['zoneOk', 'Body zone: no damage', 'dmgOk'], ['zoneLight', 'Body zone: light damage', 'dmgLight'], ['zoneHeavy', 'Body zone: heavy damage', 'red'], ['zoneOff', 'Body zone: part detached', 'purple'],
    ['wheelOk', 'Wheel: OK', 'noData'], ['wheelFlat', 'Wheel: flat tyre', 'red'], ['wheelOff', 'Wheel: missing (detached)', 'red'], ['engine', 'Engine off / overheating (flashes)', 'red'],
    ['suspLight', 'Wheel: suspension damaged', 'dmgLight'], ['suspHeavy', 'Wheel: suspension badly damaged', 'red'],
    ['good', 'Condition 90 % or more', 'green'], ['fair', 'Condition 60-90 %', 'yellow'], ['bad', 'Condition under 60 %', 'red'], ['none', 'Condition: no data', 'label']],
    [['zones', 'Car body zones'], ['wheels', 'Wheels'], ['aero', 'AERO %'], ['body', 'BODY %'], ['susp', 'SUSP %']],
  function (k, e, K) {
    k.txt(784, 487.3, 140, 15.9, 15, 600, 'left', K.titles, 'DAMAGE');
    e.engine = k.txt(890, 486.3, 115, 17.9, 17, 800, 'right', K.engine); e.engine.className += ' pw-flash'; D.show(e.engine, false);   // flashes only while there is a problem
    var mid = k.rect(881, 554.9, 21, 35.8, K.carCentre);
    e.zones = ZONES.map(function (z) { return k.rect(z[0], z[1], 21, 35.8, K.zoneOk); });
    e.wheels = WHEELS.map(function (w) { return k.rect(w[0], w[1], 14, 27.8, K.wheelOk); });
    k.hideIf('zones', e.zones.concat([mid])); k.hideIf('wheels', e.wheels);
    e.v = {};
    [['aero', 778, 'AERO'], ['body', 856, 'BODY'], ['susp', 934, 'SUSP']].forEach(function (a) {
      var l = k.txt(a[1], 642.4, 72, 13.9, 15, 600, 'center', K.titles, a[2]); e.v[a[0]] = k.txt(a[1], 656.3, 72, 33.8, 28, 700, 'center', K.none, '--'); k.hideIf(a[0], [l, e.v[a[0]]]);
    });
    var DENT = { none: K.zoneOk, light: K.zoneLight, heavy: K.zoneHeavy, detached: K.zoneOff }, WHEEL = { ok: K.wheelOk, flat: K.wheelFlat, detached: K.wheelOff };
    var COND = { none: K.none, good: K.good, fair: K.fair, bad: K.bad };
    return function (state) {
      var c = state.car || {};                                              // no game: the frame with dashes
      var dents = c.dents || [];
      for (var i = 0; i < ZONES.length; i++) { var idx = ZONES[i][2]; D.bg(e.zones[i], F.dentColor(idx === 4 && c.detached ? 3 : dents[idx], DENT)); }
      // a wheel: detached / flat first, else its suspension damage (repair screen, your car only: from 2 % light, from 25 % heavy)
      for (i = 0; i < 4; i++) { var wc = F.wheelColor((c.wheels || [])[i], WHEEL), sd = (c.suspWheels || [])[i]; if (wc === K.wheelOk && sd >= 0.02) wc = sd >= 0.25 ? K.suspHeavy : K.suspLight; D.bg(e.wheels[i], wc); }
      var eng = c.engine === 'off' ? 'ENGINE OFF' : (c.engine === 'overheat' ? 'OVERHEATING' : ''); D.show(e.engine, !!eng); if (eng) D.text(e.engine, eng);
      ['aero', 'body', 'susp'].forEach(function (k) { var v = c[k]; D.text(e.v[k], v >= 0 ? Math.round(v * 100) + '%' : '--'); D.color(e.v[k], F.condColor(v, COND)); });
    };
  });
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
