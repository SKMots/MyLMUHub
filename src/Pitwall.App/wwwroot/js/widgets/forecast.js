// Weather forecast (SimHub "FcP"): NOW + the next forecast points of this session with sky icon, rain chance (+ bar) and temperature.
// Data: state.forecast = { nodes, status } from the game's web API (not verified live yet: status shows what the app got), state.track for the session clock.
// Two looks (option Look): Modern (default: each point its own card, its background 'splash art' = the weather coming) and Classic (the SimHub rows).
// The track's own condition (temperature, wetness) is its own widget: trackcond.js.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format, D = P.dom;
  var T = P.panelWidget('forecast', 'Weather forecast', 1016, 482.3, 242, 218.8, 'blue', [
    ['titles', 'Title + times', 'label'], ['rain', 'Rain chance', 'blue'], ['temp', 'Temperature', 'white'], ['barBg', 'Rain bar background', 'rowLine'],
    ['bar', 'Rain bar', 'blue'], ['noData', '"No forecast" + status text', 'faint'], ['cardText', 'Modern: card text', 'white'],
    ['iconSun', 'Icon: sun (line / duotone icons)', 'yellow'], ['iconCloud', 'Icon: cloud', 'muted'], ['iconRain', 'Icon: rain', 'blue'], ['iconBolt', 'Icon: lightning', 'yellow']],
    [{ key: 'look', label: 'Look', type: 'select', def: 'modern', choices: [['modern', 'Modern (a card per forecast point)'], ['classic', 'Classic (the SimHub rows)']] },
     ['icon', 'Weather icon'], ['rain', 'Rain chance'], ['bar', 'Rain bar (classic)'], ['temp', 'Temperature'], ['status', 'Status line (game API)'],
     { key: 'tUnit', label: 'Temperature unit', type: 'select', def: 'C', choices: [['C', '\u00B0C'], ['F', '\u00B0F']] }],
  function (k, e, K) {
    if (k.opt('look', 'modern') === 'modern') return modern(k, e, K);
    var TU = k.opt('tUnit', 'C'), want = { i: k.show('icon'), r: k.show('rain'), bg: k.show('bar'), bar: k.show('bar'), a: k.show('temp') };
    k.txt(1024, 487.3, 200, 15.9, 15, 600, 'left', K.titles, 'WEATHER FORECAST');
    e.off = k.txt(1024, 566.8, 220, 23.8, 18, 600, 'left', K.noData, 'NO FORECAST DATA');
    e.status = k.txt(1024, 592, 228, 12, 12, 600, 'left', K.noData); k.hideIf('status', [e.status]);   // under NO FORECAST DATA
    e.rows = [];
    for (var r = 0; r < 5; r++) {
      var y = 505.2 + r * 35.78, o = {};
      o.t = k.txt(1024, y, 56, 29.8, 21, 600, 'left', K.titles); o.i = k.img(1084, y, 30, 29.9); o.svg = k.rect(1084, y, 30, 29.9);
      o.r = k.txt(1120, y, 66, 29.8, 24, 700, 'left', K.rain); o.a = k.txt(1190, y, 60, 29.8, 24, 700, 'right', K.temp);
      o.bg = k.rect(1120, y + 29.8, 66, 3, K.barBg); o.bar = k.rect(1120, y + 29.8, 66, 3, K.bar); o.bar._dynW = true; o.full = function () { return k.ux(66); };
      o.all = [['t', o.t], ['i', o.i], ['i', o.svg], ['r', o.r], ['a', o.a], ['bg', o.bg], ['bar', o.bar]]; e.rows.push(o);
    }
    var IC = { sun: K.iconSun, cloud: K.iconCloud, rain: K.iconRain, bolt: K.iconBolt };
    // the theme's icon style: the original image, or drawn in this widget's colours (redrawn only when the sky or the style changes)
    function icon(o, w) {
      var style = (P.theme && P.theme.iconStyle) || 'classic', on = want.i;
      if (style === 'classic') { D.src(o.i, 'assets/icons/' + w.icon + '.png'); D.show(o.svg, false); D.show(o.i, on); return; }
      var key = style + w.icon; if (o.svg._k !== key) { o.svg.innerHTML = P.icons.weather(w.icon === 'wx_na' ? -1 : parseInt(w.icon.slice(3), 10), style, IC); o.svg._k = key; }
      D.show(o.i, false); D.show(o.svg, on);
    }
    return function (state) {
      var fc = state.forecast, tr = state.track || {};
      if (fc === undefined) return false;                                             // no app data at all (old message)
      var nodes = fc && fc.nodes, rows = F.forecastRows(nodes, tr.sessionLength, tr.elapsed), any = false;
      for (var i = 0; i < 5; i++) {
        var o = e.rows[i], w = rows[i]; o.all.forEach(function (x) { D.show(x[1], w.show && want[x[0]] !== false); }); if (!w.show) continue; any = true;
        D.text(o.t, w.label); icon(o, w); D.text(o.r, w.rain); D.text(o.a, w.tempC === null ? '--' : F.deg(w.tempC, TU));
        var bw = Math.round(o.full() * w.rainW); if (o.bar._w !== bw) { o.bar.style.width = bw + 'px'; o.bar._w = bw; }
      }
      D.show(e.off, !any); D.text(e.status, !any && fc && fc.status ? fc.status : '');
    };
  });
  // ---------- Modern look: a card per forecast point. The card's background is its 'splash art' (css/theme.css .pw-wx-card[data-art]: a gradient + rain
  // streaks for the kind of weather, the sky drawn big on the right), so the weather coming reads at a glance. Static: no animation. Drawn again only when
  // the sky of a card changes.
  var ART_ICON = { sun: '#FFD84D', cloud: '#EEF3F8', rain: '#8EC9FF', bolt: '#FFE066' };
  function modern(k, e, K) {
    var X = 1016, Y = 482.3, CW = 230, CH = 36.5, GAP = 2.4, TU = k.opt('tUnit', 'C'), want = { i: k.show('icon'), r: k.show('rain'), a: k.show('temp') };
    k.txt(X + 8, Y + 5, 200, 15.9, 15, 600, 'left', K.titles, 'WEATHER FORECAST');
    e.off = k.txt(X + 8, Y + 84.5, 220, 23.8, 18, 600, 'left', K.noData, 'NO FORECAST DATA');
    e.status = k.txt(X + 8, Y + 109.7, 228, 12, 12, 600, 'left', K.noData); k.hideIf('status', [e.status]);
    e.rows = [];
    for (var r = 0; r < 5; r++) {
      var x = X + 6, y = Y + 24 + r * (CH + GAP), o = {};
      o.card = k.rect(x, y, CW, CH); o.card.className += ' pw-wx-card'; o.card._k = '';
      o.t = k.txt(x + 8, y, 54, CH, 21, 800, 'left', K.cardText);
      o.n = k.txt(x + 62, y + 4, 120, 16, 15, 800, 'left', K.cardText);
      o.r = k.txt(x + 62, y + 19, 90, 14, 14, 700, 'left', K.cardText);
      o.a = k.txt(x + CW - 58, y, 50, CH, 25, 700, 'right', K.cardText);
      [o.t, o.n, o.r, o.a].forEach(function (t) { t.style.textShadow = '0 1px 3px rgba(0,0,0,0.75)'; });
      o.all = [o.card, o.t, o.n, o.r, o.a]; e.rows.push(o);
    }
    return function (state) {
      var fc = state.forecast, tr = state.track || {};
      if (fc === undefined) return false;
      var rows = F.forecastRows(fc && fc.nodes, tr.sessionLength, tr.elapsed), any = false;
      for (var i = 0; i < 5; i++) {
        var o = e.rows[i], w = rows[i]; o.all.forEach(function (x) { D.show(x, w.show); }); if (!w.show) continue; any = true;
        var art = F.skyArt(w.sky), key = art + '|' + w.sky + '|' + want.i;
        if (o.card._k !== key) {
          o.card.setAttribute('data-art', art);
          o.card.innerHTML = '<div class="pw-wx-art"></div>' + (want.i ? '<div class="pw-wx-icon">' + P.icons.weather(w.sky, 'duo', ART_ICON) + '</div>' : '') + '<div class="pw-wx-fade"></div>';
          o.card._k = key;
        }
        D.text(o.t, w.label); D.text(o.n, F.skyName(w.sky));
        D.text(o.r, want.r ? 'RAIN ' + w.rain : ''); D.text(o.a, want.a ? (w.tempC === null ? '--' : F.deg(w.tempC, TU)) : '');
      }
      D.show(e.off, !any); D.text(e.status, !any && fc && fc.status ? fc.status : '');
    };
  }
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
