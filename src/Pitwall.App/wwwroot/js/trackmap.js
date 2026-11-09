// Track maps, shared by the Improve tab (potential.js) and the AI Coach (coach.js): a segment map coloured by time lost with the numbered weak spots,
// the big map view (a click on a map: layers, weak spots, every segment), and the game's own outline (saved per track: api/tracks) when there is no timing yet.
// Maths: potential-math.js (zones, segments, sectorAt, lineSpot). The map view's markup is added to the page the first time it opens.
// The map view has two modes: where you lose time, and driving lines (two of: your best lap, the optimal lap from your best segments, any of your last 50 laps,
// loaded only when shown). It opens as a pop-up (open) or sits in a page (mount).
(function (root) {
  'use strict';
  var P = root.Pitwall, F = P.format, U = P.potentialMath, SEC = ['S1', 'S2', 'S3'];
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function where(z) { return (z.turn ? 'Turn ' + z.turn + ' · ' : '') + F.km(z.from) + ' – ' + F.km(z.to) + (z.sector >= 0 ? ' (' + SEC[z.sector] + ')' : ''); }
  // the turns of a track (potential-math turns(): corner by corner) and which turn each segment is in
  function turnsOf(rec, z) { var t = (z && z.turns) || U.turns(rec); if (!t) return null; var of = []; t.forEach(function (g) { for (var j = 0; j < g.len; j++) of[(g.i0 + j) % rec.n] = g; }); return { list: t, of: of }; }
  // the colour value of every segment: per turn when the track has turns (a turn is one colour), else per segment. layer: loss | sd | bestlap
  function layerVals(rec, z, a, layer) {
    var seg = layer === 'loss' && z ? z.segs.map(function (s) { return s.loss; }) : layer === 'sd' && z ? z.segs.map(function (s) { return s.sd; }) : a ? a.segs.map(function (s) { return s.lost || 0; }) : [];
    var T = turnsOf(rec, z); if (!T || !seg.length) return seg;
    return seg.map(function (v, i) {
      var g = T.of[i]; if (!g) return v;
      if (layer === 'loss' && g.loss !== undefined) return g.loss;
      if (layer === 'sd' && g.sd !== undefined) return g.sd;
      var t = 0; for (var j = 0; j < g.len; j++) t += seg[(g.i0 + j) % rec.n] || 0; return t;
    });
  }

  // ---------- the track map (small on the page, big in the map view): each segment coloured by vals (green = 0 ... red = the most) ----------
  // o: { W, H, big, plain (grey track: driving lines mode), zones (numbered weak spots), selZone, hi(i) = outline segment i, title(i), lines: [{ line, col }] (driving lines),
  //      marks: [{ x, z, col, title }] }
  // rec.shape (api/segments: your best lap's line as [d, x, z, ...]) -> [[d, x, z], ...] or null
  function shapeOf(rec) {
    var s = rec && rec.shape; if (!s || s.length < 250) return null;                            // [d, x, z, km/h, brake %] per reading
    if (s._pts) return s._pts; var o = []; for (var i = 0; i + 4 < s.length; i += 5) o.push([s[i], s[i + 1], s[i + 2]]);
    try { Object.defineProperty(s, '_pts', { value: o }); } catch (e) {}
    return o;
  }
  function drawMap(rec, vals, o) {
    o = o || {};
    var pts = rec.points || [], n = rec.n, all = [], sh = shapeOf(rec);
    pts.forEach(function (p) { if (p && (p[0] || p[1])) all.push([p[0], p[1]]); if (p && (p[2] || p[3])) all.push([p[2], p[3]]); });
    if (sh) sh.forEach(function (q) { all.push([q[1], q[2]]); });
    if (all.length < 10) return '<div class="muted">The map appears after a full lap.</div>';
    var W = o.W || 520, Hh = o.H || 340, pad = o.big ? 30 : 16, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, k = o.big ? 1.5 : 1;
    all.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, -q[1]); y1 = Math.max(y1, -q[1]); });
    var sc = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (Hh - 2 * pad) / Math.max(1, y1 - y0)), ox = (W - (x1 - x0) * sc) / 2, oy = (Hh - (y1 - y0) * sc) / 2;
    function tx(x, z) { return (ox + (x - x0) * sc).toFixed(1) + ',' + (oy + (-z - y0) * sc).toFixed(1); }
    function xy(q) { return q ? [ox + (q[0] - x0) * sc, oy + (-q[1] - y0) * sc] : null; }
    function f1(v) { return v.toFixed(1); }
    // the shape of segment i: along your best lap's line (rec.shape) when there is one, else a smooth curve (Catmull-Rom) through the segment points
    var step = rec.length / n, seq = [];
    pts.forEach(function (p) { seq.push(p && (p[0] || p[1]) ? xy([p[0], p[1]]) : null); seq.push(p && (p[2] || p[3]) ? xy([p[2], p[3]]) : null); });
    function segPath(i) {
      if (sh) {
        var a = i * step, b = (i + 1) * step, k0 = -1, k1 = -1;
        for (var j = 0; j < sh.length; j++) { if (sh[j][0] <= a) k0 = j; if (k1 < 0 && sh[j][0] >= b) k1 = j; }
        if (k0 < 0) k0 = 0; if (k1 < 0) k1 = sh.length - 1;
        if (k1 - k0 >= 1) { var d = ''; for (j = k0; j <= k1; j++) d += (j === k0 ? 'M' : ' L') + tx(sh[j][1], sh[j][2]); return d; }
      }
      var N = seq.length, out = '', s0 = 2 * i;
      for (var e = 0; e < 2; e++) {
        var P0 = seq[(s0 + e - 1 + N) % N], P1 = seq[(s0 + e) % N], P2 = seq[(s0 + e + 1) % N], P3 = seq[(s0 + e + 2) % N];
        if (!P1 || !P2) { if (e === 0 && P1 && !P2) { P2 = seq[(s0 + 2) % N]; if (!P2) return ''; out = 'M' + f1(P1[0]) + ',' + f1(P1[1]) + ' L' + f1(P2[0]) + ',' + f1(P2[1]); break; } continue; }
        if (!out) out = 'M' + f1(P1[0]) + ',' + f1(P1[1]);
        if (!P0 || !P3) { out += ' L' + f1(P2[0]) + ',' + f1(P2[1]); continue; }
        out += ' C' + f1(P1[0] + (P2[0] - P0[0]) / 6) + ',' + f1(P1[1] + (P2[1] - P0[1]) / 6) + ' ' + f1(P2[0] - (P3[0] - P1[0]) / 6) + ',' + f1(P2[1] - (P3[1] - P1[1]) / 6) + ' ' + f1(P2[0]) + ',' + f1(P2[1]);
      }
      return out;
    }
    var worst = Math.max.apply(null, vals.map(function (v) { return v || 0; }).concat([0.05])), under = '', svg = '', zs = '';
    for (var i = 0; i < n; i++) {
      var d = segPath(i); if (!d) continue;
      var f = Math.max(0, Math.min(1, (vals[i] || 0) / worst)), col = o.plain ? '#3A3D43' : 'hsl(' + Math.round(130 - 130 * f) + ',75%,52%)', w = o.plain ? 16 : (6 + 6 * f) * k;
      if (o.hi && o.hi(i)) under += '<path d="' + d + '" fill="none" stroke="' + (o.plain ? '#6B7079' : 'var(--text)') + '" stroke-width="' + (w + (o.plain ? 6 : 7)).toFixed(1) + '" stroke-linecap="round" stroke-linejoin="round"/>';   // the chosen spot (soft grey under the lines)
      svg += '<path data-i="' + i + '" d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + w.toFixed(1) + '" stroke-linecap="round" stroke-linejoin="round"><title>' + esc(o.title ? o.title(i) : '') + '</title></path>';
    }
    (o.lines || []).forEach(function (l) {
      var q = l.line, d = ''; if (!q || q.length < 12) return;
      for (var j = 0; j + 5 < q.length; j += 6) d += (j && q[j] - q[j - 6] < 60 ? ' L' : 'M') + tx(q[j + 1], q[j + 2]);       // a gap (a missing piece): start again
      svg += '<path class="dl" d="' + d + '" fill="none" stroke="' + l.col + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>';
    });
    (o.marks || []).forEach(function (m) { var c = tx(m.x, m.z).split(','); svg += '<circle class="bp" cx="' + c[0] + '" cy="' + c[1] + '" r="6" fill="' + m.col + '" stroke="#000" stroke-width="1"><title>' + esc(m.title) + '</title></circle>'; });
    var st = pts[0]; if (st && (st[0] || st[1])) { var c = tx(st[0], st[1]).split(','); svg += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + 6 * k + '" fill="var(--text)" class="sf"><title>Start / finish</title></circle>'; }
    (o.zones || []).forEach(function (z) {
      var p = z.pts; if (!p) return; var at = (p[2] || p[3]) ? tx(p[2], p[3]) : tx(p[0], p[1]); if (!(p[0] || p[1] || p[2] || p[3])) return; var xy = at.split(',');
      zs += '<g class="zn' + (o.selZone === z.n ? ' on' : '') + '" data-z="' + z.n + '"><circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="' + 11 * k + '"/><text x="' + xy[0] + '" y="' + xy[1] + '"' + (o.big ? ' style="font-size:18px"' : '') + '>' + z.n +
        '</text><title>Weak spot ' + z.n + ' · ' + esc(where(z)) + ' · ' + F.plusSec(z.loss) + ' s per lap</title></g>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + Hh + '"' + (o.big ? ' preserveAspectRatio="xMidYMid meet"' : ' style="width:100%;height:auto;display:block"') + '>' + under + svg + zs + '</svg>';
  }

  // ---------- the map view: one track + car big, in two modes. 'Where you lose time' = the track coloured by time lost (layers), the numbered weak spots and
  // their numbers. 'Driving lines' = the track plain grey, two lines compared (Line A purple, Line B yellow: your best lap, your optimal lap or any of your
  // last 50 laps), their brake points in the chosen spot and one table A vs B. Shown as a pop-up (open: the AI Coach) or inside a page (mount: Improve's
  // Track study). key = the segments file (api/segments?key=) for the driving lines.
  var ov = null, LAYERS = [['loss', 'Where you lose time'], ['sd', 'Varies most'], ['bestlap', 'Your best lap']];
  var COL_A = 'var(--purple)', COL_B = 'var(--yellow)';
  var BODY = '<div class="mapov-h"><div style="flex:1;min-width:0"><div class="pop-h" id="ovTitle"></div><div class="faint" id="ovSub"></div></div>' +
    '<span class="seg" id="ovMode"></span><span id="ovCloseBox"></span></div><div class="mapov-tools" id="ovTools"></div>' +
    '<div class="mapov-body"><div id="ovMap"></div><div id="ovSide"></div></div>';
  function start(rec, title, key) {
    var z = U.zones(rec, 5), a = U.segments(rec), mode = ov && ov.key === key ? ov.mode : 'lose';
    ov = { rec: rec, z: z, a: a, T: turnsOf(rec, z), pick: null, layer: z ? 'loss' : 'bestlap', zone: z && z.zones.length ? z.zones[0].n : null, seg: null, view: null, mode: mode,
           key: key || null, lines: { list: null, a: 'best', b: null, data: {} } };
    if (key) {
      var me = ov;
      getLine(key, 'list').then(function (l) {
        if (ov !== me) return; var L = ov.lines; L.list = l || { laps: [] };
        if (!L.list.best) L.a = L.list.optimal ? 'optimal' : (L.list.laps[0] ? String(L.list.laps[0].t) : null);
        L.b = L.list.laps.length ? String(L.list.laps[0].t) : (L.a !== 'optimal' && L.list.optimal ? 'optimal' : 'none');
        if (L.b === L.a) L.b = 'none';
        if (!hasLines()) ov.mode = 'lose';
        if (ov.mode === 'lines') { want(L.a); want(L.b); }
        draw();
      });
    }
    $('ovTitle').textContent = title;
    $('ovSub').textContent = rec.n + ' segments of ' + Math.round(rec.length / rec.n) + ' m · ' + (z ? 'your last ' + z.sessions + ' session' + (z.sessions > 1 ? 's' : '') + ' (' + z.laps + ' laps within 5 % of your best)' : 'no session with 3 laps within 5 % of your best yet: your best lap only');
    draw();
  }
  // as a pop-up over the page (Esc / Close / a click next to it closes it)
  function openMap(rec, title, key) {
    if (!$('mapOv')) {
      var d = document.createElement('div'); d.className = 'mapov'; d.id = 'mapOv'; d.hidden = true;
      d.innerHTML = '<div class="mapov-box" role="dialog" aria-modal="true">' + BODY + '</div>'; document.body.appendChild(d);
      $('ovCloseBox').innerHTML = '<button class="btn" id="ovClose" title="Close (Esc)">Close</button>';
      $('ovClose').onclick = closeMap;
      d.onclick = function (e) { if (e.target === this) closeMap(); };
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov && $('mapOv') && !$('mapOv').hidden) closeMap(); });
      bind();
    }
    $('mapOv').hidden = false; document.body.style.overflow = 'hidden'; start(rec, title, key);
  }
  function closeMap() { $('mapOv').hidden = true; document.body.style.overflow = ''; ov = null; }
  // inside a page: host = an element that gets the map view (the same one again: just the new track)
  function mount(host, rec, title, key) {
    if (!host._ov) { host.innerHTML = '<div class="mapstudy">' + BODY + '</div>'; host._ov = true; bind(); }
    start(rec, title, key);
  }

  function getLine(key, which) {
    return fetch('api/segments?key=' + encodeURIComponent(key) + '&line=' + encodeURIComponent(which)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  // load a line once (best / optimal / a lap's t) and draw again when it is there
  function want(which) {
    if (!which || which === 'none' || !ov || !ov.key) return;
    var L = ov.lines, me = ov; if (L.data[which] !== undefined) return;
    L.data[which] = null;
    getLine(ov.key, which).then(function (j) {
      if (ov !== me) return;
      L.data[which] = !j ? false : which === 'optimal' ? U.optimalLine(j) : { line: j.line || [], time: j.time };
      draw();
    });
  }
  function hasLines() { var l = ov && ov.lines.list; return !!(l && (l.best || l.optimal || (l.laps || []).length)); }
  function lapOf(t) { return ((ov.lines.list && ov.lines.list.laps) || []).filter(function (x) { return String(x.t) === String(t); })[0]; }
  function when(t) { var d = new Date(t * 1000); return F.day(t) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  // the name of a line choice: 'Best lap 1:18.723', 'Optimal lap', 'Lap 1:21.023 (Nov 9, 2026 19:53)'
  function lineName(id, short) {
    var l = ov.lines.list || {};
    if (id === 'best') return 'Best lap' + (l.best ? ' ' + F.lap(l.best.time) : '');
    if (id === 'optimal') return 'Optimal lap';
    var x = lapOf(id); return x ? (short ? 'Lap ' + (x.time > 0 ? F.lap(x.time) : '--') : 'Lap ' + (x.time > 0 ? F.lap(x.time) : '--') + ' (' + when(x.t) + ')') : 'Lap';
  }
  function lineData(id) { var v = id && id !== 'none' ? ov.lines.data[id] : null; return v && v.line && v.line.length ? v.line : null; }
  // the line where it is d metres into the lap: [x, z]
  function at(line, d) { var b = null; for (var i = 0; i + 5 < line.length; i += 6) if (b === null || Math.abs(line[i] - d) < Math.abs(line[b] - d)) b = i; return b === null ? null : [line[b + 1], line[b + 2]]; }
  function m(v) { return v === null || v === undefined ? '--' : Math.round(v) + ' m'; }
  function kmh(v) { return v === null || v === undefined ? '--' : Math.round(v) + ' km/h'; }
  function sgn(v, unit) { return v === null || v === undefined || isNaN(v) ? '' : (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(Math.round(v)) + unit; }

  function draw() {
    var z = ov.z, a = ov.a, rec = ov.rec, n = rec.n, st = rec.length / n, lines = ov.mode === 'lines';
    var zl = z ? z.zones : [], sel = ov.pick || zl.filter(function (w) { return w.n === ov.zone; })[0] || null;   // a clicked turn, else a weak spot
    function inZone(i, w) { return (i - w.i0 + n) % n < w.len; }
    var range = ov.seg !== null ? { name: 'Segment ' + (ov.seg + 1), from: ov.seg * st, len: st } : sel ? { name: sel.turn ? 'Turn ' + sel.turn + (sel.n ? ' (spot ' + sel.n + ')' : '') : 'Spot ' + sel.n, from: sel.from, len: sel.len * st } : null;
    // the mode switch (Driving lines only when this track + car has any)
    var can = hasLines();
    $('ovMode').innerHTML = '<button data-m="lose"' + (!lines ? ' class="on"' : '') + '>Where you lose time</button><button data-m="lines"' + (lines ? ' class="on"' : '') + (can ? '' : ' disabled') +
      ' title="' + (can ? 'Compare two driving lines' : (ov.key && !ov.lines.list ? 'Loading...' : 'Recorded from your next valid laps on this track with this car')) + '">Driving lines</button>';
    var zoomHint = '<span class="faint">Scroll to zoom, drag to move, double-click to reset</span><button class="btn" id="ovReset" style="padding:3px 12px" hidden>Reset zoom</button>';
    var mapHtml, legend, side = '';
    if (!lines) {
      var Lr = ov.layer;
      $('ovTools').innerHTML = '<span class="faint">Colour the track by</span><span class="seg" id="ovLayer">' + LAYERS.filter(function (l) { return l[0] === 'bestlap' ? !!a : !!z; })
        .map(function (l) { return '<button data-v="' + l[0] + '"' + (l[0] === Lr ? ' class="on"' : '') + '>' + esc(l[1]) + '</button>'; }).join('') + '</span>';
      var vals = layerVals(rec, z, a, Lr);
      var lg = Lr === 'sd' ? ['Steady', 'Varies most'] : Lr === 'loss' ? ['About your best', 'You lose the most'] : ['Your best there', 'Your best lap lost the most'];
      mapHtml = drawMap(rec, vals, { W: 1000, H: 640, big: true, zones: zl, selZone: ov.seg === null ? ov.zone : null,
        hi: function (i) { return ov.seg === i || (ov.seg === null && sel && inZone(i, sel)); }, title: function (i) { return segLine(i); } });
      legend = '<span><i style="background:hsl(130,75%,52%)"></i>' + lg[0] + '</span><span><i style="background:hsl(0,75%,52%)"></i>' + lg[1] + '</span><span class="faint">Click a number or the track</span>';
      side = loseSide(zl, sel, rec, n);
    } else {
      var L = ov.lines, list = L.list || { laps: [] };
      function opts(cur, none) {
        var o = [];
        if (list.best) o.push(['best', lineName('best')]);
        if (list.optimal) o.push(['optimal', 'Optimal lap' + (list.optimal < list.n ? ' (' + list.optimal + ' of ' + list.n + ' segments so far)' : ' (your best segments)')]);
        (list.laps || []).forEach(function (x) { o.push([String(x.t), lineName(String(x.t))]); });
        if (none) o.push(['none', 'Nothing']);
        return o.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(cur) ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('');
      }
      $('ovTools').innerHTML = '<span class="faint">Compare</span><span class="lineSel"><i style="background:' + COL_A + '"></i><select class="sel" id="ovLineA">' + opts(L.a, false) + '</select></span>' +
        '<span class="faint">with</span><span class="lineSel"><i style="background:' + COL_B + '"></i><select class="sel" id="ovLineB">' + opts(L.b, true) + '</select></span>';
      var A = lineData(L.a), B = lineData(L.b), drawn = [], marks = [];
      if (A) drawn.push({ line: A, col: COL_A }); if (B) drawn.push({ line: B, col: COL_B });
      if (range) drawn.forEach(function (l) { var s = U.lineSpot(l.line, range.from, range.len, rec.length), p = s && s.brakeAt !== null ? at(l.line, s.brakeAt) : null; if (p) marks.push({ x: p[0], z: p[1], col: l.col, title: 'Brakes at ' + m(s.brakeAt) }); });
      mapHtml = drawMap(rec, [], { W: 1000, H: 640, big: true, plain: true, zones: zl, selZone: ov.seg === null ? ov.zone : null, lines: drawn, marks: marks,
        hi: function (i) { return ov.seg === i || (ov.seg === null && sel && inZone(i, sel)); }, title: function (i) { return segLine(i); } });
      legend = (A ? '<span><i style="background:' + COL_A + '"></i>A: ' + esc(lineName(L.a, true)) + '</span>' : '') + (B ? '<span><i style="background:' + COL_B + '"></i>B: ' + esc(lineName(L.b, true)) + '</span>' : '') +
        (range && marks.length ? '<span><i style="background:var(--text);border-radius:50%;width:9px;height:9px"></i>Brake points</span>' : '') +
        ((L.a && L.a !== 'none' && !A) || (L.b && L.b !== 'none' && !B) ? '<span class="faint">Loading...</span>' : '');
      side = linesSide(zl, sel, range, A, B, rec);
    }
    $('ovMap').innerHTML = mapHtml + '<div class="legend">' + legend + zoomHint + '</div>';
    $('ovSide').innerHTML = side;
    zoomable();
  }
  // 'Where you lose time': the weak spots, the chosen one segment by segment, what the numbers mean (folded)
  function loseSide(zl, sel, rec, n) {
    var z = ov.z, a = ov.a, h = '';
    if (zl.length) {
      h += '<div class="sub" style="margin:0 0 6px">Your weak spots</div><table class="tbl"><thead><tr><th>#</th><th>Where</th><th class="num">Per lap</th><th class="num">Came back</th></tr></thead><tbody>' +
        zl.map(function (w) { return '<tr class="click' + (ov.seg === null && w.n === ov.zone ? ' sel' : '') + '" data-z="' + w.n + '"><td>' + w.n + '</td><td>' + esc(where(w)) + '</td><td class="num red">' + F.plusSec(w.loss) + '</td><td class="num">' + w.seen + ' / ' + w.of + '</td></tr>'; }).join('') + '</tbody></table>';
    } else h += '<div class="muted" style="margin-bottom:10px">' + (z ? 'No weak spots: you are close to your best everywhere.' : 'The weak spots appear after a session with 3 or more laps within 5 % of your best here.') + '</div>';
    var list = ov.seg !== null ? [ov.seg] : sel ? Array.apply(null, Array(sel.len)).map(function (x, k) { return (sel.i0 + k) % n; }) : [];
    if (list.length) {
      h += '<div class="sub" style="margin:16px 0 6px">' + (ov.seg !== null ? 'Segment ' + (ov.seg + 1) : (sel.turn ? 'Turn ' + sel.turn : 'Spot ' + sel.n) + ', piece by piece (150 m each)') + '</div><table class="tbl"><thead><tr><th>Seg</th><th class="num">Your best</th><th class="num">You lose</th><th class="num">Varies</th><th class="num">Best lap</th></tr></thead><tbody>' +
        list.map(function (i) {
          var s = z ? z.segs[i] : null, b = a ? a.segs[i] : null;
          return '<tr class="click' + (ov.seg === i ? ' sel' : '') + '" data-i="' + i + '" title="' + esc(segLine(i)) + '"><td>' + (i + 1) + '</td><td class="num purple">' + F.sector(rec.best[i]) + '</td><td class="num red">' + (s ? F.plusSec(s.loss) : '--') +
            '</td><td class="num">' + (s ? F.spread(s.sd) : '--') + '</td><td class="num">' + (b && b.lost !== null ? F.plusSec(b.lost) : '--') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    return h + '<details class="explain"><summary>What do these numbers mean?</summary>Per lap / You lose = your average there in your last sessions (laps within 5 % of your best lap) minus your best ever there. ' +
      'Varies = how much it changes from lap to lap. Best lap = what your best lap lost there. Came back = in how many of those sessions this spot was one of your 3 biggest losses.</details>';
  }
  // 'Driving lines': pick a spot (or click the track), then line A against line B there
  function linesSide(zl, sel, range, A, B, rec) {
    var h = '<div class="sub" style="margin:0 0 6px">Where</div><div class="bar" style="flex-wrap:wrap;gap:6px">' +
      zl.map(function (w) { return '<button class="btn' + (ov.seg === null && !ov.pick && w.n === ov.zone ? ' on' : '') + '" data-z="' + w.n + '" title="' + esc(where(w)) + '">Spot ' + w.n + (w.turn ? ' · Turn ' + w.turn : '') + '</button>'; }).join('') +
      '<span class="faint">' + (zl.length ? 'or click the track' : 'Click the track') + '</span></div>';
    if (!range) return h + '<div class="muted" style="margin-top:14px">Pick a spot to compare the two lines there.</div>';
    h += '<div class="faint" style="margin:10px 0 6px">' + esc(range.name) + ' · ' + F.km(range.from) + ' – ' + F.km((range.from + range.len) % rec.length || rec.length) + '</div>';
    if (!A && !B) return h + '<div class="muted">Pick a line above.</div>';
    var sa = A ? U.lineSpot(A, range.from, range.len, rec.length) : null, sb = B ? U.lineSpot(B, range.from, range.len, rec.length) : null;
    var rows = [['Brakes at', 'brakeAt', m, ' m', 'later'], ['Brake', 'brakeMax', function (v) { return v === null || v === undefined ? '--' : Math.round(v) + ' %'; }, ' %'],
      ['Speed in', 'entry', kmh, ' km/h'], ['Slowest', 'min', kmh, ' km/h'], ['Slowest at', 'minAt', m, ' m'], ['Full throttle at', 'throttleAt', m, ' m', 'later'], ['Speed out', 'exit', kmh, ' km/h']];
    h += '<table class="tbl"><thead><tr><th></th><th class="num"><span class="chip" style="background:' + COL_A + ';color:#111">A</span></th>' + (B ? '<th class="num"><span class="chip" style="background:' + COL_B + ';color:#111">B</span></th><th class="num">B vs A</th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        var va = sa ? sa[r[1]] : null, vb = sb ? sb[r[1]] : null, d = va !== null && vb !== null && va !== undefined && vb !== undefined ? vb - va : null;
        return '<tr><td>' + r[0] + '</td><td class="num">' + (A ? r[2](va) : '--') + '</td>' + (B ? '<td class="num">' + r[2](vb) + '</td><td class="num faint">' + sgn(d, r[3]) + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
    return h + '<details class="explain"><summary>What do these numbers mean?</summary>Distances are metres into the lap. Brakes at = where the braking for the slowest point starts ' +
      '(looked for up to 150 m before the spot; the dots on the map). Full throttle at = the first full throttle after the slowest point. B vs A: + = B brakes later, is faster, or is back on the throttle later.</details>';
  }

  // a click on the track: its turn (a weak spot when it is one), or that segment when the track has no turns
  function pickSeg(i) {
    var g = ov.T && ov.T.of[i]; ov.seg = null;
    if (!g) { ov.seg = i; ov.pick = null; return; }
    var zz = ov.z ? ov.z.zones.filter(function (w) { return w.turn === g.t; })[0] : null;
    if (zz) { ov.zone = zz.n; ov.pick = null; } else { ov.pick = { turn: g.t, i0: g.i0, len: g.len, from: g.from, to: g.to }; ov.zone = null; }
  }
  // the controls (bound once per place: the pop-up, or a page's map view)
  function bind() {
    $('ovMode').onclick = function (e) {
      var b = e.target.closest('button[data-m]'); if (!b || !ov || b.disabled) return; ov.mode = b.getAttribute('data-m');
      if (ov.mode === 'lines') { want(ov.lines.a); want(ov.lines.b); } draw();
    };
    $('ovTools').onclick = function (e) { var b = e.target.closest('button[data-v]'); if (!b || !ov) return; ov.layer = b.getAttribute('data-v'); draw(); };
    $('ovTools').onchange = function (e) {
      if (!ov) return;
      if (e.target.id === 'ovLineA') { ov.lines.a = e.target.value; want(ov.lines.a); }
      else if (e.target.id === 'ovLineB') { ov.lines.b = e.target.value; want(ov.lines.b); }
      draw();
    };
    $('ovMap').onclick = function (e) {
      if (!ov || moved) { moved = false; return; } var g = e.target.closest('[data-z]'), p = e.target.closest('path[data-i]');
      if (g) { ov.zone = +g.getAttribute('data-z'); ov.seg = null; ov.pick = null; } else if (p) pickSeg(+p.getAttribute('data-i')); else return;
      draw();
    };
    $('ovSide').onclick = function (e) {
      if (!ov) return; var r = e.target.closest('[data-z]'), s = e.target.closest('tr[data-i]');
      if (r) { ov.zone = +r.getAttribute('data-z'); ov.seg = null; ov.pick = null; } else if (s) ov.seg = +s.getAttribute('data-i'); else return;
      draw();
    };
  }

  // ---------- zoom in the map view: the wheel zooms round the mouse (up to 20x), dragging moves, a double-click or Reset goes back. Only the viewBox
  // changes (no redraw); lines keep their width on screen (CSS vector-effect) and the markers their size, so a zoomed corner stays sharp. Kept while the
  // view is open (another layer / spot keeps the zoom).
  var FULL = { x: 0, y: 0, w: 1000, h: 640 }, MAXZ = 20, moved = false;
  function zoomable() {
    var svg = $('ovMap').querySelector('svg'); if (!svg) return;
    var v = ov.view || (ov.view = { x: 0, y: 0, w: FULL.w, h: FULL.h });
    function fit() {
      v.w = Math.max(FULL.w / MAXZ, Math.min(FULL.w, v.w)); v.h = v.w * FULL.h / FULL.w;
      v.x = Math.max(FULL.x, Math.min(FULL.w - v.w, v.x)); v.y = Math.max(FULL.y, Math.min(FULL.h - v.h, v.y));
    }
    function apply() {
      fit(); svg.setAttribute('viewBox', v.x.toFixed(2) + ' ' + v.y.toFixed(2) + ' ' + v.w.toFixed(2) + ' ' + v.h.toFixed(2));
      var k = v.w / FULL.w, zoomed = k < 0.999;
      [].forEach.call(svg.querySelectorAll('.zn circle'), function (c) { c.setAttribute('r', (16.5 * k).toFixed(2)); });
      [].forEach.call(svg.querySelectorAll('.zn text'), function (t) { t.style.fontSize = (18 * k).toFixed(2) + 'px'; });
      [].forEach.call(svg.querySelectorAll('.sf'), function (c) { c.setAttribute('r', (9 * k).toFixed(2)); });
      [].forEach.call(svg.querySelectorAll('.bp'), function (c) { c.setAttribute('r', (6 * k).toFixed(2)); });
      svg.style.cursor = zoomed ? 'grab' : ''; var r = $('ovReset'); if (r) r.hidden = !zoomed;
    }
    function at(e) { var m = svg.getScreenCTM(); if (!m) return null; var p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(m.inverse()); }
    svg.addEventListener('wheel', function (e) {
      e.preventDefault(); var p = at(e); if (!p) return;
      var f = e.deltaY < 0 ? 1 / 1.25 : 1.25, w0 = v.w; v.w = v.w * f; fit();
      var s = v.w / w0; v.x = p.x - (p.x - v.x) * s; v.y = p.y - (p.y - v.y) * s; apply();
    }, { passive: false });
    var drag = null;
    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || v.w >= FULL.w - 0.01) return;
      var m = svg.getScreenCTM(); drag = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, s: m ? 1 / m.a : 1 }; moved = false;
    });
    svg.addEventListener('pointermove', function (e) {
      if (!drag) return; var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) { moved = true; svg.setPointerCapture(e.pointerId); svg.style.cursor = 'grabbing'; }
      v.x = drag.vx - dx * drag.s; v.y = drag.vy - dy * drag.s; apply();
    });
    function end() { if (drag) { drag = null; svg.style.cursor = v.w < FULL.w - 0.01 ? 'grab' : ''; } }
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', function (e) { e.preventDefault(); reset(); });
    var r = $('ovReset'); if (r) r.onclick = reset;
    function reset() { v.x = 0; v.y = 0; v.w = FULL.w; apply(); }
    apply();
  }
  function segLine(i) {
    var rec = ov ? ov.rec : null; if (!rec) return 'Segment ' + (i + 1);
    var st = rec.length / rec.n, sc = U.sectorAt((i + 0.5) * st, rec.sectors), s = ov.z ? ov.z.segs[i] : null;
    var g = ov.T && ov.T.of[i];
    if (g) return 'Turn ' + g.t + ' · ' + F.km(g.from) + ' – ' + F.km(g.to) + (g.loss !== undefined ? ' · you lose ' + F.plusSec(g.loss) + ' s, varies ' + F.spread(g.sd) : '');
    return 'Segment ' + (i + 1) + ' · ' + F.km(i * st) + ' – ' + F.km((i + 1) * st) + (sc >= 0 ? ' · ' + SEC[sc] : '') + (s ? ' · you lose ' + F.plusSec(s.loss) + ' s, varies ' + F.spread(s.sd) : '');
  }
  // the game's own outline of a track (no timing): paths = [[[x, z], ...], ...] (the first = the track, others e.g. the pit lane), drawn grey
  function outline(paths, o) {
    o = o || {}; var all = [];
    (paths || []).forEach(function (p) { (p || []).forEach(function (q) { if (q && q.length >= 2) all.push(q); }); });
    if (all.length < 10) return '';
    var W = o.W || 520, Hh = o.H || 340, pad = 16, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    all.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, -q[1]); y1 = Math.max(y1, -q[1]); });
    var sc = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (Hh - 2 * pad) / Math.max(1, y1 - y0)), ox = (W - (x1 - x0) * sc) / 2, oy = (Hh - (y1 - y0) * sc) / 2;
    function tx(q) { return (ox + (q[0] - x0) * sc).toFixed(1) + ',' + (oy + (-q[1] - y0) * sc).toFixed(1); }
    return '<svg viewBox="0 0 ' + W + ' ' + Hh + '" style="width:100%;height:auto;display:block">' + paths.map(function (p, k) {
      return p && p.length > 1 ? '<path d="M' + p.map(tx).join(' L') + (k === 0 ? ' Z' : '') + '" fill="none" stroke="' + (k === 0 ? 'var(--tile2)' : 'var(--line)') + '" stroke-width="' + (k === 0 ? 8 : 3) +
        '" stroke-linecap="round" stroke-linejoin="round"/>' : '';
    }).join('') + '</svg>';
  }

  P.trackMap = { draw: drawMap, where: where, open: openMap, mount: mount, outline: outline, vals: layerVals };
})(window);
