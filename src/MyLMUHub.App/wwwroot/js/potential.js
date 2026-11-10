// Improve page (potential.html): your next session focus, the weakness ranking (tracks, sectors, what keeps coming back), tracks behind your level,
// time left on the table (best lap vs optimal) on the tab 'What to work on'; the tab 'Track study' = one track + car in the map view (trackmap.js: where you
// lose time, driving lines). The focus card's map leads there.
// Maths: potential-math.js. Follows new laps / result files by itself (hub.js watchPace) and new segment laps (api/segments, looked at every 10 s).
(function (root) {
  'use strict';
  var P = root.MyLMUHub, F = P.format, R = P.paceRef, U = P.potentialMath, H = P.hub, esc = H.esc;
  var TM = P.trackMap, drawMap = TM.draw, where = TM.where;                                        // the maps and the map view: trackmap.js
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
  function renderAll() { if (!data) return; U.markOld(data.sessions, ref); filters(); renderFocus(); renderTracks(); renderOptimal(); applySeg(); }
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
      applySeg(true); if (data) renderFocus();
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

  // ---------- the two tabs: What to work on / Track study (remembered; #study opens it) ----------
  var pageTab = 'work';
  try { pageTab = location.hash === '#study' ? 'study' : (localStorage.getItem('pw-pot-tab') || 'work'); } catch (e) {}
  function tab(v) {
    pageTab = v === 'study' ? 'study' : 'work';
    $('tabWork').hidden = pageTab !== 'work'; $('tabStudy').hidden = pageTab !== 'study';
    [].forEach.call($('pageTab').querySelectorAll('button'), function (b) { b.className = b.getAttribute('data-v') === pageTab ? 'on' : ''; });
    try { localStorage.setItem('pw-pot-tab', pageTab); } catch (e) {}
  }
  $('pageTab').onclick = function (e) { var b = e.target.closest('button'); if (b) { tab(b.getAttribute('data-v')); window.scrollTo(0, 0); } };
  tab(pageTab);
  // the focus card's map: this track + car in Track study
  function study(key) {
    segKey = key; tab('study'); window.scrollTo(0, 0);
    if (!segList.some(function (s) { return s.key === key; })) { segList = segAll.filter(function (s) { return s.key === key; }).concat(segList); }
    $('segSel').innerHTML = segList.map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === segKey ? ' selected' : '') + '>' + esc(s.track + ' · ' + s.car + ' (' + s.laps + ' laps)') + '</option>'; }).join('');
    loadSeg();
  }
  function segEmpty(msg) { $('segSel').hidden = true; $('segTiles').innerHTML = ''; var m = $('studyMap'); m._ov = false; m.innerHTML = '<div class="muted" style="padding:20px 0">' + esc(msg) + '</div>'; }
  function loadSeg() {
    $('segSel').hidden = false;
    var key = segKey;
    H.json('api/segments?key=' + encodeURIComponent(key)).then(function (rec) {
      if (key !== segKey) return;
      var a = U.segments(rec); if (!a) { segEmpty('Not enough laps on this one yet.'); return; }
      $('segTiles').innerHTML = tile('Best lap', F.lap(a.bestLap), '', 'purple') + tile('Theoretical best', F.lap(a.theoretical), 'your best in every segment') +
        tile('On the table', F.plusSec(a.gap), 'best lap vs theoretical', 'red') + tile('Typical lap', F.lap(a.typicalLap), F.plusSec(a.typicalGap) + ' vs theoretical') +
        tile('Laps timed', String(a.laps), rec.n + ' segments of ' + Math.round(rec.length / rec.n) + ' m');
      var s = segList.filter(function (x) { return x.key === key; })[0];
      TM.mount($('studyMap'), rec, s ? s.track + ' · ' + s.car : '', key);                     // the map view, inside the page
    }, function () { segEmpty('Could not read this one.'); });
  }
  // ---------- next session focus + weakness ranking ----------
  // focus list = per track + class your fastest car there (potential-math focus() + fastestCar()), ranked by what there is to find per lap;
  // the focus card shows the track picked in the ranking, else the top one
  var focList = [], focusKey = null, rankTab = 'tracks', focToken = 0, segCache = {}, SEC = ['S1', 'S2', 'S3'];
  function nameOf(o) { return (labels[tkey(o.track, o.layout)] || {}).name || R.trackName(o.track, o.layout) || o.track; }
  function current() { return focList.filter(function (f) { return f.key === focusKey; })[0] || focList[0] || null; }
  function secName(i) { return 'sector ' + (i + 1); }
  function renderFocus() {
    if (!data || !cls) return;
    focList = U.fastestCar(U.focus(data.sessions, ref, Date.now() / 1000, SLOW, 5)).filter(function (f) { return keep(f.track, f.layout, f.cls); });
    renderRank();
    var f = current();
    if (!f) {
      focToken++; $('focSub').innerHTML = ''; $('focMap').className = 'mapbox'; $('focMap').onclick = null; $('focMap').innerHTML = '';
      $('focText').innerHTML = '<div class="empty">' + esc(data.error || ('No track with 5 counted dry laps (all three sectors) yet' + (trk || find ? ' here.' : '.'))) + '</div>'; return;
    }
    var picked = f.key === focusKey && focList[0] && focList[0].key !== f.key;
    $('focSub').innerHTML = picked ? 'You picked this track in the ranking below. <a class="back" id="focBack">Back to your biggest opportunity</a>' :
      'Picked for you: the track where you have the most to find' + (trk ? '' : ' in this class') + '. Click another track in the ranking below to see its focus here.';
    if (picked) $('focBack').onclick = function () { focusKey = null; renderFocus(); };
    var my = ++focToken, s = H.inApp ? segFor(f) : null, c = s ? segCache[s.key] : null;
    if (c && c.gen === segGen) { paintFocus(f, c.rec, s.key); return; }
    paintFocus(f, null);
    if (s) getRec(s.key).then(function (rec) { if (my === focToken) paintFocus(f, rec, s.key); }, function () {});
  }
  // the live segments of the focus track: same track name and class, the same car if there is one, else the one with most laps
  function segFor(f) {
    var base = R.trackName(f.track, f.layout) || f.track, c = clsOf(f.cls);
    var m = segAll.filter(function (s) { return (R.trackName(s.track, '') || s.track) === base && clsOf(s.cls) === c; });
    return m.filter(function (s) { return s.car === f.car; })[0] || m.sort(function (a, b) { return b.laps - a.laps; })[0] || null;
  }
  function getRec(key) {
    return H.json('api/segments?key=' + encodeURIComponent(key)).then(function (rec) { segCache[key] = { gen: segGen, rec: rec }; return rec; });
  }
  function paintFocus(f, rec, key) {
    var z = rec ? U.zones(rec, 5) : null;
    $('focText').innerHTML = focusHtml(f, z, !!rec);
    var box = $('focMap');
    if (rec && rec.points && rec.n) {
      var a = U.segments(rec), vals = TM.vals(rec, z, a, z ? 'loss' : 'bestlap');                     // one colour per turn
      box.innerHTML = drawMap(rec, vals || [], { zones: z ? z.zones : [], title: function (i) { return 'Segment ' + (i + 1); } }) +
        '<div class="hint">' + (z ? 'Red = where you lose the most · numbers = your weak spots · ' : 'Red = where your best lap lost the most · ') + 'click to study this track</div>';
      box.className = 'mapbox click'; box.onclick = function () { study(key); };
    } else {
      box.className = 'mapbox'; box.onclick = null;
      box.innerHTML = '<div class="muted" style="padding:20px">' + esc(!H.inApp ? 'Open this page in the app: the map is timed live while you drive.' :
        'No map for this track yet: after a few valid laps there it shows the exact places where you lose time.') + '</div>';
    }
  }
  // the focus in plain words: what to work on (the sector you lose most in), how much, the three sectors side by side, and up to three short reasons
  function focusHtml(f, z, hasSeg) {
    var s = f.sectors[f.top], max = Math.max.apply(null, f.sectors.map(function (x) { return x.loss; }).concat([0.001])), h = '';
    h += '<div class="ftitle">Work on ' + esc(secName(f.top)) + ' at ' + esc(nameOf(f)) + '</div><div class="faint">' + esc(f.car) + ' · your fastest ' + esc(CLASS_LABEL[clsOf(f.cls)] || f.cls) + ' car here</div>';
    h += '<p class="fsay">Your usual ' + SEC[f.top] + ' is <b>' + F.plusSec(s.loss) + ' s</b> slower than your best ' + SEC[f.top] + '. That is the most time you lose in any sector.</p>';
    h += '<div class="sbars">' + f.sectors.map(function (x) {
      return '<div class="sbar' + (x.i === f.top ? ' on' : '') + '"><span>' + SEC[x.i] + '</span><div class="bar"><i style="width:' + Math.max(2, Math.round(100 * Math.max(0, x.loss) / max)) + '%"></i></div><b>' + F.plusSec(x.loss) + ' s</b></div>';
    }).join('') + '<div class="faint" style="font-size:12px">Time lost per lap in each sector: your usual time there against your best.</div></div>';
    var why = [];
    if (f.sessions >= 2 && s.weakest >= 2) why.push('<b>It keeps happening:</b> ' + SEC[f.top] + ' was your weakest sector in ' + s.weakest + ' of your last ' + f.sessions + ' sessions here.');
    var zs = z ? z.zones : [], spot = zs.filter(function (w) { return w.sector === f.top; })[0] || zs[0];
    if (spot) why.push('<b>Where on the track:</b> the biggest loss is at ' + esc(where(spot)) + ', number ' + spot.n + ' on the map (' + F.plusSec(spot.loss) + ' s per lap).');
    else if (H.inApp) why.push('<span class="faint">' + (hasSeg ? 'The exact places appear on the map after a session with 3 or more laps close to your best here.' : 'The exact places appear on the map after a few timed laps here.') + '</span>');
    if (f.stale) why.push('<b>Not driven for ' + f.days + ' days</b> and ' + F.plusSec(f.behind) + ' s per lap behind your level here: just getting laps in will help.');
    else if (f.behind > 0) why.push('<b>Behind your level:</b> ' + F.plusSec(f.behind) + ' s per lap slower here than your level on other tracks.');
    if (why.length) h += '<ul>' + why.map(function (w) { return '<li>' + w + '</li>'; }).join('') + '</ul>';
    return h;
  }

  function renderRank() {
    var tabs = $('rankTab').querySelectorAll('button'); for (var i = 0; i < tabs.length; i++) tabs[i].className = tabs[i].getAttribute('data-v') === rankTab ? 'on' : '';
    var cur = current(), h, list;
    function row(f, cells) {
      var on = cur && f.key === cur.key;
      return '<tr class="click' + (on ? ' sel' : '') + '" data-k="' + esc(f.key) + '" title="Show this track in the focus above">' + cells + '<td class="pick">' + (on ? '<span class="chip lime">SHOWN ABOVE</span>' : 'Show above ↑') + '</td></tr>';
    }
    function tc(f) { return '<td>' + esc(nameOf(f)) + '<span class="two">' + esc(f.car) + '</span></td>'; }
    function dots(n, of) { var d = ''; for (var k = 0; k < of; k++) d += '<i class="' + (k < n ? 'on' : '') + '"></i>'; return '<span class="dots">' + d + '</span>'; }
    if (rankTab === 'tracks') {
      $('rankSub').textContent = 'How much faster your average lap could be on each track, most first. One row per track (your fastest car there). Hover a column title for what it means.';
      list = focList.slice(0, 30);
      h = '<thead><tr><th>Track</th><th class="num" title="Average vs optimal + behind your level">Possible gain per lap</th><th class="num" title="Your average lap against your optimal lap (your best three sectors in one lap): time you already showed you can do">Average vs optimal</th><th class="num" title="How much slower this track is than your level on your other tracks (against the alien times)">Behind your level</th><th class="num" title="Your average lap against your best lap">Best vs average</th><th>Weakest sector</th><th>Last</th><th></th></tr></thead><tbody>' +
        list.map(function (f) {
          return row(f, tc(f) + '<td class="num red">' + F.plusSec(f.score) + '</td><td class="num">' + F.plusSec(f.potential) + '</td><td class="num">' + (f.behind > 0 ? F.plusSec(f.behind) : '<span class="faint">--</span>') +
            '</td><td class="num">' + F.plusSec(f.spread) + '</td><td>' + SEC[f.top] + ' <span class="faint">' + F.plusSec(f.sectors[f.top].loss) + '</span>' + (f.stale ? ' <span class="chip pit">STALE</span>' : '') + '</td><td>' + F.day(f.last) + '</td>');
        }).join('');
    } else if (rankTab === 'sectors') {
      $('rankSub').textContent = 'Every sector of your tracks by how much you lose there per lap: your usual time against your best. One car per track: your fastest there.';
      list = []; focList.forEach(function (f) { f.sectors.forEach(function (s) { list.push({ f: f, s: s }); }); });
      list.sort(function (a, b) { return b.s.loss - a.s.loss; }); list = list.slice(0, 30);
      h = '<thead><tr><th>Track</th><th>Sector</th><th class="num">Your best</th><th class="num">Usual</th><th class="num">You lose</th><th class="num">Varies</th><th></th></tr></thead><tbody>' +
        list.map(function (x) {
          return row(x.f, tc(x.f) + '<td>' + SEC[x.s.i] + '</td><td class="num purple">' + F.sector(x.s.best) + '</td><td class="num">' + F.sector(x.s.typical) + '</td><td class="num red">' + F.plusSec(x.s.loss) +
            '</td><td class="num">' + F.spread(x.s.sd) + '</td>');
        }).join('');
    } else {
      $('rankSub').textContent = 'The same sector was your weakest in most of your recent sessions on a track: a habit, not bad luck. These are worth a practice session of their own.';
      list = U.repeats(focList, 3).slice(0, 30);
      h = '<thead><tr><th>Track</th><th>Weakest every time</th><th>Your last sessions there</th><th class="num">Costs per lap</th><th>Last</th><th></th></tr></thead><tbody>' +
        list.map(function (x) {
          return row(x.f, tc(x.f) + '<td>' + SEC[x.sector.i] + '</td><td>' + dots(x.seen, x.of) + ' <span class="faint">weakest in ' + x.seen + ' of ' + x.of + '</span></td><td class="num red">' + F.plusSec(x.sector.loss) + ' s</td><td>' + F.day(x.f.last) + '</td>');
        }).join('');
    }
    if (!list.length) h = '<tbody><tr><td class="empty">' + (rankTab === 'repeats' ? 'No repeat problems: no sector was your weakest in 3 or more of your recent sessions on a track.' : 'No track with 5 counted dry laps (all three sectors) yet.') + '</td></tr></tbody>';
    $('rankTbl').innerHTML = h + (list.length ? '</tbody>' : '');
  }
  $('rankTab').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; rankTab = b.getAttribute('data-v'); renderRank(); };
  $('rankTbl').onclick = function (e) {
    var r = e.target.closest('tr[data-k]'); if (!r) return; focusKey = r.getAttribute('data-k'); renderFocus();
    $('focCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    var c = $('focCard'); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
  };

  // ---------- data ----------
  function show(i) { data = i; H.setWho(i.names && i.names[0]); renderAll(); }
  H.loadPace(function () {}, function (i) { show(i); H.watchPace(i.gen, show); });
  (H.inApp ? H.json('api/reference') : fetch('data/alien-times.csv').then(function (r) { return r.text(); }).then(function (csv) { return { csv: csv }; }))
    .then(function (r) { ref = R.parse(r.csv); renderAll(); }, function () {});
  loadSegList(); if (H.inApp) setInterval(function () { if (!document.hidden) loadSegList(); }, 10000);
  document.addEventListener('pw-names', function () { setTimeout(function () { location.reload(); }, 300); });
})(window);
