// Race Pace page. Overview: your level (race pace % vs the alien sheet + category), speed progress, all tracks. A track (#t=...): fastest / most consistent /
// most driven car, the alien reference, progress on that track, your cars; a car (&c=...): its sessions and laps. Maths: pace-math.js, sheet: pace-ref.js, text: format.js.
(function (root) {
  'use strict';
  var P = root.Pitwall, F = P.format, M = P.paceMath, R = P.paceRef, H = P.hub, esc = H.esc;
  function $(id) { return document.getElementById(id); }
  var data = null, ref = {}, refInfo = null, types = ['Race'], period = 0, ver = 'current', current = null, cls = null, slow = 0.05, find = '', route = { t: '', c: '' }, selSession = -1;
  var COL = { counted: 'var(--lime)', wet: 'var(--blue)', slow: 'var(--red)', pit: '#7E8084', best: 'var(--purple)', dim: '#55575A' };   // pit / out grey: yellow is too close to lime
  H.header('pace');

  // ---------- data ----------
  function load() {
    H.loadPace(function (i) {
      $('prog').hidden = false; $('prog').firstChild.style.width = (i.total ? Math.round(100 * i.done / i.total) : 0) + '%';
      $('srcLine').textContent = 'Reading result files: ' + i.done + ' / ' + i.total + (i.folder ? ' · ' + i.folder : '');
    }, function (i) { $('prog').hidden = true; data = i; H.setWho(i.names && i.names[0]); render(); if (!watching) { watching = true; H.watchPace(i.gen, function (n) { data = n; render(); }); } });
  }
  var watching = false;                                                                // new laps / result files: the page follows by itself (hub.js watchPace)
  function loadRef() {
    var p = H.inApp ? H.json('api/reference') : fetch('data/alien-times.csv').then(function (r) { return r.text(); }).then(function (csv) { return { csv: csv, source: 'app' }; });
    p.then(function (r) { refInfo = r; ref = R.parse(r.csv); render(); }, function () { refInfo = null; });
  }
  document.addEventListener('pw-names', function () { setTimeout(load, 300); });

  // ---------- filters / routing ----------
  function seg(id, fn) {
    $(id).onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); }); fn(b.getAttribute('data-v')); render();
    };
  }
  seg('segTypes', function (v) { types = v ? v.split(',') : null; });
  seg('segPeriod', function (v) { period = Number(v); });
  seg('segVer', function (v) { ver = v; });
  seg('segCls', function (v) { cls = v; try { localStorage.setItem('pw-pace-class', v); } catch (e) {} });
  try { cls = localStorage.getItem('pw-pace-class'); } catch (e) {}
  $('slowSel').onchange = function () { slow = Number(this.value); render(); };
  $('find').oninput = function () { find = this.value.trim().toLowerCase(); if (data) overview(); };
  $('back').onclick = function () { go('', ''); };
  function readHash() { var h = new URLSearchParams(location.hash.slice(1)); route = { t: h.get('t') || '', c: h.get('c') || '' }; }
  function go(t, c) { location.hash = t ? 't=' + encodeURIComponent(t) + (c ? '&c=' + encodeURIComponent(c) : '') : ''; }
  window.addEventListener('hashchange', function () { readHash(); selSession = -1; render(); window.scrollTo(0, 0); });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(render, 150); });
  readHash();

  // ---------- grouping ----------
  function trackKey(s) { return R.trackKey(s.track, s.layout); }                       // every layout is its own track
  function refFor(sheet, cls) { var t = ref[sheet], c = R.className(cls); return t && c ? t[c] || null : null; }
  // game versions: a session below the sheet's patch for its track + class (else below the newest major version you drove) is old: never counted;
  // 'current' = left out, 'all' = shown, marked OLD (a track / car with only old sessions shows their numbers, marked, outside your level)
  function markOld() {
    current = null; data.sessions.forEach(function (s) { var m = R.major(s.version); if (m && (!current || m > current)) current = m; });
    data.sessions.forEach(function (s) { var rf = refFor(R.trackName(s.track, s.layout), s['class']); s.old = R.isOld(s.version, rf && rf.patch, current); });
  }
  function sessions() { var from = period ? Date.now() / 1000 - period * 86400 : 0; return data.sessions.filter(function (s) { return s.time >= from && (ver === 'all' || !s.old) && clsOf(s) === cls; }); }
  // the whole page shows one class (the sheet's classes; a class the sheet does not know by its own name)
  var CLASS_LABEL = { LMH: 'Hypercar', LMP2wec: 'LMP2', LMP2elms: 'LMP2 ELMS', LMP3: 'LMP3', LMGT3: 'GT3', GTE: 'GTE' };
  function clsOf(s) { return R.className(s['class']) || String(s['class'] || ''); }
  function clsName(c) { return CLASS_LABEL[c] || c; }
  function classButtons() {
    var laps = {}; data.sessions.forEach(function (s) { if (!s.old) { var c = clsOf(s); laps[c] = (laps[c] || 0) + s.laps.length; } });
    var all = Object.keys(CLASS_LABEL); data.sessions.forEach(function (s) { if (all.indexOf(clsOf(s)) < 0) all.push(clsOf(s)); });
    if (all.indexOf(cls) < 0) cls = all.slice().sort(function (a, b) { return (laps[b] || 0) - (laps[a] || 0); })[0];   // default: the class you drove most
    $('segCls').innerHTML = all.map(function (c) { return '<button data-v="' + esc(c) + '"' + (c === cls ? ' class="on"' : '') + '>' + esc(clsName(c)) + '</button>'; }).join('');
  }
  function counted(list) { var cur = list.filter(function (s) { return !s.old; }); return cur.length ? cur : list; }
  function oldChip(v) { return '<span class="chip dim" title="driven on an older game version: not counted">OLD' + (v > 0 ? ' v' + R.major(v).toFixed(1) : '') + '</span>'; }
  function verOf(list) { var v = 0; list.forEach(function (s) { if (s.version > v) v = s.version; }); return v; }
  function byKey(list, keyFn) {
    var m = {}, out = [];
    list.forEach(function (s) { var k = keyFn(s); if (!m[k]) { m[k] = { key: k, sessions: [], last: 0, laps: 0 }; out.push(m[k]); } m[k].sessions.push(s); m[k].last = Math.max(m[k].last, s.time); m[k].laps += s.laps.length; });
    return out;
  }
  // a track: its classes (stats + reference) and cars; main = the class with most laps
  function trackInfo(g) {
    var s0 = g.sessions[g.sessions.length - 1];
    g.course = s0.track; g.sheet = R.trackName(s0.track, s0.layout); g.base = g.sheet || s0.track; g.layout = R.layoutLabel(s0.layout); g.name = g.base; g.known = !!ref[g.sheet];
    g.classes = byKey(g.sessions, function (s) { return s['class']; }).map(function (c) { c.c = M.combine(counted(c.sessions), slow, types); c.old = c.sessions.every(function (s) { return s.old; }); c.ref = refFor(g.sheet, c.key); return c; }).sort(function (a, b) { return b.laps - a.laps; });
    g.cars = byKey(g.sessions, function (s) { return s.car; }).map(function (c) { c.cls = c.sessions[0]['class']; c.c = M.combine(counted(c.sessions), slow, types); c.old = c.sessions.every(function (s) { return s.old; }); c.ref = refFor(g.sheet, c.cls); return c; }).sort(function (a, b) { return b.last - a.last; });
    g.main = g.classes.filter(function (c) { return !c.old; })[0] || g.classes[0]; g.old = g.main.old;
    return g;
  }
  function ratio(t, base) { return t > 0 && base > 0 ? t / base : null; }
  function paceRatio(c) { return c.ref && c.c.dry.clean >= 5 ? ratio(c.c.dry.pace, c.ref.race[0]) : null; }   // old-only classes / cars too: shown, marked OLD
  function hotRatio(c) { return c.ref ? ratio(c.c.dry.best, c.ref.hot) : null; }
  function catChip(r) { var k = R.category(r); return k ? '<span class="chip" style="background:' + k.color + ';color:#111">' + esc(k.name.toUpperCase()) + '</span>' : ''; }   // the sheet's colours

  function render() {
    if (!data) return;
    markOld(); classButtons();
    $('lvlSub').textContent = clsName(cls) + ': race pace compared with the alien times of the LMU laptimes sheet.';
    var n = data.sessions.length, laps = 0; data.sessions.forEach(function (s) { laps += s.laps.length; });
    $('srcLine').innerHTML = data.error ? '<span class="red">' + esc(data.error) + '</span>' :
      F.count(n) + ' sessions · ' + F.count(laps) + ' laps as <b>' + esc((data.names || []).join(', ') || 'nobody yet: click your name top right') + '</b>';
    var tracks = byKey(sessions(), trackKey).map(trackInfo), per = {};
    tracks.forEach(function (t) { per[t.base] = (per[t.base] || 0) + 1; });
    tracks.forEach(function (t) { if (per[t.base] > 1 && t.layout) t.name = t.base + ' · ' + R.variantLabel(t.base, t.sessions[0].layout); });   // several layouts of one track: name them
    var g = route.t && tracks.filter(function (x) { return x.key === route.t; })[0];
    $('ov').hidden = !!g; $('tv').hidden = !g;
    if (g) trackPage(g); else overview(tracks);
  }

  // ---------- overview ----------
  var lastTracks = [];
  function overview(tracks) {
    if (tracks) lastTracks = tracks; else tracks = lastTracks;
    level(tracks); progress();
    var h = '<thead><tr><th>Track</th><th>Class</th><th class="num">Cars</th><th class="num">Sessions</th><th class="num">Laps</th><th class="num">Best lap</th><th class="num">Fastest lap %</th>' +
      '<th class="num">' + paceLabel() + '</th><th class="num">Race pace %</th><th>Category</th><th class="num">Last driven</th></tr></thead><tbody>';
    var shown = tracks.filter(function (t) { return !find || (t.name + ' ' + t.course + ' ' + t.cars.map(function (c) { return c.key; }).join(' ')).toLowerCase().indexOf(find) >= 0; })
      .sort(function (a, b) { return b.last - a.last; });
    shown.forEach(function (t) {
      var m = t.main, d = m.c.dry, best = bestCar(t.cars.filter(function (c) { return c.cls === m.key; }), false), pr = paceRatio(m);
      h += '<tr class="click" data-t="' + esc(t.key) + '"' + (t.old ? ' style="opacity:.55"' : '') + '><td><b>' + esc(t.name) + '</b>' + (t.old ? ' ' + oldChip(verOf(t.sessions)) : '') + '<span class="two">' + esc(t.course + (t.layout ? ' · layout ' + t.layout : '') + (t.known ? '' : ' · not in the sheet')) + '</span></td><td>' + esc(m.key) +
        '</td><td class="num">' + t.cars.length + '</td><td class="num">' + t.sessions.length + '</td><td class="num">' + F.count(t.laps) + '</td><td class="num purple">' + F.lap(d.best) +
        '<span class="two">' + esc(best ? best.key : '') + '</span></td><td class="num">' + F.pctOver(hotRatio(m)) + '</td><td class="num">' + F.lap(d.pace) + '<span class="two">' + (d.clean ? d.clean + ' laps' : '') +
        '</span></td><td class="num"><b>' + F.pctOver(pr) + '</b></td><td>' + (t.old ? '' : catChip(pr)) + '</td><td class="num muted">' + F.day(t.last) + '</td></tr>';
    });
    // every track of the sheet is listed: the ones without a session here at the bottom, dimmed (driven before = only on an old game version or outside the period)
    var have = {}, ever = {};
    tracks.forEach(function (t) { if (t.sheet) have[t.sheet] = 1; });
    var from = period ? Date.now() / 1000 - period * 86400 : 0;
    data.sessions.forEach(function (s) { var n = R.trackName(s.track, s.layout); if (n && clsOf(s) === cls) ever[n] = Math.max(ever[n] || 0, s.time >= from ? 2 : 1); });   // 2 = in the period (so: old version only)
    var rest = Object.keys(ref).filter(function (n) { return !have[n] && ref[n][cls] && (!find || n.toLowerCase().indexOf(find) >= 0); }).sort();
    rest.forEach(function (n) {
      h += '<tr style="opacity:.45"><td><b>' + esc(n) + '</b><span class="two">' + (ever[n] === 2 ? 'only driven on an older game version' : ever[n] ? 'not driven in this period' : 'not driven yet') + '</span></td><td colspan="10"></td></tr>';
    });
    if (!shown.length && !rest.length) h += '<tr><td colspan="11" class="empty">' + (data.sessions.length ? 'Nothing here (check the period and the search).' : 'No sessions of yours found. Click your name top right.') + '</td></tr>';
    $('tracks').innerHTML = h + '</tbody>';
  }
  $('tracks').onclick = function (e) { var r = e.target.closest('tr[data-t]'); if (r) go(r.getAttribute('data-t'), ''); };
  // the fastest of these cars: by lap time, or (rel) by % over the alien hotlap of its own class (so a Hypercar does not always win); without a reference by lap time
  function bestCar(cars, rel) {
    var b = null, score = function (c) { return rel && hotRatio(c) ? hotRatio(c) : (rel ? 50 + c.c.dry.best : c.c.dry.best); };
    cars.forEach(function (c) { if (c.c.dry.best && (!b || score(c) < score(b))) b = c; }); return b;
  }
  function paceLabel() { return types && types.length === 1 ? 'Race pace' : 'Pace'; }

  // your level: the average race-pace % over every track + class with a reference and at least 5 counted laps
  function level(tracks) {
    var pr = [], hr = [], used = 0;
    tracks.forEach(function (t) { t.classes.forEach(function (c) { if (c.old) return; var p = paceRatio(c), b = hotRatio(c); if (p) { pr.push(p); used++; } if (b) hr.push(b); }); });   // old versions never count
    var avg = M.mean(pr), k = R.category(avg), avgQ = M.mean(hr), q = R.category(avgQ);
    $('lvlPace').textContent = F.pctOver(avg); $('lvlCat').textContent = k ? k.name : '--'; $('lvlCat').style.color = k ? k.color : '';
    $('lvlHot').textContent = F.pctOver(avgQ); $('lvlCatQ').textContent = q ? q.name : '--'; $('lvlCatQ').style.color = q ? q.color : '';
    $('lvlNh').textContent = hr.length; $('lvlN').textContent = used; $('lvlN2').textContent = used === 1 ? 'track / class with a pace' : 'tracks / classes with a pace';
    // the sheet's scale in its colours; RACE / QUALI under the category you are in
    $('lvlScale').innerHTML = R.BANDS.map(function (b, i) {
      var tags = (k && k.index === i ? '<i class="tag">RACE</i>' : '') + (q && q.index === i ? '<i class="tag q">QUALI</i>' : '');
      return '<div style="--c:' + b[2] + '" class="' + (tags ? 'on' : '') + '"><b>' + esc(b[0]) + '</b>' + ['~100%', '101%', '102-103%', '104-105%', '106%', '107%+'][i] + '<span class="tags">' + tags + '</span></div>';
    }).join('');
    $('lvlFoot').innerHTML = 'Reference: <a class="limec" href="#" id="sheetLink">Ohne Speed\'s LMU laptimes sheet</a>' + (refInfo ? ' (' + (refInfo.source === 'app' ? 'copy in the app' : 'downloaded ' + F.day(Date.parse(refInfo.date) / 1000)) + ')' : ' (not loaded)') +
      '. The sheet\'s categories assume you are consistent. ' + paceLabel() + ' from ' + typesText() + (period ? ', last ' + (period === 90 ? '3' : '12') + ' months' : '') +
      '. Only sessions on the sheet\'s game version for that track and class count (mostly ' + (current ? current.toFixed(1) : '1.4') + '+); older ones are left out' + (ver === 'all' ? ' (shown, marked OLD)' : '') + '.';
    var a = $('sheetLink'); if (a) a.onclick = function (e) { e.preventDefault(); if (refInfo && refInfo.link) window.open(refInfo.link, '_blank'); };
  }
  function typesText() { return types ? types.join(' + ').replace('Qualify', 'qualifying').toLowerCase() + ' sessions' : 'all sessions'; }

  // ---------- charts (inline SVG at the container's width; hover = tooltip) ----------
  var tip = $('tip');
  function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; var x = e.clientX + 14, y = e.clientY + 14; if (x + tip.offsetWidth > innerWidth - 8) x = e.clientX - tip.offsetWidth - 14; if (y + tip.offsetHeight > innerHeight - 8) y = e.clientY - tip.offsetHeight - 14; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
  function hideTip() { tip.style.display = 'none'; }
  // marks: [{ x, y, r, color, tip, kind: 'dot' | 'bar' }], lines: [{ pts: [[x, y]], color }]; y0..y1 = value range (clipped), fmtY, ticksX: [[x, label]]
  function chart(el, o) {
    var W = Math.max(300, el.clientWidth || 600), Hh = o.h || 240, L = 14 + 7 * Math.max(o.fmtY(o.y0).length, o.fmtY(o.y1).length), R_ = 12, T = 10, B = 26, iw = W - L - R_, ih = Hh - T - B;   // room for the longest axis label
    function sx(x) { return L + (o.x1 > o.x0 ? (x - o.x0) / (o.x1 - o.x0) : 0.5) * iw; }
    function sy(y) { y = Math.max(o.y0, Math.min(o.y1, y)); return T + (1 - (y - o.y0) / (o.y1 - o.y0)) * ih; }
    var s = '<svg class="chart" width="' + W + '" height="' + Hh + '" viewBox="0 0 ' + W + ' ' + Hh + '">';
    for (var i = 0; i <= 4; i++) { var v = o.y0 + (o.y1 - o.y0) * i / 4, y = sy(v); s += '<line class="ax" x1="' + L + '" x2="' + (W - R_) + '" y1="' + y + '" y2="' + y + '"/><text class="axt" x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + esc(o.fmtY(v)) + '</text>'; }
    (o.ticksX || []).forEach(function (t) { s += '<text class="axt" x="' + sx(t[0]) + '" y="' + (Hh - 6) + '" text-anchor="middle">' + esc(t[1]) + '</text>'; });
    (o.lines || []).forEach(function (l) { if (l.pts.length > 1) s += '<polyline class="ln" style="stroke:' + l.color + '" points="' + l.pts.map(function (p) { return sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1); }).join(' ') + '"/>'; });
    o.marks.forEach(function (m, k) {
      if (m.kind === 'bar') {
        var bw = Math.max(2, iw / o.marks.length - 2), x = sx(m.x) - bw / 2, y = sy(m.y), base = T + ih;
        s += '<rect data-k="' + k + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, base - y).toFixed(1) + '" rx="' + Math.min(4, bw / 2) + '" style="fill:' + m.color + '"/>';
      } else s += '<circle data-k="' + k + '" cx="' + sx(m.x).toFixed(1) + '" cy="' + sy(m.y).toFixed(1) + '" r="' + (m.r || 5) + '" style="fill:' + m.color + ';stroke:var(--card);stroke-width:2;cursor:' + (o.click ? 'pointer' : 'default') + '"/>';
    });
    el.innerHTML = s + '</svg>';
    var svg = el.firstChild;
    svg.onmousemove = function (e) { var k = e.target.getAttribute && e.target.getAttribute('data-k'); if (k === null) hideTip(); else showTip(e, o.marks[k].tip); };
    svg.onmouseleave = hideTip;
    svg.onclick = function (e) { var k = e.target.getAttribute && e.target.getAttribute('data-k'); if (k !== null && o.click) o.click(o.marks[k]); };
  }
  function range(vals, padFrac) { var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), p = (hi - lo) * (padFrac || 0.08) || 1; return [lo - p, hi + p]; }
  function monthTicks(t0, t1) {
    var out = [], d = new Date(t0 * 1000); d.setDate(1); d.setHours(0, 0, 0, 0);
    var months = (t1 - t0) / 2629800, step = months > 18 ? 3 : (months > 8 ? 2 : 1), MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (var i = 0; i < 40; i++) { d.setMonth(d.getMonth() + (i ? step : 1)); var t = d.getTime() / 1000; if (t > t1) break; out.push([t, MON[d.getMonth()] + (d.getMonth() === 0 ? ' ' + d.getFullYear() : '')]); }
    return out;
  }
  function pctAxis(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }

  // speed progress: every race / qualifying session, your best lap vs the class best (%), plus a 5-session average
  function progress() {
    if (progMode === 'alien') return progressAlien();
    $('progSub').textContent = 'Every race and qualifying session: your best lap compared with the fastest lap of your class in that session (0 % = you were the fastest). Lower is better; the line is the average of the last 5.';
    var pts = [];
    sessions().forEach(function (s) {
      if ((s.type !== 'Race' && s.type !== 'Qualify') || !(s.classBest > 0)) return;
      var a = M.session(s, slow), d = a.dry.best ? a.dry : a.wet; if (!d.best) return;
      pts.push({ x: s.time, y: (d.best / s.classBest - 1) * 100, s: s, best: d.best, wet: !a.dry.best });
    });
    var el = $('progressChart');
    if (pts.length < 2) { el.innerHTML = '<div class="empty">Not enough race or qualifying sessions in this period.</div>'; return; }
    var ys = pts.map(function (p) { return p.y; }).sort(function (a, b) { return a - b; }), top = Math.max(1, Math.min(15, ys[Math.floor(ys.length * 0.95)] * 1.15));
    var avg = pts.map(function (p, i) { var w = pts.slice(Math.max(0, i - 4), i + 1); return [p.x, M.mean(w.map(function (q) { return Math.min(q.y, top); }))]; });
    chart(el, { h: 250, x0: pts[0].x, x1: pts[pts.length - 1].x, y0: 0, y1: top, fmtY: pctAxis, ticksX: monthTicks(pts[0].x, pts[pts.length - 1].x),
      lines: [{ pts: avg, color: COL.counted }],
      marks: pts.map(function (p) {
        return { x: p.x, y: p.y, r: 4, color: p.wet ? COL.wet : '#7C7E7A', t: trackKey(p.s), c: p.s.car,
          tip: '<b>' + esc(p.s.track) + '</b> · ' + esc(p.s.type) + '<br>' + esc(p.s.car) + '<br>' + F.day(p.s.time) + '<br>Your best <span class="mono">' + F.lap(p.best) + '</span>' +
               '<br>Class best <span class="mono purple">' + F.lap(p.s.classBest) + '</span><br><b>' + F.pctOver(p.best / p.s.classBest) + '</b>' + (p.wet ? ' (wet)' : '') + (p.y > top ? '<br><span class="faint">(off the chart)</span>' : '') };
      }), click: function (m) { go(m.t, m.c); } });
    el.insertAdjacentHTML('beforeend', '<div class="legend"><span><i style="background:#7C7E7A"></i>Session (dry)</span><span><i style="background:var(--blue)"></i>Session (wet)</span><span><i style="background:var(--lime)"></i>Average of the last 5</span><span class="faint">Click a dot for that track</span></div>');
  }

  // speed progress vs the alien times: per session your fastest lap vs the alien hotlap (purple) and your race pace vs the alien race pace (lime);
  // dots = sessions, lines = the average of the last 5 of each. Only tracks / classes in the sheet.
  var progMode = 'alien';
  $('segProg').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); }); progMode = b.getAttribute('data-v'); progress();
  };
  function progressAlien() {
    $('progSub').textContent = 'Per session: your fastest lap vs the alien hotlap (purple, qualifying pace) and your ' + paceLabel().toLowerCase() + ' vs the alien race pace (lime), for tracks in the sheet. Lines = average of the last 5 sessions. Lower is better.';
    var hot = [], pace = [], vals = [];
    sessions().forEach(function (s) {
      var rf = refFor(R.trackName(s.track, s.layout), s['class']); if (!rf || s.old) return;                       // old game versions: not compared
      var a = M.session(s, slow), d = a.dry, base = { s: s, t: trackKey(s), c: s.car };
      var h = rf.hot ? ratio(d.best, rf.hot) : null, p = (!types || types.indexOf(s.type) >= 0) && d.clean >= 5 ? ratio(d.pace, rf.race[0]) : null;
      var tipTxt = '<b>' + esc(s.track) + '</b> · ' + esc(s.type) + '<br>' + esc(s.car) + '<br>' + F.day(s.time) +
        (h ? '<br>Fastest lap <span class="mono purple">' + F.lap(d.best) + '</span> ' + F.pctOver(h) + ' · ' + R.category(h).name : '') +
        (p ? '<br>Race pace <span class="mono limec">' + F.lap(d.pace) + '</span> ' + F.pctOver(p) + ' · ' + R.category(p).name : '');
      if (h) { hot.push({ x: s.time, y: (h - 1) * 100, b: base, tip: tipTxt }); vals.push((h - 1) * 100); }
      if (p) { pace.push({ x: s.time, y: (p - 1) * 100, b: base, tip: tipTxt }); vals.push((p - 1) * 100); }
    });
    var el = $('progressChart');
    if (hot.length + pace.length < 2) { el.innerHTML = '<div class="empty">Not enough sessions on tracks in the sheet in this period.</div>'; return; }
    vals.sort(function (a, b) { return a - b; });
    var lo = Math.min(0, vals[0]), hi = Math.max(1, Math.min(15, vals[Math.floor(vals.length * 0.95)] * 1.15));
    function avg(list) { return list.map(function (p, i) { var w = list.slice(Math.max(0, i - 4), i + 1); return [p.x, M.mean(w.map(function (q) { return Math.min(q.y, hi); }))]; }); }
    var all = hot.concat(pace).map(function (p) { return p.x; }), t0 = Math.min.apply(null, all), t1 = Math.max.apply(null, all);
    function dots(list, color) { return list.map(function (p) { return { x: p.x, y: p.y, r: 3.2, color: color, tip: p.tip + (p.y > hi ? '<br><span class="faint">(off the chart)</span>' : ''), t: p.b.t, c: p.b.c }; }); }
    chart(el, { h: 250, x0: t0, x1: t1, y0: lo, y1: hi, fmtY: pctAxis, ticksX: monthTicks(t0, t1),
      lines: [{ pts: avg(hot), color: COL.best }, { pts: avg(pace), color: COL.counted }],
      marks: dots(hot, 'rgba(180,124,255,.55)').concat(dots(pace, 'color-mix(in srgb, var(--lime) 55%, transparent)')), click: function (m) { go(m.t, m.c); } });
    el.insertAdjacentHTML('beforeend', '<div class="legend"><span><i style="background:var(--purple)"></i>Fastest lap vs alien hotlap (qualifying)</span><span><i style="background:var(--lime)"></i>' + paceLabel() + ' vs alien race pace</span><span class="faint">Dots = sessions, lines = average of the last 5 · click a dot for that track</span></div>');
  }

  // ---------- one track ----------
  function trackPage(g) {
    var m = g.main, pr = paceRatio(m);
    $('tTitle').textContent = g.name; $('tCat').innerHTML = g.old ? oldChip(verOf(g.sessions)) : catChip(pr);
    $('tSub').textContent = g.course + (g.layout ? ' · layout ' + g.layout : '') + ' · ' + g.sessions.length + ' sessions, ' + F.count(g.laps) + ' laps, last on ' + F.day(g.last) + (g.known ? '' : ' · this track is not in the reference sheet');
    var now = g.cars.filter(function (c) { return !c.old; }); if (!now.length) now = g.cars;   // cars driven on an old game version do not compete
    var fast = bestCar(now, true), cons = null, most = null;
    now.forEach(function (c) {
      if (c.c.dry.clean >= 10 && c.c.dry.sd && (!cons || c.c.dry.sd < cons.c.dry.sd)) cons = c;
      if (!most || c.laps > most.laps) most = c;
    });
    $('tTiles').innerHTML =
      tile('Fastest car (vs alien of its class)', fast ? (hotRatio(fast) ? F.pctOver(hotRatio(fast)) : F.lap(fast.c.dry.best)) : '--', fast ? fast.key + ' · ' + F.lap(fast.c.dry.best) : '', 'purple') +
      tile('Most consistent car', cons ? F.spread(cons.c.dry.sd) : '--', cons ? cons.key + ' · ' + cons.c.dry.clean + ' counted laps' : 'needs 10 counted laps') +
      tile('Most driven car', most ? F.count(most.laps) + ' laps' : '--', most ? most.key + ' · ' + most.sessions.length + ' sessions' : '') +
      tile(paceLabel() + ' (' + m.key + ')', F.pctOver(pr), pr ? F.lap(m.c.dry.pace) + ' · ' + R.category(pr).name : (m.ref ? 'needs 5 counted laps' : 'no reference'), 'limec') +
      tile('Fastest lap (' + m.key + ')', F.pctOver(hotRatio(m)), m.ref && m.ref.hot ? F.lap(m.c.dry.best) + ' vs alien ' + F.lap(m.ref.hot) + (hotRatio(m) ? ' · ' + R.category(hotRatio(m)).name : '') : 'no reference');
    trackChart(g); refTable(g); carsTable(g);
    var car = route.c && g.cars.filter(function (c) { return c.key === route.c; })[0];
    $('detail').hidden = !car; if (car) detail(g, car);
  }
  function tile(k, v, n, cls) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + esc(v) + '</div><div class="n">' + esc(n || '') + '</div></div>'; }

  // progress on this track: per session your best lap vs the alien hotlap and your pace vs the alien race pace (of that session's class); without a reference vs the class best
  function trackChart(g) {
    var marks = [], pace = [], vals = [], withRef = g.classes.some(function (c) { return c.ref; });
    g.sessions.forEach(function (s) {
      if (s.old) return;                                                                                         // old game versions: not compared
      var a = M.session(s, slow), d = a.dry, rf = refFor(g.sheet, s['class']);
      var b = rf && rf.hot ? ratio(d.best, rf.hot) : (withRef ? null : ratio(d.best, s.classBest)), p = rf && d.clean >= 3 ? ratio(d.pace, rf.race[0]) : null;
      var t = '<b>' + F.day(s.time) + '</b> · ' + esc(s.type) + '<br>' + esc(s.car) + '<br>Best <span class="mono purple">' + F.lap(d.best) + '</span> ' + F.pctOver(b) +
        (p ? '<br>Pace <span class="mono">' + F.lap(d.pace) + '</span> ' + F.pctOver(p) + ' · ' + R.category(p).name : '');
      if (b) { marks.push({ x: s.time, y: (b - 1) * 100, r: 4, color: COL.best, tip: t, c: s.car }); vals.push((b - 1) * 100); }
      if (p) { marks.push({ x: s.time, y: (p - 1) * 100, r: 4.5, color: COL.counted, tip: t, c: s.car }); pace.push([s.time, (p - 1) * 100]); vals.push((p - 1) * 100); }
    });
    $('tProgSub').textContent = withRef ? 'Each session: your best lap vs the alien hotlap (purple) and your pace vs the alien race pace (lime), in %. Lower is better.' :
      'This track is not in the reference sheet: your best lap vs the fastest lap of your class in each session.';
    var el = $('tChart');
    if (!marks.length) { el.innerHTML = '<div class="empty">No laps to compare in this period.</div>'; return; }
    vals.sort(function (a, b) { return a - b; });
    var t0 = g.sessions[0].time, t1 = g.sessions[g.sessions.length - 1].time, lo = Math.min(0, vals[0]), hi = Math.max(1, Math.min(vals[vals.length - 1], vals[Math.floor(vals.length * 0.95)] * 1.2));
    chart(el, { h: 250, x0: t0 - 1, x1: t1 + 1, y0: lo, y1: hi, fmtY: pctAxis, ticksX: monthTicks(t0, t1), lines: [{ pts: pace, color: COL.counted }], marks: marks, click: function (mk) { go(g.key, mk.c); } });
    el.insertAdjacentHTML('beforeend', '<div class="legend"><span><i style="background:var(--purple)"></i>Best lap</span>' + (withRef ? '<span><i style="background:var(--lime)"></i>Pace</span>' : '') + '<span class="faint">Click a session for its car</span></div>');
  }

  // the sheet's times for this track (the classes you drove), with the column your pace falls in marked
  function refTable(g) {
    var H_ = ['Hotlap', '100%', '101%', '102%', '103%', '104%', '105%', '106%', '107%'], h = '<thead><tr><th>Class</th>' + H_.map(function (x, i) { return '<th class="num"' + (i ? ' style="color:' + R.COLUMN_COLORS[i - 1] + '"' : '') + '>' + x + '</th>'; }).join('') + '</tr></thead><tbody>';
    var any = false;
    g.classes.forEach(function (c) {
      if (!c.ref) return; any = true;
      var pr = paceRatio(c), col = pr ? Math.max(0, Math.min(7, Math.round((pr - 1) * 100))) : -1;
      h += '<tr><td><b>' + esc(R.className(c.key)) + '</b><span class="two">' + esc(c.ref.car) + (c.ref.patch ? ' · times for game ' + c.ref.patch.toFixed(1) + '+' : '') + '</span></td><td class="num purple">' + F.lap(c.ref.hot) + '</td>' +
        c.ref.race.map(function (t, i) { var cc = R.COLUMN_COLORS[i]; return '<td class="num" style="' + (i === col ? 'background:' + cc + ';color:#111;font-weight:800' : 'color:' + cc) + '">' + F.lap(t) + '</td>'; }).join('') + '</tr>';
      h += '<tr><td class="faint">You</td><td class="num">' + F.lap(c.c.dry.best) + '</td><td colspan="8" class="muted">' + (pr ? paceLabel() + ' ' + F.lap(c.c.dry.pace) + ' = ' + F.pctOver(pr) + ' · ' + R.category(pr).name : 'not enough counted laps for a pace') + '</td></tr>';
    });
    h += '<tr><td colspan="10" class="faint">~100% Alien · 101% Competitive · 102-103% Good · 104-105% Midpack · 106% Tail-ender · 107% Offline (race pace, if consistent)</td></tr>';
    $('refTbl').innerHTML = any ? h + '</tbody>' : '<tbody><tr><td class="empty">This track is not in the reference sheet.</td></tr></tbody>';
  }

  function carsTable(g) {
    var h = '<thead><tr><th>Car</th><th>Class</th><th class="num">Sessions</th><th class="num">Laps</th><th class="num">Best lap</th><th class="num">Fastest lap %</th><th class="num">Optimal</th><th class="num">To gain</th>' +
      '<th class="num">' + paceLabel() + '</th><th class="num">Race pace %</th><th class="num">Consistency</th><th class="num">Wet best</th><th class="num">Wet pace</th><th class="num">Last driven</th></tr></thead><tbody>';
    g.cars.forEach(function (c) {
      var d = c.c.dry, w = c.c.wet, pr = paceRatio(c);
      h += '<tr class="click' + (c.key === route.c ? ' sel' : '') + '" data-c="' + esc(c.key) + '"><td><b>' + esc(c.key) + '</b>' + (c.old ? ' ' + oldChip(verOf(c.sessions)) : '') + '</td><td>' + esc(c.cls) + '</td><td class="num">' + c.sessions.length + '</td><td class="num">' + F.count(c.laps) +
        '</td><td class="num purple">' + F.lap(d.best) + '</td><td class="num">' + F.pctOver(hotRatio(c)) + '</td><td class="num green">' + F.lap(d.optimal) + '</td><td class="num muted">' + (d.best && d.optimal ? F.plusSec(d.best - d.optimal) : '--') +
        '</td><td class="num">' + F.lap(d.pace) + '<span class="two">' + (d.clean ? d.clean + ' laps' : '') + '</span></td><td class="num"><b>' + F.pctOver(pr) + '</b></td><td class="num muted">' + F.spread(d.sd) +
        '</td><td class="num blue">' + F.lap(w.best) + '</td><td class="num blue">' + F.lap(w.pace) + '</td><td class="num muted">' + F.day(c.last) + '</td></tr>';
    });
    $('cars').innerHTML = h + '</tbody>';
  }
  $('cars').onclick = function (e) { var r = e.target.closest('tr[data-c]'); if (r) { go(route.t, r.getAttribute('data-c')); } };

  // ---------- one car on a track ----------
  function detail(g, car) {
    var d = car.c.dry, w = car.c.wet, list = car.sessions.map(function (s) { return { s: s, a: M.session(s, slow) }; });
    if (selSession < 0 || selSession >= list.length) selSession = list.length - 1;
    $('dTitle').textContent = car.key; $('dClass').innerHTML = '<span class="chip lime">' + esc(car.cls) + '</span>';
    $('dSub').textContent = car.sessions.length + ' sessions on ' + g.name + ', last on ' + F.day(car.last) + '. ' + paceLabel() + ' from ' + typesText() + '.';
    var bestS = null; list.forEach(function (x) { if (x.a.dry.best && x.a.dry.best === d.best) bestS = x.s; });
    var lastRace = list.filter(function (x) { return x.s.type === 'Race' && x.s.classBest && x.a.dry.best; }).pop();
    $('dTiles').innerHTML = tile('Best lap', F.lap(d.best), (hotRatio(car) ? F.pctOver(hotRatio(car)) + ' vs alien hotlap · ' : '') + (bestS ? F.day(bestS.time) + ' · ' + bestS.type : ''), 'purple') +
      tile('Optimal lap', F.lap(d.optimal), d.sectors[0] ? 'S1 ' + F.sector(d.sectors[0]) + ' · S2 ' + F.sector(d.sectors[1]) + ' · S3 ' + F.sector(d.sectors[2]) : '', 'green') +
      tile('To gain', d.best && d.optimal ? F.plusSec(d.best - d.optimal) : '--', 'best lap minus optimal') +
      tile(paceLabel(), F.lap(d.pace), d.clean ? d.clean + ' counted laps' + (paceRatio(car) ? ' · ' + F.pctOver(paceRatio(car)) : '') : 'no counted laps') +
      tile('Consistency', F.spread(d.sd), 'spread of the counted laps') +
      tile('Wet', F.lap(w.best), w.pace ? 'pace ' + F.lap(w.pace) + ' · ' + w.clean + ' laps' : 'no wet laps', 'blue') +
      tile('Last race vs class best', lastRace ? F.pctOver(lastRace.a.dry.best / lastRace.s.classBest) : '--', lastRace ? 'class best ' + F.lap(lastRace.s.classBest) : 'no race yet');

    var el = $('dChart'), pts = list.map(function (x, i) { return { i: i, x: x }; }).filter(function (p) { return p.x.a.dry.best; });
    if (!pts.length) el.innerHTML = '<div class="empty">No dry laps.</div>';
    else {
      var vals = []; pts.forEach(function (p) { vals.push(p.x.a.dry.best); if (p.x.a.dry.pace) vals.push(p.x.a.dry.pace); });
      var rg = range(vals), marks = [], pace = [];
      pts.forEach(function (p) {
        var a = p.x.a.dry, s = p.x.s, t = '<b>' + F.day(s.time) + '</b> · ' + esc(s.type) + '<br>Best <span class="mono purple">' + F.lap(a.best) + '</span><br>Pace <span class="mono">' + F.lap(a.pace) + '</span> (' + a.clean + ' laps)';
        marks.push({ x: p.i, y: a.best, r: p.i === selSession ? 6 : 4.5, color: COL.best, tip: t, i: p.i });
        if (a.pace) { marks.push({ x: p.i, y: a.pace, r: p.i === selSession ? 6 : 4.5, color: COL.counted, tip: t, i: p.i }); pace.push([p.i, a.pace]); }
      });
      chart(el, { h: 240, x0: -0.5, x1: list.length - 0.5, y0: rg[0], y1: rg[1], fmtY: F.lap, lines: [{ pts: pace, color: COL.counted }], marks: marks, click: function (m) { selSession = m.i; detail(g, car); } });
      el.insertAdjacentHTML('beforeend', '<div class="legend"><span><i style="background:var(--purple)"></i>Best lap</span><span><i style="background:var(--lime)"></i>Pace (counted laps)</span><span class="faint">Click a session for its laps</span></div>');
    }
    sessTable(list, function (i) { selSession = i; detail(g, car); }); laps(list[selSession]);
  }

  function sessTable(list, pick) {
    var h = '<thead><tr><th>Date</th><th>Session</th><th>Game</th><th class="num">Laps</th><th class="num">Counted</th><th class="num">Best</th><th class="num">Optimal</th><th class="num">Pace</th><th class="num">Consistency</th>' +
      '<th class="num">Wet best</th><th class="num">Class pos</th><th class="num">Class best</th><th class="num">vs class best</th><th></th></tr></thead><tbody>';
    for (var i = list.length - 1; i >= 0; i--) {
      var s = list[i].s, a = list[i].a, d = a.dry, wet = a.wet.laps > 0;
      h += '<tr class="click' + (i === selSession ? ' sel' : '') + '" data-i="' + i + '"><td>' + F.day(s.time) + '</td><td>' + esc(s.type) + (s.setting && s.setting !== 'Multiplayer' ? ' <span class="faint">offline</span>' : '') + '</td><td>' + (s.old ? oldChip(s.version) : '<span class="muted">' + (s.version > 0 ? 'v' + s.version.toFixed(2) : '?') + '</span>') + '</td><td class="num">' + s.laps.length +
        '</td><td class="num">' + (d.clean + a.wet.clean) + '</td><td class="num purple">' + F.lap(d.best) + '</td><td class="num green">' + F.lap(d.optimal) + '</td><td class="num">' + F.lap(d.pace) +
        '</td><td class="num muted">' + F.spread(d.sd) + '</td><td class="num blue">' + F.lap(a.wet.best) + '</td><td class="num">' + (s.classPos ? 'P' + s.classPos + ' / ' + s.classCars : '--') +
        '</td><td class="num muted">' + F.lap(s.classBest) + '</td><td class="num">' + F.pctOver(d.best && s.classBest ? d.best / s.classBest : null) + '</td><td>' + (wet ? '<span class="chip wet">WET</span>' : '') + '</td></tr>';
    }
    $('sessTbl').innerHTML = h + '</tbody>';
    $('sessTbl').onclick = function (e) { var r = e.target.closest('tr[data-i]'); if (r) pick(Number(r.getAttribute('data-i'))); };
  }

  // the laps of one session as bars, coloured by whether they count (and why not)
  var WHY = { '': 'counted', slow: 'slower than the limit (incident, traffic, yellow)', pit: 'pit lap', out: 'out lap / start', invalid: 'no time' };
  function laps(x) {
    var el = $('lapChart');
    if (!x) { el.innerHTML = ''; return; }
    $('lapTitle').textContent = 'Laps of ' + F.day(x.s.time) + ' · ' + x.s.type;
    var ls = x.a.laps.filter(function (l) { return l.t; });
    if (!ls.length) { el.innerHTML = '<div class="empty">No timed laps.</div>'; return; }
    var counted = ls.filter(function (l) { return !l.why; }).map(function (l) { return l.t; }), med = M.median(counted.length ? counted : ls.map(function (l) { return l.t; }));
    var lo = Math.min.apply(null, ls.map(function (l) { return l.t; })), y0 = lo - Math.max(1, (med - lo) * 1.5), y1 = med * 1.08;
    chart(el, { h: 240, x0: ls[0].n - 0.5, x1: ls[ls.length - 1].n + 0.5, y0: y0, y1: y1, fmtY: F.lap,
      ticksX: ls.filter(function (l, i) { return i % Math.max(1, Math.ceil(ls.length / 12)) === 0; }).map(function (l) { return [l.n, 'L' + l.n]; }),
      marks: ls.map(function (l) {
        var c = l.why === '' ? (l.wet ? COL.wet : COL.counted) : (l.why === 'slow' ? COL.slow : (l.why === 'pit' || l.why === 'out' ? COL.pit : COL.dim));
        return { kind: 'bar', x: l.n, y: l.t, color: c, tip: '<b>Lap ' + l.n + '</b> <span class="mono">' + F.lap(l.t) + '</span>' + (l.t > y1 ? ' <span class="faint">(off the chart)</span>' : '') +
          '<br>S1 ' + F.sector(l.s[0]) + ' · S2 ' + F.sector(l.s[1]) + ' · S3 ' + F.sector(l.s[2]) + '<br>' + (l.wet ? 'wet tyres · ' : '') + WHY[l.why] + (l.pos ? '<br>P' + l.pos + ' overall' : '') };
      }) });
    el.insertAdjacentHTML('beforeend', '<div class="legend"><span><i style="background:var(--lime)"></i>Counted</span><span><i style="background:var(--blue)"></i>Counted (wet)</span><span><i style="background:#7E8084"></i>Pit / out lap</span><span><i style="background:var(--red)"></i>Too slow (left out)</span></div>');
  }

  load(); loadRef();
})(window);
