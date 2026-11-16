// A team-mate's car, live (2026-11-16): the Team tab's live view (desktop) and the website's live page draw it with this one file (the server keeps a copy in
// wwwroot/js/shared). Data = their app's CarView: wheels (wear, temperature, pressure, flat, detached), the 8 body dent zones, a detached part, aero / body /
// suspension condition and the suspension damage per wheel (the game's repair screen), the engine state, the compound and the car's settings.
// The car is the dashboard damage widget's GT car from above: every body part in the colour of its damage, the tyres coloured by temperature unless something
// is wrong with that wheel (flat = red, missing = dashed outline, suspension damage = a ring); beside it the condition bars and a plain list of what is wrong.
// No style="" anywhere (the website's Content-Security-Policy blocks them): colours are SVG attributes; widths and colours of bars are data-w / data-bg / data-col,
// set by paint(root) through the DOM. Pure string building (tests/js/live-car.test.js).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, F = P.format;
  var C = { ok: '#1E262B', light: '#FFD21F', heavy: '#FF5A5F', off: '#B47CFF', edge: '#0A0C0E', line: '#3A4348', cabin: '#2A3237', green: '#3DDC84', none: '#5C686D', text: '#E9EEEF', dim: '#94A1A6' };
  var WHEEL = ['Front left', 'Front right', 'Rear left', 'Rear right'];
  // the game's 8 dent zones: 0 front, 1 front-left, 2 left, 3 rear-left, 4 rear, 5 rear-right, 6 right, 7 front-right
  var ZONE = ['Front', 'Front left', 'Left side', 'Rear left', 'Rear', 'Rear right', 'Right side', 'Front right'];
  var BODY = 'M50 5C70 5 83 8 87 17L89 34C93 40 93 60 89 66L88 84L88 142L89 152C93 158 93 180 89 186L88 200C86 210 75 213 50 213C25 213 14 210 12 200L11 186' +
             'C7 180 7 158 11 152L12 142L12 84L11 66C7 60 7 40 11 34L13 17C17 8 30 5 50 5Z';
  var PARTS = [[0, '34,0 66,0 66,60 34,60'], [1, '0,0 34,0 34,60 0,72'], [7, '66,0 100,0 100,72 66,60'], [2, '0,72 34,60 34,150 0,156'], [6, '66,60 100,72 100,156 66,150'],
               [3, '0,156 34,150 34,220 0,220'], [5, '66,150 100,156 100,220 66,220'], [4, '34,150 66,150 66,220 34,220']];
  var TYRES = [[3, 32, 13, 36], [84, 32, 13, 36], [3, 151, 13, 38], [84, 151, 13, 38]], uid = 0;

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dent(c, i) { var d = (c.dents || [])[i]; return i === 4 && c.detached && !(d >= 3) ? 3 : d > 0 ? d : 0; }
  function dentColor(d) { return d >= 3 ? C.off : d >= 2 ? C.heavy : d >= 1 ? C.light : C.ok; }
  function flat(w) { return !!(w && !w.detached && (w.flat || (w.pressure >= 0 && w.pressure <= 1))); }
  function susp(c, i) { var s = (c.suspWheels || [])[i]; return s >= 0 ? s : 0; }

  // what is wrong, worst first: [level 3 = bad / 2 = damaged / 1 = light, text]
  function problems(c) {
    var out = [], ws = c.wheels || [];
    if (c.engine === 'off') out.push([3, 'Engine off']); else if (c.engine === 'overheat') out.push([3, 'Engine overheating']);
    ws.forEach(function (w, i) {
      if (w && w.detached) out.push([3, WHEEL[i] + ' wheel missing']);
      else if (flat(w)) out.push([3, WHEEL[i] + ' tyre flat / punctured']);
      var s = susp(c, i); if (s >= 0.02) out.push([s >= 0.25 ? 3 : 2, WHEEL[i] + ' suspension ' + Math.round(s * 100) + ' % damaged']);
    });
    for (var i = 0; i < 8; i++) { var d = dent(c, i); if (d >= 3) out.push([3, ZONE[i] + ': part came off']); else if (d >= 2) out.push([2, ZONE[i] + ': heavy damage']); else if (d >= 1) out.push([1, ZONE[i] + ': light damage']); }
    if (c.aero >= 0 && c.aero < 0.9) out.push([c.aero < 0.6 ? 3 : 2, 'Aero ' + Math.round((1 - c.aero) * 100) + ' % damaged: slower in fast corners']);
    return out.sort(function (a, b) { return b[0] - a[0]; });
  }

  function carSvg(c) {
    var id = 'lcClip' + (++uid), ws = c.wheels || [], s = '<svg class="lc-svg" viewBox="-96 0 292 222"><defs><clipPath id="' + id + '"><path d="' + BODY + '"/></clipPath></defs>';
    TYRES.forEach(function (t, i) {
      var w = ws[i] || {}, sd = susp(c, i), hasT = w.temp !== null && w.temp !== undefined;
      if (sd >= 0.02) s += '<rect x="' + (t[0] - 3) + '" y="' + (t[1] - 3) + '" width="' + (t[2] + 6) + '" height="' + (t[3] + 6) + '" rx="5" fill="none" stroke="' + (sd >= 0.25 ? C.heavy : C.light) + '" stroke-width="2"/>';
      if (w.detached) s += '<rect x="' + t[0] + '" y="' + t[1] + '" width="' + t[2] + '" height="' + t[3] + '" rx="3" fill="none" stroke="' + C.heavy + '" stroke-width="1.5" stroke-dasharray="3 2"/>';
      else s += '<rect x="' + t[0] + '" y="' + t[1] + '" width="' + t[2] + '" height="' + t[3] + '" rx="3" fill="' + (flat(w) ? C.heavy : hasT ? F.tyreTempColor(w.temp, C.line) : C.line) + '"/>';
      // beside the wheel: wear, temperature, pressure, or what is wrong
      var left = i % 2 === 0, x = left ? -8 : 108, a = left ? 'end' : 'start', y = t[1] + 8, lines = [];
      if (w.detached) lines.push(['lc-t1 lc-bad', 'MISSING']);
      else {
        lines.push(['lc-t1' + (flat(w) ? ' lc-bad' : ''), flat(w) ? 'FLAT' : w.wear >= 0 ? Math.round(w.wear * 100) + '%' : '--']);
        lines.push(['lc-t2', (hasT ? Math.round(w.temp) + '°' : '') + (w.pressure > 1 ? '  ' + Math.round(w.pressure) + ' kPa' : '')]);
      }
      if (sd >= 0.02) lines.push(['lc-t2 ' + (sd >= 0.25 ? 'lc-bad' : 'lc-warn'), 'susp ' + Math.round(sd * 100) + '%']);
      lines.forEach(function (l, k) { s += '<text x="' + x + '" y="' + (y + k * 14) + '" text-anchor="' + a + '" class="' + l[0] + '">' + esc(l[1]) + '</text>'; });
    });
    s += '<rect x="18" y="1" width="64" height="6" rx="2" fill="' + dentColor(dent(c, 0)) + '"/>';                                    // front splitter
    s += '<g clip-path="url(#' + id + ')">' + PARTS.map(function (p) { return '<polygon points="' + p[1] + '" fill="' + dentColor(dent(c, p[0])) + '" stroke="' + C.edge + '" stroke-width="2.2"/>'; }).join('') + '</g>';
    s += '<path d="' + BODY + '" fill="none" stroke="' + C.line + '" stroke-width="1.5"/>';
    s += '<path d="M28 82C34 72 66 72 72 82L74 140C66 150 34 150 26 140Z" fill="' + C.cabin + '" stroke="' + C.edge + '" stroke-width="2"/>';   // cabin
    s += '<path d="M31 84C37 77 63 77 69 84L67 96C57 92 43 92 33 96Z" fill="rgba(255,255,255,0.14)"/>';
    s += '<rect x="7" y="198" width="86" height="9" rx="2" fill="' + dentColor(dent(c, 4)) + '" stroke="' + C.edge + '" stroke-width="1.5"/>';  // rear wing
    return s + '</svg>';
  }

  function bar(label, v) {
    var col = F.condColor(v, { none: C.none, good: C.green, fair: C.light, bad: C.heavy });
    return '<div class="lc-row"><b>' + label + '</b><div class="lc-bar"><i data-w="' + (v >= 0 ? Math.round(Math.max(0, Math.min(1, v)) * 100) : 0) + '" data-bg="' + col + '"></i></div><span data-col="' + col + '">' + (v >= 0 ? Math.round(v * 100) + '%' : '--') + '</span></div>';
  }

  // the whole panel: the car + the condition bars, the list of what is wrong, compound and settings
  function html(c) {
    c = c || {};
    var cmp = F.compound(c.compound), list = problems(c);
    var right = (c.compound ? '<div class="lc-cmp"><span class="lc-cmpb ' + (cmp || 'MED').toLowerCase() + '">' + (cmp ? cmp.charAt(0) : '?') + '</span><span>' + esc(c.compound) + ' tyres</span></div>' : '') +
      bar('Aero', c.aero) + bar('Body', c.body) + bar('Suspension', c.susp) +
      '<div class="lc-list">' + (list.length ? list.map(function (p) { return '<div class="lc-p lc-l' + p[0] + '"><i></i>' + esc(p[1]) + '</div>'; }).join('') : '<div class="lc-p lc-l0"><i></i>No damage</div>') + '</div>' +
      '<div class="lc-set">' + esc([c.brakeBias > 0 ? 'BB ' + c.brakeBias.toFixed(1) + '%' : '', c.tc >= 0 ? 'TC ' + c.tc : '', c.abs >= 0 ? 'ABS ' + c.abs : '', c.map >= 0 ? 'Map ' + c.map : ''].filter(Boolean).join(' · ')) + '</div>';
    var key = '<div class="lc-key"><span><i class="k-ok"></i>no damage</span><span><i class="k-light"></i>light</span><span><i class="k-heavy"></i>heavy</span><span><i class="k-off"></i>part off</span></div>';
    return '<div class="lc"><div class="lc-car">' + carSvg(c) + key + '</div><div class="lc-info">' + right + '</div></div>';
  }
  // the bars' widths and colours (data-w / data-bg / data-col): set through the DOM
  function paint(el) {
    [].forEach.call(el.querySelectorAll('.lc [data-w]'), function (e) { e.style.width = e.getAttribute('data-w') + '%'; e.style.background = e.getAttribute('data-bg'); });
    [].forEach.call(el.querySelectorAll('.lc [data-col]'), function (e) { e.style.color = e.getAttribute('data-col'); });
  }

  P.liveCar = { html: html, paint: paint, problems: problems };
  if (typeof module !== 'undefined') module.exports = P.liveCar;
})(typeof window !== 'undefined' ? window : globalThis);
