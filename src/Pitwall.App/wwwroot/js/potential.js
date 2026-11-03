// Untapped potential page: tracks behind your level, time left on the table (best lap vs optimal), and your segments (where on a track you lose time).
// Maths: potential-math.js. Follows new laps / result files by itself (hub.js watchPace) and new segment laps (api/segments, looked at every 10 s).
(function (root) {
  'use strict';
  var P = root.Pitwall, F = P.format, R = P.paceRef, U = P.potentialMath, H = P.hub, esc = H.esc;
  function $(id) { return document.getElementById(id); }
  var data = null, ref = {}, SLOW = 0.05, segAll = [], segList = [], segKey = null, segGen = null;
  // ---------- filter: one class (the one you drive most at first, remembered), all its tracks or one (each layout on its own), a search ----------
  var CLASS_LABEL = { LMH: 'Hypercar', LMP2wec: 'LMP2', LMP2elms: 'LMP2 ELMS', LMP3: 'LMP3', LMGT3: 'GT3', GTE: 'GTE' };
  var cls = null, trk = '', find = '', labels = {};
  try { cls = localStorage.getItem('pw-pot-class'); } catch (e) {}
  function clsOf(c) { return R.className(c) || String(c || ''); }
  function tkey(course, layout) { return R.trackKey(course, layout); }
  function keep(course, layout, c) {
    if (clsOf(c) !== cls) return false; var k = tkey(course, layout);
    return (!trk || k === trk) && (!find || String((labels[k] || {}).name || R.trackName(course, layout) || course).toLowerCase().indexOf(find) >= 0);
  }
  function filters() {
    var laps = {}, tracks = {}, bases = {};
    data.sessions.forEach(function (s) { if (s.old) return; var c = clsOf(s['class']); laps[c] = (laps[c] || 0) + s.laps.length; });
    var all = Object.keys(laps).sort(function (a, b) { return laps[b] - laps[a]; });
    if (!cls || all.indexOf(cls) < 0) cls = all[0] || null;
    $('segCls').innerHTML = all.map(function (c) { return '<button data-v="' + esc(c) + '"' + (c === cls ? ' class="on"' : '') + '>' + esc(CLASS_LABEL[c] || c) + '</button>'; }).join('');
    data.sessions.forEach(function (s) {
      if (s.old || clsOf(s['class']) !== cls) return; var k = tkey(s.track, s.layout), base = R.trackName(s.track, s.layout) || s.track;
      if (!tracks[k]) { tracks[k] = { key: k, base: base, layout: s.layout }; bases[base] = (bases[base] || 0) + 1; }
    });
    labels = {};
    Object.keys(tracks).forEach(function (k) { var t = tracks[k]; t.name = t.base + (bases[t.base] > 1 && t.layout ? ' · ' + R.variantLabel(t.base, t.layout) : ''); labels[k] = t; });
    var list = Object.keys(labels).map(function (k) { return labels[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (trk && !labels[trk]) trk = '';
    var shown = list.filter(function (t) { return !find || t.name.toLowerCase().indexOf(find) >= 0; });
    $('trkSel').innerHTML = '<option value="">All tracks (' + shown.length + ')</option>' + shown.map(function (t) { return '<option value="' + esc(t.key) + '"' + (t.key === trk ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
    $('filterInfo').textContent = !all.length ? 'No sessions yet' : '';
  }
  $('segCls').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return; cls = b.getAttribute('data-v'); trk = '';
    try { localStorage.setItem('pw-pot-class', cls); } catch (x) {} renderAll();
  };
  $('trkSel').onchange = function () { trk = this.value; renderAll(); };
  $('find').oninput = function () { find = this.value.trim().toLowerCase(); trk = ''; renderAll(); };
  function renderAll() { if (!data) return; U.markOld(data.sessions, ref); filters(); renderTracks(); renderOptimal(); applySeg(); }
  H.header('potential');
  function tile(k, v, n, cls) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + esc(v) + '</div><div class="n">' + esc(n || '') + '</div></div>'; }
  function trackLink(course, layout, car) { return 'pace.html#t=' + encodeURIComponent(R.trackKey(course, layout)) + (car ? '&c=' + encodeURIComponent(car) : ''); }

  // ---------- tracks behind your level ----------
  function renderTracks() {
    if (!data || !cls) return;
    var now = Date.now() / 1000, t = U.tracks(data.sessions, ref, now, SLOW, 30), lv = t.levels[cls] || { v: null, from: 'all' }, k = R.category(lv.v);
    var list = t.list.filter(function (g) { return keep(g.course, g.layout, g.cls); });
    var gains = list.filter(function (g) { return g.gainSec > 0; });
    $('lvlTiles').innerHTML = tile('Your ' + (CLASS_LABEL[cls] || cls) + ' level now', F.pctOver(lv.v), (k ? k.name + ' · ' : '') + (lv.from === 'recent' ? 'your tracks of the last 30 days' : 'all your tracks in this class'), '') +
      tile('Tracks behind it', String(gains.length), 'of ' + list.length + ' with a race pace') +
      tile('Most to gain', gains.length ? F.plusSec(gains[0].gainSec) + ' s / lap' : '--', gains.length ? (labels[tkey(gains[0].course, gains[0].layout)] || {}).name || gains[0].track : '') +
      tile('Stale tracks', String(gains.filter(function (g) { return g.stale; }).length), 'behind and not driven in 30 days');
    if (!list.length) { $('trkTbl').innerHTML = '<tbody><tr><td class="empty">' + (data.error ? esc(data.error) : (trk || find ? 'No race pace on this track yet (5 counted dry laps, a track in the reference sheet).' : 'No race pace yet on tracks in the reference sheet (5 counted dry laps on a track).')) + '</td></tr></tbody>'; return; }
    var h = '<thead><tr><th>Track</th><th>Class</th><th class="num">Your pace</th><th class="num">vs alien</th><th class="num">Last 3 sessions</th><th class="num">Behind your level</th><th class="num">Per lap</th><th>Last driven</th><th></th></tr></thead><tbody>';
    list.forEach(function (g) {
      var kc = R.category(g.ratio), better = g.gain !== null && g.gain <= 0, alone = g.gain === null;
      h += '<tr class="click" data-href="' + esc(trackLink(g.course, g.layout)) + '"><td>' + esc((labels[tkey(g.course, g.layout)] || {}).name || g.track) + '</td><td>' + esc(g.cls) +
        '</td><td class="num">' + F.lap(g.pace) + '</td><td class="num" style="color:' + (kc ? kc.color : '') + '">' + F.pctOver(g.ratio) + '</td><td class="num">' + F.pctOver(g.recentRatio) +
        '</td><td class="num ' + (alone ? '' : better ? 'green' : 'red') + '" title="your ' + esc(g.cls) + ' level: ' + F.pctOver(g.level) + '">' + (alone ? '<span class="faint">only track of this class</span>' : better ? 'at or above' : F.pctPts(g.gain)) + '</td><td class="num">' + (better || alone ? '' : F.plusSec(g.gainSec) + ' s') +
        '</td><td>' + F.day(g.last) + ' <span class="faint">(' + g.days + ' d)</span></td><td>' + (g.stale && !better && !alone ? '<span class="chip pit" title="not driven in 30 days: probably behind because you improved since">STALE</span>' : '') + '</td></tr>';
    });
    $('trkTbl').innerHTML = h + '</tbody>';
    $('trkTbl').onclick = function (e) { var r = e.target.closest('tr[data-href]'); if (r) location.href = r.getAttribute('data-href'); };
  }

  // ---------- best lap vs optimal ----------
  function renderOptimal() {
    if (!data || !cls) return;
    var list = U.optimal(data.sessions, SLOW).filter(function (o) { return keep(o.track, o.layout, o.cls); }).slice(0, 30);
    if (!list.length) { $('optTbl').innerHTML = '<tbody><tr><td class="empty">No laps with all three sectors yet' + (trk || find ? ' on this track' : '') + '.</td></tr></tbody>'; return; }
    var h = '<thead><tr><th>Track</th><th>Car</th><th class="num">Best lap</th><th class="num">Optimal</th><th class="num">On the table</th><th class="num">Race pace</th><th class="num">Pace vs best</th><th>Last</th></tr></thead><tbody>';
    list.forEach(function (o) {
      h += '<tr class="click" data-href="' + esc(trackLink(o.track, o.layout, o.car)) + '"><td>' + esc((labels[tkey(o.track, o.layout)] || {}).name || R.trackName(o.track, o.layout) || o.track) + '</td><td>' + esc(o.car) + '<span class="two">' + esc(o.cls) + '</span></td><td class="num purple">' + F.lap(o.best) +
        '</td><td class="num">' + F.lap(o.optimal) + '</td><td class="num red">' + F.plusSec(o.gap) + '</td><td class="num">' + F.lap(o.pace) + '</td><td class="num">' + F.plusSec(o.spread) + '</td><td>' + F.day(o.last) + '</td></tr>';
    });
    $('optTbl').innerHTML = h + '</tbody>';
    $('optTbl').onclick = function (e) { var r = e.target.closest('tr[data-href]'); if (r) location.href = r.getAttribute('data-href'); };
  }

  // ---------- segments ----------
  function loadSegList() {
    if (!H.inApp) { segEmpty('Open this page in the app: segments are timed live while you drive.'); return; }
    H.json('api/segments').then(function (r) {
      if (r.gen === segGen) return; segGen = r.gen;
      segAll = (r.list || []).sort(function (a, b) { return b.updated - a.updated; });
      applySeg(true);
    }, function () { segEmpty('Could not read the segments.'); });
  }
  // the segments of the class (and track / search) chosen at the top. The live name has no layout: a track = its name
  function applySeg(reload) {
    if (!H.inApp) return;
    var base = trk && labels[trk] ? labels[trk].base : '';
    segList = segAll.filter(function (s) {
      var name = R.trackName(s.track, '') || s.track;
      return (!cls || clsOf(s.cls) === cls) && (!base || name === base) && (!find || name.toLowerCase().indexOf(find) >= 0);
    });
    if (!segList.length) { segKey = null; segEmpty(segAll.length ? 'No segments for this class / track yet: drive a few valid laps there.' : 'No segments yet: drive a few valid laps (your own name) and they appear here, live.'); return; }
    var was = segKey; if (!segKey || !segList.some(function (s) { return s.key === segKey; })) segKey = segList[0].key;
    $('segSel').innerHTML = segList.map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === segKey ? ' selected' : '') + '>' + esc(s.track + ' · ' + s.car + ' (' + s.laps + ' laps)') + '</option>'; }).join('');
    if (reload || was !== segKey) loadSeg();
  }
  $('segSel').onchange = function () { segKey = this.value; loadSeg(); };
  function segEmpty(msg) { $('segSel').hidden = true; $('segTiles').innerHTML = ''; $('segMap').innerHTML = '<div class="muted">' + esc(msg) + '</div>'; $('segSide').hidden = true; }
  function loadSeg() {
    $('segSel').hidden = false; $('segSide').hidden = false;
    H.json('api/segments?key=' + encodeURIComponent(segKey)).then(function (rec) {
      var a = U.segments(rec); if (!a) { segEmpty('Not enough laps on this one yet.'); return; }
      $('segTiles').innerHTML = tile('Best lap', F.lap(a.bestLap), '', 'purple') + tile('Theoretical best', F.lap(a.theoretical), 'your best in every segment') +
        tile('On the table', F.plusSec(a.gap), 'best lap vs theoretical', 'red') + tile('Typical lap', F.lap(a.typicalLap), F.plusSec(a.typicalGap) + ' vs theoretical') +
        tile('Laps timed', String(a.laps), rec.n + ' segments of ' + Math.round(rec.length / rec.n) + ' m');
      $('segMap').innerHTML = map(a, rec);
      $('segWorst').innerHTML = rows(a.worst, 'lost', 'Your best lap there');
      $('segTypical').innerHTML = rows(a.worstTypical, 'typical', 'You usually lose');
    }, function () { segEmpty('Could not read this one.'); });
  }
  function rows(list, k, label) {
    if (!list.length) return '<tbody><tr><td class="empty">Nothing lost: every segment is your best.</td></tr></tbody>';
    return '<thead><tr><th>Segment</th><th>Where</th><th class="num">Your best there</th><th class="num">' + esc(label) + '</th></tr></thead><tbody>' + list.map(function (s) {
      return '<tr><td>' + (s.i + 1) + '</td><td>' + F.km(s.from) + ' – ' + F.km(s.to) + '</td><td class="num">' + F.sector(s.best) + '</td><td class="num red">' + F.plusSec(s[k]) + '</td></tr>';
    }).join('') + '</tbody>';
  }
  // the track drawn from the segments' own points, each segment coloured by what your best lap lost there (green = your best there ... red = the most)
  function map(a, rec) {
    var pts = a.segs.map(function (s) { return s.pts; }), all = [];
    pts.forEach(function (p) { if (p && (p[0] || p[1])) all.push([p[0], p[1]]); if (p && (p[2] || p[3])) all.push([p[2], p[3]]); });
    if (all.length < 10) return '<div class="muted">The map appears after a full lap.</div>';
    var W = 520, Hh = 340, pad = 16, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    all.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, -q[1]); y1 = Math.max(y1, -q[1]); });
    var sc = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (Hh - 2 * pad) / Math.max(1, y1 - y0)), ox = (W - (x1 - x0) * sc) / 2, oy = (Hh - (y1 - y0) * sc) / 2;
    function tx(x, z) { return (ox + (x - x0) * sc).toFixed(1) + ',' + (oy + (-z - y0) * sc).toFixed(1); }
    var worst = Math.max.apply(null, a.segs.map(function (s) { return s.lost || 0; }).concat([0.05]));
    var svg = '';
    a.segs.forEach(function (s, i) {
      var p = s.pts, q = a.segs[(i + 1) % a.segs.length].pts; if (!p || !q || !(p[0] || p[1]) || !(q[0] || q[1])) return;
      var f = Math.max(0, Math.min(1, (s.lost || 0) / worst)), col = 'hsl(' + Math.round(130 - 130 * f) + ',75%,52%)';
      svg += '<path d="M' + tx(p[0], p[1]) + ((p[2] || p[3]) ? ' L' + tx(p[2], p[3]) : '') + ' L' + tx(q[0], q[1]) + '" fill="none" stroke="' + col + '" stroke-width="' + (6 + 6 * f).toFixed(1) +
        '" stroke-linecap="round" stroke-linejoin="round"><title>Segment ' + (i + 1) + ' · ' + F.km(s.from) + ' – ' + F.km(s.to) + ' · best lap ' + F.plusSec(s.lost) + '</title></path>';
    });
    var st = a.segs[0].pts; if (st && (st[0] || st[1])) { var c = tx(st[0], st[1]).split(','); svg += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="6" fill="var(--text)"><title>Start / finish</title></circle>'; }
    return '<svg viewBox="0 0 ' + W + ' ' + Hh + '" style="width:100%;height:auto;display:block">' + svg + '</svg><div class="legend"><span><i style="background:hsl(130,75%,52%)"></i>Your best there</span><span><i style="background:hsl(0,75%,52%)"></i>Lost the most</span><span class="faint">Hover a segment</span></div>';
  }

  // ---------- data ----------
  function show(i) { data = i; H.setWho(i.names && i.names[0]); renderAll(); }
  H.loadPace(function () {}, function (i) { show(i); H.watchPace(i.gen, show); });
  (H.inApp ? H.json('api/reference') : fetch('data/alien-times.csv').then(function (r) { return r.text(); }).then(function (csv) { return { csv: csv }; }))
    .then(function (r) { ref = R.parse(r.csv); renderAll(); }, function () {});
  loadSegList(); if (H.inApp) setInterval(function () { if (!document.hidden) loadSegList(); }, 10000);
  document.addEventListener('pw-names', function () { setTimeout(function () { location.reload(); }, 300); });
})(window);
