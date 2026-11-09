// Track maps of the Improve tab (potential.js): a segment map coloured by time lost with the numbered weak spots,
// the big map view (a click on a map: layers, weak spots, every segment), and the game's own outline (saved per track: api/tracks) when there is no timing yet.
// Maths: potential-math.js (zones, segments, sectorAt, lineSpot). The map view's markup is added to the page the first time it opens.
// Driving lines (your best lap, the optimal lap from your best segments, any of your last 50 laps) are drawn in the map view; they are loaded only when shown.
(function (root) {
  'use strict';
  var P = root.Pitwall, F = P.format, U = P.potentialMath, SEC = ['S1', 'S2', 'S3'];
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function where(z) { return F.km(z.from) + ' – ' + F.km(z.to) + (z.sector >= 0 ? ' (' + SEC[z.sector] + ')' : ''); }

  // ---------- the track map (small on the page, big in the map view): each segment coloured by vals (green = 0 ... red = the most) ----------
  // o: { W, H, big, zones (numbered weak spots), selZone, hi(i) = outline segment i, title(i), lines: [{ line, col }] (driving lines), marks: [{ x, z, col, title }] }
  function drawMap(rec, vals, o) {
    o = o || {};
    var pts = rec.points || [], n = rec.n, all = [];
    pts.forEach(function (p) { if (p && (p[0] || p[1])) all.push([p[0], p[1]]); if (p && (p[2] || p[3])) all.push([p[2], p[3]]); });
    if (all.length < 10) return '<div class="muted">The map appears after a full lap.</div>';
    var W = o.W || 520, Hh = o.H || 340, pad = o.big ? 30 : 16, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, k = o.big ? 1.5 : 1;
    all.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, -q[1]); y1 = Math.max(y1, -q[1]); });
    var sc = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (Hh - 2 * pad) / Math.max(1, y1 - y0)), ox = (W - (x1 - x0) * sc) / 2, oy = (Hh - (y1 - y0) * sc) / 2;
    function tx(x, z) { return (ox + (x - x0) * sc).toFixed(1) + ',' + (oy + (-z - y0) * sc).toFixed(1); }
    var worst = Math.max.apply(null, vals.map(function (v) { return v || 0; }).concat([0.05])), under = '', svg = '', zs = '';
    for (var i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n]; if (!p || !q || !(p[0] || p[1]) || !(q[0] || q[1])) continue;
      var d = 'M' + tx(p[0], p[1]) + ((p[2] || p[3]) ? ' L' + tx(p[2], p[3]) : '') + ' L' + tx(q[0], q[1]);
      var f = Math.max(0, Math.min(1, (vals[i] || 0) / worst)), col = 'hsl(' + Math.round(130 - 130 * f) + ',75%,52%)', w = (6 + 6 * f) * k;
      if (o.hi && o.hi(i)) under += '<path d="' + d + '" fill="none" stroke="var(--text)" stroke-width="' + (w + 7).toFixed(1) + '" stroke-linecap="round" stroke-linejoin="round"/>';
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

  // ---------- the map view (a click on a map): layers, weak spots, every segment clickable ----------
  var ov = null, LAYERS = [['loss', 'Where you lose time'], ['sd', 'Varies most'], ['bestlap', 'Your best lap']];
  var LINES = [['best', 'Your best lap', 'var(--purple)'], ['optimal', 'Optimal lap', 'var(--cyan)'], ['lap', 'Lap', 'var(--yellow)']];
  var MARKUP = '<div class="mapov-box" role="dialog" aria-modal="true"><div class="mapov-h"><div style="flex:1;min-width:0"><div class="pop-h" id="ovTitle"></div><div class="faint" id="ovSub"></div></div>' +
    '<span class="seg" id="ovLayer"></span><button class="btn" id="ovClose" title="Close (Esc)">Close</button></div><div class="mapov-body"><div id="ovMap"></div><div id="ovSide"></div></div></div>';
  // key = the segments file (api/segments?key=): its driving lines can be shown
  function openMap(rec, title, key) {
    if (!$('mapOv')) setup();
    var z = U.zones(rec, 5), a = U.segments(rec);
    ov = { rec: rec, z: z, a: a, layer: z ? 'loss' : 'bestlap', zone: z && z.zones.length ? z.zones[0].n : null, seg: null, view: null,
           key: key || null, lines: { list: null, show: { best: false, optimal: false, lap: false }, lap: null, data: {} } };
    if (key) { var me = ov; getLine(key, 'list').then(function (l) { if (ov !== me) return; ov.lines.list = l || { laps: [] }; if (l && l.best) { ov.lines.show.best = true; want('best'); } drawOv(); }); }
    $('ovTitle').textContent = title;
    $('ovSub').textContent = rec.n + ' segments of ' + Math.round(rec.length / rec.n) + ' m · ' + (z ? 'your last ' + z.sessions + ' session' + (z.sessions > 1 ? 's' : '') + ' (' + z.laps + ' laps within 5 % of your best)' : 'no session with 3 laps within 5 % of your best yet: your best lap only');
    $('mapOv').hidden = false; document.body.style.overflow = 'hidden'; drawOv();
  }
  function getLine(key, which) {
    return fetch('api/segments?key=' + encodeURIComponent(key) + '&line=' + encodeURIComponent(which)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  // load a line once (best / optimal / a lap's t) and draw again when it is there
  function want(which) {
    var L = ov.lines, me = ov; if (L.data[which] !== undefined) return;
    L.data[which] = null;
    getLine(ov.key, which).then(function (j) {
      if (ov !== me) return;
      L.data[which] = !j ? false : which === 'optimal' ? U.optimalLine(j) : { line: j.line || [], time: j.time };
      drawOv();
    });
  }
  // the lines switched on and loaded: [{ id, label, col, line }]
  function shownLines() {
    var L = ov.lines, out = [];
    LINES.forEach(function (d) {
      var id = d[0] === 'lap' ? L.lap : d[0]; if (!L.show[d[0]] || !id) return;
      var v = L.data[id]; if (v && v.line && v.line.length) out.push({ id: d[0], label: d[0] === 'lap' ? 'Lap ' + lapName(L.lap) : d[1], short: d[0] === 'lap' ? lapName(L.lap) || 'Lap' : d[0] === 'best' ? 'Best' : 'Optimal', col: d[2], line: v.line });
    });
    return out;
  }
  function lapName(t) { var l = (ov.lines.list && ov.lines.list.laps || []).filter(function (x) { return String(x.t) === String(t); })[0]; return l && l.time > 0 ? F.lap(l.time) : ''; }
  function when(t) { var d = new Date(t * 1000); return F.day(t) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  // the line where it is d metres into the lap: [x, z]
  function at(line, d) { var b = null; for (var i = 0; i + 5 < line.length; i += 6) if (b === null || Math.abs(line[i] - d) < Math.abs(line[b] - d)) b = i; return b === null ? null : [line[b + 1], line[b + 2]]; }
  function m(v) { return v === null || v === undefined ? '--' : Math.round(v) + ' m'; }
  function kmh(v) { return v === null || v === undefined ? '--' : Math.round(v); }
  // the driving lines block at the top of the side panel, and the comparison in the chosen spot / segment
  function linesHtml(range) {
    var L = ov.lines;
    if (!ov.key) return '';
    if (!L.list) return '<div class="sub" style="margin:0 0 6px">Driving lines</div><div class="muted" style="margin-bottom:14px">Loading...</div>';
    var laps = L.list.laps || [];
    if (!L.list.best && !laps.length) return '<div class="sub" style="margin:0 0 6px">Driving lines</div><div class="muted" style="margin-bottom:14px">No driving lines here yet: they are recorded from your next valid lap on this track with this car.</div>';
    var h = '<div class="sub" style="margin:0 0 6px">Driving lines</div><div class="ov-lines">' + LINES.map(function (d) {
      var dis = d[0] === 'best' ? !L.list.best : d[0] === 'optimal' ? !L.list.optimal : !laps.length;
      var extra = d[0] === 'best' && L.list.best ? ' <span class="faint">' + F.lap(L.list.best.time) + '</span>' :
        d[0] === 'optimal' ? ' <span class="faint">' + (L.list.optimal ? (L.list.optimal < L.list.n ? L.list.optimal + ' of ' + L.list.n + ' segments so far' : 'your best segments put together') : 'none yet') + '</span>' :
        ' <select class="sel" id="ovLap" style="padding:2px 6px"' + (dis ? ' disabled' : '') + '>' + laps.map(function (l) {
          return '<option value="' + l.t + '"' + (String(l.t) === String(L.lap) ? ' selected' : '') + '>' + (l.time > 0 ? F.lap(l.time) : '--') + ' · ' + esc(when(l.t)) + '</option>'; }).join('') + '</select>';
      return '<label' + (dis ? ' class="faint"' : '') + '><input type="checkbox" data-l="' + d[0] + '"' + (L.show[d[0]] ? ' checked' : '') + (dis ? ' disabled' : '') + '><i style="background:' + d[2] + '"></i>' + esc(d[1]) + extra + '</label>';
    }).join('') + '</div>';
    var sh = shownLines();
    if (range && sh.length) {
      var rec = ov.rec;
      var sp = sh.map(function (l) { return U.lineSpot(l.line, range.from, range.len, rec.length); });
      var rows = [['Brakes at', function (s) { return m(s.brakeAt); }], ['Brake', function (s) { return s.brakeMax === null ? '--' : Math.round(s.brakeMax) + ' %'; }],
        ['In', function (s) { return kmh(s.entry) + ' km/h'; }], ['Slowest', function (s) { return kmh(s.min) + ' km/h'; }], ['Slowest at', function (s) { return m(s.minAt); }],
        ['Full throttle', function (s) { return m(s.throttleAt); }], ['Out', function (s) { return kmh(s.exit) + ' km/h'; }]];
      h += '<table class="tbl" style="margin-top:8px"><thead><tr><th>' + esc(range.name) + '</th>' + sh.map(function (l) { return '<th class="num"><span class="chip" style="background:' + l.col + ';color:#111" title="' + esc(l.label) + '">' + esc(l.short) + '</span></th>'; }).join('') +
        '</tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td>' + sp.map(function (s) { return '<td class="num">' + (s ? r[1](s) : '--') + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table><div class="foot" style="margin-top:4px">Metres into the lap. Brakes at = where the braking for the slowest point starts (up to 150 m before; the dots on the map).' +
        ' Full throttle = the first full throttle after the slowest point.</div>';
    }
    return h + '<div style="height:14px"></div>';
  }
  function closeMap() { $('mapOv').hidden = true; document.body.style.overflow = ''; ov = null; }
  function drawOv() {
    var z = ov.z, a = ov.a, rec = ov.rec, n = rec.n, L = ov.layer;
    $('ovLayer').innerHTML = LAYERS.filter(function (l) { return l[0] === 'bestlap' ? !!a : !!z; }).map(function (l) { return '<button data-v="' + l[0] + '"' + (l[0] === L ? ' class="on"' : '') + '>' + esc(l[1]) + '</button>'; }).join('');
    var vals = L === 'loss' && z ? z.segs.map(function (s) { return s.loss; }) : L === 'sd' && z ? z.segs.map(function (s) { return s.sd; }) : a ? a.segs.map(function (s) { return s.lost; }) : [];
    var zl = z ? z.zones : [], sel = zl.filter(function (w) { return w.n === ov.zone; })[0] || null;
    function inZone(i, w) { return (i - w.i0 + n) % n < w.len; }
    var legend = L === 'sd' ? ['Steady', 'Varies most'] : L === 'loss' ? ['About your best', 'You lose the most'] : ['Your best there', 'Your best lap lost the most'];
    var st = rec.length / n, range = ov.seg !== null ? { name: 'Segment ' + (ov.seg + 1), from: ov.seg * st, len: st } : sel ? { name: 'Spot ' + sel.n, from: sel.from, len: sel.len * st } : null;
    var lines = shownLines(), marks = [];
    if (range) lines.forEach(function (l) { var s = U.lineSpot(l.line, range.from, range.len, rec.length), p = s && s.brakeAt !== null ? at(l.line, s.brakeAt) : null; if (p) marks.push({ x: p[0], z: p[1], col: l.col, title: l.label + ': brakes at ' + m(s.brakeAt) }); });
    $('ovMap').innerHTML = drawMap(rec, vals, { W: 1000, H: 640, big: true, zones: zl, selZone: ov.seg === null ? ov.zone : null, lines: lines, marks: marks,
      hi: function (i) { return ov.seg === i || (ov.seg === null && sel && inZone(i, sel)); }, title: function (i) { return segLine(i); } }) +
      '<div class="legend"><span><i style="background:hsl(130,75%,52%)"></i>' + legend[0] + '</span><span><i style="background:hsl(0,75%,52%)"></i>' + legend[1] + '</span><span class="faint">Click a segment or a numbered weak spot · scroll to zoom, drag to move, double-click to reset</span><button class="btn" id="ovReset" style="padding:3px 12px" hidden>Reset zoom</button></div>';
    var h = linesHtml(range);
    if (zl.length) {
      h += '<div class="sub" style="margin:0 0 6px">Your weak spots (3 segments, about ' + Math.round(3 * rec.length / n) + ' m each)</div><table class="tbl"><thead><tr><th>#</th><th>Where</th><th class="num">Per lap</th><th class="num">Came back</th></tr></thead><tbody>' +
        zl.map(function (w) { return '<tr class="click' + (ov.seg === null && w.n === ov.zone ? ' sel' : '') + '" data-z="' + w.n + '"><td>' + w.n + '</td><td>' + esc(where(w)) + '</td><td class="num red">' + F.plusSec(w.loss) + '</td><td class="num">' + w.seen + ' / ' + w.of + '</td></tr>'; }).join('') + '</tbody></table>';
    } else h += '<div class="muted" style="margin-bottom:10px">' + (z ? 'No weak spots: you are close to your best everywhere.' : 'The weak spots appear after a session with 3 or more laps within 5 % of your best here.') + '</div>';
    var list = ov.seg !== null ? [ov.seg] : sel ? [0, 1, 2].map(function (k) { return (sel.i0 + k) % n; }) : [];
    if (list.length) {
      h += '<div class="sub" style="margin:16px 0 6px">' + (ov.seg !== null ? 'Segment ' + (ov.seg + 1) : 'Weak spot ' + sel.n + ', segment by segment') + '</div><table class="tbl"><thead><tr><th>Seg</th><th class="num">Your best</th><th class="num">You lose</th><th class="num">Varies</th><th class="num">Best lap</th></tr></thead><tbody>' +
        list.map(function (i) {
          var s = z ? z.segs[i] : null, b = a ? a.segs[i] : null;
          return '<tr class="click' + (ov.seg === i ? ' sel' : '') + '" data-i="' + i + '" title="' + esc(segLine(i)) + '"><td>' + (i + 1) + '</td><td class="num purple">' + F.sector(rec.best[i]) + '</td><td class="num red">' + (s ? F.plusSec(s.loss) : '--') +
            '</td><td class="num">' + (s ? F.spread(s.sd) : '--') + '</td><td class="num">' + (b && b.lost !== null ? F.plusSec(b.lost) : '--') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    h += '<div class="foot">You lose = your average there in your last sessions (laps within 5 % of your best lap) minus your best ever there. Varies = how much it changes from lap to lap.' +
      ' Best lap = what your best lap lost there. Came back = in how many of those sessions this spot was one of your 3 biggest losses.</div>';
    $('ovSide').innerHTML = h;
    zoomable();
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
    return 'Segment ' + (i + 1) + ' · ' + F.km(i * st) + ' – ' + F.km((i + 1) * st) + (sc >= 0 ? ' · ' + SEC[sc] : '') + (s ? ' · you lose ' + F.plusSec(s.loss) + ' s, varies ' + F.spread(s.sd) : '');
  }
  function setup() {
    var d = document.createElement('div'); d.className = 'mapov'; d.id = 'mapOv'; d.hidden = true; d.innerHTML = MARKUP; document.body.appendChild(d);
    $('ovClose').onclick = closeMap;
    $('mapOv').onclick = function (e) { if (e.target === this) closeMap(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov) closeMap(); });
    $('ovLayer').onclick = function (e) { var b = e.target.closest('button'); if (!b || !ov) return; ov.layer = b.getAttribute('data-v'); drawOv(); };
    $('ovMap').onclick = function (e) {
      if (!ov || moved) { moved = false; return; } var g = e.target.closest('[data-z]'), p = e.target.closest('path[data-i]');
      if (g) { ov.zone = +g.getAttribute('data-z'); ov.seg = null; } else if (p) ov.seg = +p.getAttribute('data-i'); else return;
      drawOv();
    };
    $('ovSide').onchange = function (e) {
      if (!ov) return; var c = e.target.closest('input[data-l]'), L = ov.lines;
      if (c) { var id = c.getAttribute('data-l'); L.show[id] = c.checked; if (c.checked) { if (id === 'lap' && !L.lap && L.list.laps.length) L.lap = String(L.list.laps[0].t); want(id === 'lap' ? L.lap : id); } drawOv(); return; }
      if (e.target.id === 'ovLap') { L.lap = e.target.value; L.show.lap = true; want(L.lap); drawOv(); }
    };
    $('ovSide').onclick = function (e) {
      if (!ov || e.target.closest('.ov-lines')) return; var r = e.target.closest('tr[data-z]'), s = e.target.closest('tr[data-i]');
      if (r) { ov.zone = +r.getAttribute('data-z'); ov.seg = null; } else if (s) ov.seg = +s.getAttribute('data-i'); else return;
      drawOv();
    };
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

  P.trackMap = { draw: drawMap, where: where, open: openMap, outline: outline };
})(window);
