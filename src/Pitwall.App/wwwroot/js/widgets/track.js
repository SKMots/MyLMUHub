// Track (SimHub "MapP"): track name, dry / wet / rain, class best lap, air + road temperature, game time + clock, and a map of the track with the focus class.
// The outline (state.map, sent when it changes, saved per track) is the game's own map when its web API gives one (incl. pit lane), else learned from where
// the cars drive. The cars are drawn where they are (state.track.cars x / z). Data: state.track (TrackView), state.standings.classBest.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format, D = P.dom;
  var MX = 900, MY = 89.5, MW = 330, MH = 323.2, PAD = 16;

  // world paths (lists of [x, z], null = a gap) -> one SVG path + tx(x, z) -> pixel position in the map box. x right, z up (north up).
  // A path whose two ends meet (the lap) is closed.
  function geometry(paths, bw, bh) {
    var all = [];
    (paths || []).forEach(function (p) { (p || []).forEach(function (q) { if (q) all.push(q); }); });
    if (all.length < 20) return null;
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    all.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, -q[1]); y1 = Math.max(y1, -q[1]); });
    var sc = Math.min((bw - 2 * PAD) / Math.max(1, x1 - x0), (bh - 2 * PAD) / Math.max(1, y1 - y0));
    var ox = (bw - (x1 - x0) * sc) / 2, oy = (bh - (y1 - y0) * sc) / 2, diag = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    function tx(x, z) { return [Math.round((ox + (x - x0) * sc) * 10) / 10, Math.round((oy + (-z - y0) * sc) * 10) / 10]; }
    var d = '';
    (paths || []).forEach(function (p) {
      for (var i = 0; i < p.length; i++) { if (!p[i]) continue; var xy = tx(p[i][0], p[i][1]); d += (i > 0 && p[i - 1] ? 'L' : 'M') + xy[0] + ',' + xy[1]; }
      var f = p[0], l = p[p.length - 1];
      if (f && l && p.length > 2 && Math.sqrt((f[0] - l[0]) * (f[0] - l[0]) + (f[1] - l[1]) * (f[1] - l[1])) < diag * 0.05) { var c = tx(f[0], f[1]); d += 'L' + c[0] + ',' + c[1]; }
    });
    return { d: d, tx: tx };
  }
  var T = P.panelWidget('track', 'Track / map', 775, 77.6, 483, 340.1, 'blue', [
    ['name', 'Track name', 'sector'], ['dry', 'Weather: dry', 'green'], ['wet', 'Weather: wet / rain', 'blue'], ['titles', 'Titles + game time', 'label'],
    ['best', 'Class best lap', 'purple'], ['temps', 'Air / road temperature', 'white'], ['clock', 'Clock', 'white'], ['iconAir', 'Icon: air (line / duotone icons)', 'muted'], ['iconRoad', 'Icon: road', 'muted'],
    ['line', 'Track line', 'muted'], ['car', 'Cars on the map', 'white'], ['carPit', 'Car in the pits', 'dim'], ['me', 'Your car', 'focusMark'], ['meRing', 'Your car: ring', 'panel'],
    ['clsHyper', 'Cars: Hypercar', 'red'], ['clsLmp2', 'Cars: LMP2', 'blue'], ['clsLmp3', 'Cars: LMP3', 'purple'], ['clsGt3', 'Cars: GT3', 'green'], ['clsGte', 'Cars: GTE', 'yellow'], ['clsOther', 'Cars: other class', 'accent'],
    ['flagGreen', 'Flag: track clear', 'green'], ['flagYellow', 'Flag: yellow (and the glow on the track)', 'yellow'], ['flagText', 'Flag: text on the flag', 'carBody']],
    [['map', 'Track map'], ['ring', 'Ring around the map (cars by lap position)'], ['legend', 'Colour key (you / classes)'], ['name', 'Track name'], ['weather', 'Dry / wet / rain'], ['best', 'Class best lap'], ['temps', 'Air + road temperature'],
     ['game', 'Game time'], ['clock', 'Clock'], ['flags', 'Flags: green / yellow box on the map + yellow glow where it is'],
     { key: 'clock', label: 'Clock format', type: 'select', def: '24', choices: [['24', '24 hours'], ['12', '12 hours (AM / PM)']] },
     { key: 'tUnit', label: 'Temperature unit', type: 'select', def: 'C', choices: [['C', '\u00B0C'], ['F', '\u00B0F']] },
     { key: 'line', label: 'Track line thickness', type: 'number', def: 9, min: 2, max: 30 },
     { key: 'dot', label: 'Car dot size', type: 'number', def: 14, min: 6, max: 40 }, { key: 'me', label: 'Your car dot size', type: 'number', def: 24, min: 8, max: 60 }],
  function (k, e, K) {
    var bw = k.u(MW), bh = k.u(MH);
    e.mapBox = k.rect(MX, MY, MW, MH); e.line = D.box('pw-map-line', e.mapBox, 0, 0, bw, bh); e.zoneBox = D.box('pw-map-zones', e.mapBox, 0, 0, bw, bh); e.dotsBox = D.box('pw-map-dots', e.mapBox, 0, 0, bw, bh);
    // the ring: a circle round the map, every car on it by how far round the lap it is (f 0..1, start / finish at the top, clockwise); the map inside it
    // every class in its own colour (you on top in yours); the key under the map lists the classes in the session
    var CLS = [[/hyper/, K.clsHyper, 'Hypercar'], [/lmp2.*elms|elms/, K.clsLmp2, 'LMP2 ELMS'], [/lmp2/, K.clsLmp2, 'LMP2'], [/lmp3/, K.clsLmp3, 'LMP3'], [/gt3/, K.clsGt3, 'GT3'], [/gte/, K.clsGte, 'GTE']];
    function clsOf(c) { var s = String(c.cls || '').toLowerCase(); for (var i = 0; i < CLS.length; i++) if (CLS[i][0].test(s)) return CLS[i]; return [null, K.clsOther, c.cls || 'Other']; }
    function colorOf(c) { return c.me ? K.me : (c.pit ? K.carPit : clsOf(c)[1]); }
    // the key: a short list on the left, under the class best lap (one line per colour)
    e.legend = k.rect(784, 172, 110, 150); var ls = e.legend.style; ls.fontSize = '17px'; ls.fontWeight = '600'; ls.lineHeight = '1.75'; ls.color = K.titles; ls.whiteSpace = 'nowrap';
    k.hideIf('legend', [e.legend]);
    function legend(cars) {
      var seen = {}, list = [];
      cars.forEach(function (c) { var k_ = clsOf(c); if (!seen[k_[2]]) { seen[k_[2]] = 1; list.push(k_); } });
      var key = list.map(function (x) { return x[2]; }).join('|'); if (e.legend._k === key) return; e.legend._k = key;
      function line(col, name) { return '<div><i style="display:inline-block;width:14px;height:14px;border-radius:50%;margin-right:10px;vertical-align:-1px;background:' + col + '"></i>' + name + '</div>'; }
      e.legend.innerHTML = cars.length ? line(K.me, 'You') + list.map(function (x) { return line(x[1], x[2]); }).join('') : '';
    }
    var RING = k.show('ring'); e.ring = D.box('pw-map-ring', e.mapBox, 0, 0, bw, bh); e.rdots = [];
    function ringGeo() { var R = Math.min(bw, bh) / 2 - 16; return { cx: bw / 2, cy: bh / 2, R: R, inner: Math.round(R * 2 * 0.74) }; }
    function drawRing() {
      if (!RING) { e.ring.innerHTML = ''; return; }
      var g = ringGeo(), t = g.cy - g.R;
      e.ring.innerHTML = '<svg width="' + bw + '" height="' + bh + '" style="position:absolute;left:0;top:0"><circle cx="' + g.cx + '" cy="' + g.cy + '" r="' + g.R +
        '" fill="none" style="stroke:' + K.line + ';stroke-opacity:.35" stroke-width="4"/><line x1="' + g.cx + '" y1="' + (t - 12) + '" x2="' + g.cx + '" y2="' + (t + 12) +
        '" style="stroke:' + K.titles + '" stroke-width="3"/></svg>';
    }
    drawRing();
    k.onResize(function () {                                                          // a stretched box: the map fits its new area (drawn again at the next update)
      bw = Math.round(k.ux(MW)); bh = Math.round(k.uy(MH));
      [e.line, e.zoneBox, e.dotsBox, e.ring].forEach(function (b) { b.style.width = bw + 'px'; b.style.height = bh + 'px'; });
      e.mapRef = undefined; e.zoneBox._k = undefined; drawRing();
    });
    // the map: the whole box, or (with the ring) a square inside the ring
    function mapGeo(paths) {
      if (!RING) return geometry(paths, bw, bh);
      var g = ringGeo(), s = g.inner, ox = (bw - s) / 2, oy = (bh - s) / 2, m = geometry(paths, s, s); if (!m) return null;
      return { d: m.d, off: [ox, oy], tx: function (x, z) { var p = m.tx(x, z); return [p[0] + ox, p[1] + oy]; } };
    }
    function rdot(i) {
      while (e.rdots.length <= i) { var d = D.box('pw-map-dot', e.dotsBox, 0, 0, 14, 14); d.style.borderRadius = '50%'; d.style.boxSizing = 'border-box'; d._sz = 14; e.rdots.push(d); }
      return e.rdots[i];
    }
    e.learn = k.txt(MX, MY + MH / 2 - 10, MW, 20, 18, 600, 'center', K.titles, 'LEARNING TRACK MAP…');
    // flags (like a TV broadcast): a box at the top of the map (green = clear, yellow = local yellow: sector + metres to it, full course yellow) and a still
    // yellow glow over the stretch of track where it is (state.track.flags, Flags.cs). The glow is drawn again only when it changes.
    e.flag = k.txt(MX + MW - 132, MY + 2, 130, 22, 15, 800, 'center', K.flagText); e.flag.style.borderRadius = '4px'; e.flag.style.letterSpacing = '.04em';
    function flags(fl) {
      var on = FLAGS && showMap && !!fl && fl.state !== 'none';
      D.show(e.flag, on);
      D.text(e.flag, !on ? '' : fl.state === 'fcy' ? 'FULL COURSE YELLOW' : fl.state === 'yellow' ? 'YELLOW ' + fl.sectors.map(function (s) { return 'S' + s; }).join(' ') +
        (fl.ahead >= 0 ? ' · ' + Math.round(fl.ahead) + ' m' : '') : 'TRACK CLEAR');
      D.bg(e.flag, on && fl.state !== 'green' ? K.flagYellow : K.flagGreen);
      var zones = on && e.geo && fl.zones ? fl.zones : [], key = JSON.stringify(zones) + '|' + (e.geo ? e.geo.d.length : 0);
      if (e.zoneBox._k === key) return; e.zoneBox._k = key;
      var d = ''; zones.forEach(function (z) { z.forEach(function (q, i) { var p = e.geo.tx(q[0], q[1]); d += (i ? 'L' : 'M') + p[0] + ',' + p[1]; }); });
      function stroke(w, op) { return '<path d="' + d + '" fill="none" style="stroke:' + K.flagYellow + ';stroke-opacity:' + op + '" stroke-width="' + w + '" stroke-linejoin="round" stroke-linecap="round"/>'; }
      e.zoneBox.innerHTML = d ? '<svg width="' + bw + '" height="' + bh + '" style="position:absolute;left:0;top:0">' + stroke(LINE * 3, '.3') + stroke(LINE, '.95') + '</svg>' : '';
    }
    e.name = k.txt(784, 81.5, 300, 19.9, 22, 600, 'left', K.name);
    e.wx = k.txt(784, 99.4, 200, 17.9, 22, 700, 'left', K.dry);
    var bestT = k.txt(784, 127.3, 200, 15.9, 16, 600, 'left', K.titles, 'CLASS BEST LAP'); e.best = k.txt(784, 141.2, 200, 21.9, 26, 700, 'left', K.best);
    var airI = k.img(784, 355, 24, 23.8, 'assets/icons/ic_air.png'), airS = k.rect(784, 355, 24, 23.8); e.air = k.txt(814, 356, 90, 23.8, 26, 600, 'left', K.temps);
    var roadI = k.img(784, 378.9, 24, 23.8, 'assets/icons/ic_track.png'), roadS = k.rect(784, 378.9, 24, 23.8); e.road = k.txt(814, 379.8, 90, 23.8, 26, 600, 'left', K.temps);
    e.game = k.txt(1100, 348, 150, 19.9, 18, 600, 'right', K.titles); e.clock = k.txt(1100, 369.9, 150, 33.8, 34, 700, 'right', K.clock);
    e.dots = []; e.geo = null; e.mapRef = undefined; var FLAGS = k.show('flags'), showMap = k.show('map'), TU = k.opt('tUnit', 'C'), H12 = k.opt('clock', '24') === '12', DOT = k.opt('dot', 14), ME = k.opt('me', 24), LINE = k.opt('line', 9);
    k.hideIf('map', [e.mapBox]); k.hideIf('name', [e.name]); k.hideIf('weather', [e.wx]); k.hideIf('best', [bestT, e.best]);
    var showTemps = k.show('temps'); k.hideIf('temps', [airI, e.air, roadI, e.road]); e.icons = [airI, airS, roadI, roadS];
    // the theme's icon style: the original images, or drawn in this widget's colours
    function icons() {
      var style = (P.theme && P.theme.iconStyle) || 'classic'; if (airS._k === style) return; airS._k = style;
      var drawn = style !== 'classic';
      if (drawn) { airS.innerHTML = P.icons.air(style, K.iconAir); roadS.innerHTML = P.icons.road(style, K.iconRoad); }
      D.show(airI, showTemps && !drawn); D.show(roadI, showTemps && !drawn); D.show(airS, showTemps && drawn); D.show(roadS, showTemps && drawn);
    } k.hideIf('game', [e.game]); k.hideIf('clock', [e.clock]);
    function dot(i) {
      while (e.dots.length <= i) { var d = D.box('pw-map-dot', e.dotsBox, 0, 0, 14, 14); d.style.borderRadius = '50%'; d.style.boxSizing = 'border-box'; d._sz = 14; e.dots.push(d); }
      return e.dots[i];
    }
    function place(d, xy, size, color, border) {
      if (d._sz !== size) { d.style.width = d.style.height = size + 'px'; d._sz = size; }
      D.left(d, Math.round(xy[0] - size / 2)); var top = Math.round(xy[1] - size / 2); if (d._top !== top) { d.style.top = top + 'px'; d._top = top; }
      D.bg(d, color); if (d._bd !== border) { d.style.border = border; d._bd = border; }
    }
    return function (state) {
      var t = state.track || {}, live = !!state.track;                       // no game: the frame with dashes
      if (state.map !== e.mapRef) {                                                   // a new outline: redraw the line (rare)
        e.mapRef = state.map; e.geo = state.map ? mapGeo(state.map.paths) : null;
        var off = e.geo && e.geo.off ? ' transform="translate(' + e.geo.off[0] + ' ' + e.geo.off[1] + ')"' : '';
        e.line.innerHTML = e.geo ? '<svg width="' + bw + '" height="' + bh + '" style="position:absolute;left:0;top:0"><path d="' + e.geo.d + '"' + off +
          ' fill="none" style="stroke:' + K.line + ';stroke-opacity:.5" stroke-width="' + LINE + '" stroke-linejoin="round" stroke-linecap="round"/></svg>' : '';
      }
      D.show(e.learn, showMap && !(state.map && state.map.complete) && !e.geo);
      var cars = (t.cars || []).slice().sort(function (a, b) { return (a.me ? 1 : 0) - (b.me ? 1 : 0); }), n = 0;   // the focus car drawn last (on top)
      if (e.geo) cars.forEach(function (c) { if (!c.x && !c.z) return; place(dot(n++), e.geo.tx(c.x, c.z), c.me ? ME : DOT, colorOf(c), c.me ? '3px solid ' + K.meRing : 'none'); });
      legend(cars); flags(live ? t.flags : null);
      for (var i = 0; i < e.dots.length; i++) D.show(e.dots[i], i < n);
      var rn = 0;
      if (RING && showMap) {
        var g = ringGeo();
        cars.forEach(function (c) {
          if (!(c.f >= 0)) return;
          var a = c.f * 2 * Math.PI - Math.PI / 2;
          place(rdot(rn++), [g.cx + g.R * Math.cos(a), g.cy + g.R * Math.sin(a)], c.me ? ME : DOT, colorOf(c), c.me ? '3px solid ' + K.meRing : 'none');
        });
      }
      for (i = 0; i < e.rdots.length; i++) D.show(e.rdots[i], i < rn);
      D.text(e.name, String(t.name || '').toUpperCase());
      D.text(e.wx, live ? F.weatherText(t.raining, t.wetness) : '--'); D.color(e.wx, F.weatherColor(t.raining, t.wetness, { wet: K.wet, dry: K.dry }));
      D.text(e.best, F.lap(state.standings && state.standings.classBest));
      icons(); D.text(e.air, F.temp1(t.air, TU)); D.text(e.road, F.temp1(t.road, TU));
      D.text(e.game, F.timeOfDay(t.timeOfDay)); var now = new Date(); D.text(e.clock, F.hhmm(now.getHours(), now.getMinutes(), H12));
    };
  });
  T.geometry = geometry;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
