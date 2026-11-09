// Track condition: small cards like the tyre temperature indicators: TRACK and AIR temperature (a bar + the value, coloured cold / good / warm / hot)
// and SURFACE: how wet the racing line is (the game's average path wetness: DRY / DAMP / WET ..., a bar filled by the wetness) and whether it rains now.
// Data: state.track = { road, air, raining (0..1), wetness (0..1) } (shared memory). Formerly the top line of the weather widget.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format, D = P.dom;
  var X = 1016, Y = 482.3, W = 242, H = 92, PAD = 6, TOP = 24, CH = H - TOP - PAD;
  var T = P.panelWidget('trackcond', 'Track condition', X, Y, W, H, 'green', [
    ['card', 'Cards', 'panelDark'], ['labels', 'Titles', 'label'], ['noData', 'No data', 'noData'], ['barBg', 'Bar background', 'rowLine'],
    ['cold', 'Temperature: cold', 'blue'], ['good', 'Temperature: good', 'green'], ['warm', 'Temperature: warm', 'yellow'], ['hot', 'Temperature: hot', 'red'],
    ['dry', 'Surface: dry', 'green'], ['damp', 'Surface: damp', 'yellow'], ['wet', 'Surface: wet', 'blue'], ['rain', 'Raining now', 'blue']],
    [['track', 'Track temperature'], ['air', 'Air temperature'], ['surface', 'Surface (wetness + rain)'],
     { key: 'tUnit', label: 'Temperature unit', type: 'select', def: 'C', choices: [['C', '°C'], ['F', '°F']] }],
  function (k, e, K) {
    var TU = k.opt('tUnit', 'C'), TW = 62, SW = W - 2 * TW - 4 * PAD;
    function round(el, r) { el.style.borderRadius = r + 'px'; return el; }
    k.txt(X + 9, Y + 5, 160, 15.9, 15, 600, 'left', K.labels, 'TRACK CONDITION');
    // a temperature card: a bar in the temperature's colour, the title, the value
    function tempCard(cx, name, key) {
      var o = {}, cy = Y + TOP;
      var parts = [round(k.rect(cx, cy, TW, CH, K.card), 12)];
      o.bar = round(k.rect(cx + 7, cy + 9, 6, CH - 18, K.noData), 6);
      parts.push(o.bar, k.txt(cx + 19, cy + 7, TW - 22, 14, 15, 700, 'left', K.labels, name));
      o.v = k.txt(cx + 19, cy + 23, TW - 20, 30, 32, 700, 'left', K.noData, '--'); parts.push(o.v);
      k.hideIf(key, parts); return o;
    }
    e.road = tempCard(X + PAD, 'TRACK', 'track');
    e.air = tempCard(X + 2 * PAD + TW, 'AIR', 'air');
    var sx = X + 3 * PAD + 2 * TW, cy = Y + TOP, sp = [round(k.rect(sx, cy, SW, CH, K.card), 12)];
    e.wetBg = round(k.rect(sx + 7, cy + 9, 6, CH - 18, K.barBg), 6);
    e.wetBar = round(k.rect(sx + 7, cy + 9, 6, CH - 18, K.wet), 6); e.wetBar._dynH = true; e.wetH = CH - 18; e.wetTop = cy + 9;
    sp.push(e.wetBg, e.wetBar, k.txt(sx + 19, cy + 7, SW - 22, 14, 15, 700, 'left', K.labels, 'SURFACE'));
    e.word = k.txt(sx + 19, cy + 22, SW - 22, 22, 24, 800, 'left', K.noData, '--');
    e.sub = k.txt(sx + 19, cy + 45, SW - 22, 14, 15, 700, 'left', K.labels);
    sp.push(e.word, e.sub); k.hideIf('surface', sp);
    var BAND = { none: K.noData, cold: K.cold, good: K.good, warm: K.warm, hot: K.hot }, SURF = { none: K.noData, dry: K.dry, damp: K.damp, wet: K.wet };
    return function (state) {
      var t = state.track || null;                                                     // no game: the cards with dashes
      [['road', e.road, 'road'], ['air', e.air, 'air']].forEach(function (a) {
        var v = t ? t[a[0]] : null, c = BAND[F.tempBand(v, a[2])];
        D.text(a[1].v, t ? F.deg(v, TU) : '--'); D.color(a[1].v, c); D.bg(a[1].bar, c);
      });
      var s = F.surface(t ? t.wetness : -1), rain = t && t.raining > 0 ? Math.round(t.raining * 100) : 0, sc = SURF[s.band];
      D.text(e.word, s.word); D.color(e.word, sc);
      D.text(e.sub, !t ? '' : rain > 0 ? 'RAINING ' + rain + '%' : (s.band === 'dry' ? 'NO RAIN' : 'WETNESS ' + s.pct)); D.color(e.sub, rain > 0 ? K.rain : K.labels);
      // the bar fills from the bottom with the wetness (at least a sliver, so DRY still shows its colour)
      var f = t && t.wetness >= 0 ? Math.max(0.06, Math.min(1, t.wetness)) : 0, full = k.uy(e.wetH), hgt = Math.round(full * f);
      var top = Math.round(k.uy(e.wetTop - Y) + full - hgt) + 'px';                     // set again after a resize (the panel puts it back at the top)
      if (e.wetBar._h !== hgt) { e.wetBar.style.height = hgt + 'px'; e.wetBar._h = hgt; }
      if (e.wetBar.style.top !== top) e.wetBar.style.top = top;
      D.bg(e.wetBar, sc);
    };
  });
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
