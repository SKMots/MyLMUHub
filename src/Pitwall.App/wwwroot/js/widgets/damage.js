// Damage (SimHub "DmP"): the car's 8 body zones coloured by dent severity, the 4 wheels (purple = detached, blue = flat), and AERO / BODY / SUSP condition.
// BODY = 1 - dent sum / 16. AERO and SUSP come from the game's web API (repair screen, DamageParse): only for your own car, -- while you watch someone else
// or when the game does not give them. Data: state.car (focus car's telemetry).
// Two looks (option Look): Modern (default: a GT car seen from above, its body parts coloured, AERO / BODY / SUSP with bars) and Classic (the SimHub panel).
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
    ['good', 'Condition 90 % or more', 'green'], ['fair', 'Condition 60-90 %', 'yellow'], ['bad', 'Condition under 60 %', 'red'], ['none', 'Condition: no data', 'label'],
    ['barBg', 'Modern: condition bar background', 'rowLine'], ['outline', 'Modern: car outline', 'border']],
    [{ key: 'look', label: 'Look', type: 'select', def: 'modern', choices: [['modern', 'Modern (a GT car from above)'], ['classic', 'Classic (the SimHub panel)']] }, ['zones', 'Car body zones'], ['wheels', 'Wheels'], ['aero', 'AERO %'], ['body', 'BODY %'], ['susp', 'SUSP %']],
  function (k, e, K) {
    if (k.opt('look', 'modern') === 'modern') return modern(k, e, K);
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
  // ---------- Modern look ----------
  // a GT car (GT3) from above, nose up, drawn in a 100 x 220 box: a closed body with wheel arches, the tyres showing at the arches, the cabin, a wide rear wing.
  // Body parts = the game's 8 dent zones (0 front, 1 front-left, 2 left, 3 rear-left, 4 rear, 5 rear-right, 6 right, 7 front-right), cut out of the body
  // shape; the front splitter and the rear wing take the colour of the front / rear part.
  var BODY = 'M50 5C70 5 83 8 87 17L89 34C93 40 93 60 89 66L88 84L88 142L89 152C93 158 93 180 89 186L88 200C86 210 75 213 50 213C25 213 14 210 12 200L11 186' +
             'C7 180 7 158 11 152L12 142L12 84L11 66C7 60 7 40 11 34L13 17C17 8 30 5 50 5Z';
  var PARTS = [[0, '34,0 66,0 66,60 34,60'], [1, '0,0 34,0 34,60 0,72'], [7, '66,0 100,0 100,72 66,60'], [2, '0,72 34,60 34,150 0,156'], [6, '66,60 100,72 100,156 66,150'],
               [3, '0,156 34,150 34,220 0,220'], [5, '66,150 100,156 100,220 66,220'], [4, '34,150 66,150 66,220 34,220']];
  var TYRES = [[3, 32, 13, 36], [84, 32, 13, 36], [3, 151, 13, 38], [84, 151, 13, 38]], uid = 0;
  function carSvg(id, z, w, K) {
    var s = '<svg viewBox="0 0 100 220" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block">' +
      '<defs><clipPath id="' + id + '"><path d="' + BODY + '"/></clipPath></defs>';
    TYRES.forEach(function (t, i) { s += '<rect x="' + t[0] + '" y="' + t[1] + '" width="' + t[2] + '" height="' + t[3] + '" rx="3" style="fill:' + w[i] + '"/>'; });   // under the arches
    s += '<rect x="18" y="1" width="64" height="6" rx="2" style="fill:' + z[0] + '"/>';                                       // front splitter
    s += '<g clip-path="url(#' + id + ')">' + PARTS.map(function (p) { return '<polygon points="' + p[1] + '" style="fill:' + z[p[0]] + ';stroke:' + K.bg + ';stroke-width:2.2"/>'; }).join('') + '</g>';
    s += '<path d="' + BODY + '" style="fill:none;stroke:' + K.outline + ';stroke-width:1.5"/>';
    s += '<path d="M20 12L32 9L30 16L19 18Z M80 12L68 9L70 16L81 18Z" fill="rgba(255,255,255,0.30)"/>';                     // headlights
    s += '<path d="M40 30L60 30M42 38L58 38" style="stroke:' + K.bg + ';stroke-width:2;stroke-linecap:round"/>';             // bonnet vents
    s += '<path d="M8 76L14 74L14 82L8 82Z M92 76L86 74L86 82L92 82Z" style="fill:' + K.carCentre + '"/>';                   // mirrors
    s += '<path d="M28 82C34 72 66 72 72 82L74 140C66 150 34 150 26 140Z" style="fill:' + K.carCentre + ';stroke:' + K.bg + ';stroke-width:2"/>';   // cabin
    s += '<path d="M31 84C37 77 63 77 69 84L67 96C57 92 43 92 33 96Z" fill="rgba(255,255,255,0.14)"/>';                    // windscreen
    s += '<path d="M33 136C43 140 57 140 67 136L65 144C57 147 43 147 35 144Z" fill="rgba(255,255,255,0.10)"/>';             // rear window
    s += '<rect x="30" y="190" width="4" height="12" style="fill:' + z[4] + '"/><rect x="66" y="190" width="4" height="12" style="fill:' + z[4] + '"/>';   // wing stands
    s += '<rect x="7" y="198" width="86" height="9" rx="2" style="fill:' + z[4] + ';stroke:' + K.bg + ';stroke-width:1.5"/>';  // rear wing
    return s + '</svg>';
  }
  function modern(k, e, K) {
    var X = 775, Y = 482.3, id = 'pwDmgClip' + (++uid);
    k.txt(X + 9, Y + 5, 120, 15.9, 15, 600, 'left', K.titles, 'DAMAGE');
    e.engine = k.txt(X + 115, Y + 4, 115, 17.9, 17, 800, 'right', K.engine); e.engine.className += ' pw-flash'; D.show(e.engine, false);
    e.car = k.rect(X + 8, Y + 26, 96, 186); e.carKey = '';
    if (!k.show('zones') && !k.show('wheels')) D.show(e.car, false);
    e.v = {}; e.bar = {}; e.barW = 112;
    [['aero', 'AERO'], ['body', 'BODY'], ['susp', 'SUSP']].forEach(function (a, i) {
      var y = Y + 30 + i * 61, l = k.txt(X + 114, y, 112, 14, 15, 600, 'left', K.titles, a[1]);
      e.v[a[0]] = k.txt(X + 114, y + 14, 112, 28, 30, 700, 'left', K.none, '--');
      var bg = k.rect(X + 114, y + 46, e.barW, 4, K.barBg), bar = k.rect(X + 114, y + 46, e.barW, 4, K.none); bar._dynW = true; bg.style.borderRadius = bar.style.borderRadius = '4px';
      e.bar[a[0]] = bar; k.hideIf(a[0], [l, e.v[a[0]], bg, bar]);
    });
    var DENT = { none: K.zoneOk, light: K.zoneLight, heavy: K.zoneHeavy, detached: K.zoneOff }, WHEEL = { ok: K.wheelOk, flat: K.wheelFlat, detached: K.wheelOff };
    var COND = { none: K.none, good: K.good, fair: K.fair, bad: K.bad }, showZ = k.show('zones'), showW = k.show('wheels');
    return function (state) {
      var c = state.car || {}, dents = c.dents || [], z = [], w = [];
      for (var i = 0; i < 8; i++) z.push(showZ ? F.dentColor(i === 4 && c.detached ? 3 : dents[i], DENT) : K.zoneOk);
      for (i = 0; i < 4; i++) { var wc = F.wheelColor((c.wheels || [])[i], WHEEL), sd = (c.suspWheels || [])[i]; if (wc === K.wheelOk && sd >= 0.02) wc = sd >= 0.25 ? K.suspHeavy : K.suspLight; w.push(showW ? wc : K.wheelOk); }
      e.zoneColors = z; e.wheelColors = w;
      var key = z.join('|') + '|' + w.join('|'); if (key !== e.carKey) { e.car.innerHTML = carSvg(id, z, w, K); e.carKey = key; }   // drawn again only when a colour changes
      var eng = c.engine === 'off' ? 'ENGINE OFF' : (c.engine === 'overheat' ? 'OVERHEATING' : ''); D.show(e.engine, !!eng); if (eng) D.text(e.engine, eng);
      ['aero', 'body', 'susp'].forEach(function (n) {
        var v = c[n], col = F.condColor(v, COND), px = Math.round(k.ux(e.barW) * (v >= 0 ? Math.max(0, Math.min(1, v)) : 0)), b = e.bar[n];
        D.text(e.v[n], v >= 0 ? Math.round(v * 100) + '%' : '--'); D.color(e.v[n], col); D.bg(b, col);
        if (b._w !== px) { b.style.width = px + 'px'; b._w = px; }
      });
    };
  }
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
