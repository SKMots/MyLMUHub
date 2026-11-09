// Untapped potential: where you can gain the most. Pure maths on the Race Pace sessions (pace-math.js), the reference sheet (pace-ref.js) and your
// segment times (SegmentStore.cs). Numbers only; potential.js draws them.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, M = P.paceMath, R = P.paceRef;
  var DAY = 86400;

  // sessions on an older game version than the sheet's patch for that track + class (else the newest you drove) never count (as on the Race Pace page)
  function markOld(sessions, ref) {
    var cur = null; sessions.forEach(function (s) { var m = R.major(s.version); if (m && (!cur || m > cur)) cur = m; });
    sessions.forEach(function (s) { var rf = R.lookup(ref, s.track, s.layout, s['class']); s.old = R.isOld(s.version, rf && rf.patch, cur); });
  }

  // per track + class: your race pace (dry, all session types, counted laps) as % of the alien race pace, against YOUR LEVEL NOW = the median of that %
  // over the tracks you drove in the last `recent` days (else over all). Gain = how far this track is behind your level: per lap in % and seconds.
  // A track driven long ago is often far behind simply because you got faster since (stale = last driven before the recent window).
  function tracks(sessions, ref, now, slow, recent) {
    recent = recent > 0 ? recent : 30; var by = {}, list = [];
    sessions.forEach(function (s) {
      if (s.old) return;
      var rf = R.lookup(ref, s.track, s.layout, s['class']); if (!rf || !rf.race || !(rf.race[0] > 0)) return;
      var k = R.trackKey(s.track, s.layout) + '\u0001' + (R.className(s['class']) || s['class']);
      if (!by[k]) { by[k] = { key: k, track: R.trackName(s.track, s.layout) || s.track, layout: s.layout, course: s.track, cls: s['class'], ref: rf, sessions: [], last: 0 }; list.push(by[k]); }
      by[k].sessions.push(s); by[k].last = Math.max(by[k].last, s.time);
    });
    list.forEach(function (g) {
      var c = M.combine(g.sessions, slow, null).dry;
      g.pace = c.clean >= 5 ? c.pace : null; g.clean = c.clean; g.best = c.best;
      g.ratio = g.pace ? g.pace / g.ref.race[0] : null;
      g.hot = g.best && g.ref.hot ? g.best / g.ref.hot : null;
      var lastS = g.sessions.slice().sort(function (a, b) { return b.time - a.time; }), rc = M.combine(lastS.slice(0, 3), slow, null).dry;
      g.recentRatio = rc.clean >= 5 ? rc.pace / g.ref.race[0] : null;                  // your last 3 sessions there
      g.days = Math.floor((now - g.last) / DAY);
    });
    var withPace = list.filter(function (g) { return g.ratio; });
    // your level per class (a GT3 level says nothing about LMP2): the median over that class's tracks of the last `recent` days (at least 2), else all of the class
    function levelOf(set) { var fresh = set.filter(function (g) { return now - g.last <= recent * DAY; }); return { v: M.median((fresh.length >= 2 ? fresh : set).map(function (g) { return g.ratio; })), from: fresh.length >= 2 ? 'recent' : 'all' }; }
    var levels = {}, laps = {};
    withPace.forEach(function (g) { var c = R.className(g.cls) || g.cls; (levels[c] = levels[c] || []).push(g); laps[c] = (laps[c] || 0) + g.clean; });
    Object.keys(levels).forEach(function (c) { var n = levels[c].length; levels[c] = levelOf(levels[c]); levels[c].tracks = n; });
    withPace.forEach(function (g) {
      var lv = levels[R.className(g.cls) || g.cls]; g.level = lv.v; g.alone = lv.tracks < 2;                  // the only track of its class: nothing to compare with
      g.gain = lv.v && !g.alone ? g.ratio - lv.v : null; g.gainSec = g.gain !== null ? g.gain * g.ref.race[0] : null;
      g.stale = now - g.last > recent * DAY;
    });
    var main = Object.keys(laps).sort(function (a, b) { return laps[b] - laps[a]; })[0], ml = main ? levels[main] : { v: null, from: 'all' };   // the class you drive most: the headline
    return { level: ml.v, levelFrom: ml.from, levelClass: main || '', levels: levels, recentDays: recent,
             list: withPace.sort(function (a, b) { return (b.gainSec || -1e9) - (a.gainSec || -1e9); }) };
  }

  // per track + car: the time left on the table in ONE lap = your best lap minus your optimal lap (your best three sectors added up), and how far your
  // race pace is from your best lap (consistency). Dry laps, current game version.
  function optimal(sessions, slow) {
    return M.groups(sessions.filter(function (s) { return !s.old; })).map(function (g) {
      var c = M.combine(g.sessions, slow, null).dry;
      return { key: g.key, track: g.track, layout: g.sessions[0].layout, car: g.car, cls: g.cls, last: g.last, best: c.best, optimal: c.optimal, sectors: c.sectors,
               gap: c.best && c.optimal ? c.best - c.optimal : null, pace: c.clean >= 5 ? c.pace : null, spread: c.clean >= 5 && c.best ? c.pace - c.best : null };
    }).filter(function (o) { return o.gap !== null; }).sort(function (a, b) { return b.gap - a.gap; });
  }

  // one track + car's segments (SegmentStore record): theoretical best (your best ever in every segment added up), your best lap, and per segment what
  // your best lap lost there (its segment minus your best there) and what you TYPICALLY lose there (median of your last 20 laps minus your best).
  function segments(rec) {
    if (!rec || !rec.n || !rec.best || rec.best.length !== rec.n) return null;
    var laps = (rec.laps || []).slice(-20), seg = [], step = rec.length / rec.n;
    var theo = rec.best.every(function (b) { return b > 0; }) ? rec.best.reduce(function (a, b) { return a + b; }, 0) : null;
    for (var i = 0; i < rec.n; i++) {
      var med = M.median(laps.map(function (l) { return l.segs[i]; }).filter(function (v) { return v > 0; }));
      seg.push({ i: i, from: i * step, to: (i + 1) * step, best: rec.best[i], bestAt: rec.bestAt ? rec.bestAt[i] : 0,
                 lap: rec.bestLapSegs && rec.bestLapSegs[i] > 0 ? rec.bestLapSegs[i] : null,
                 lost: rec.bestLapSegs && rec.bestLapSegs[i] > 0 ? rec.bestLapSegs[i] - rec.best[i] : null,
                 typical: med !== null ? med - rec.best[i] : null, pts: rec.points ? rec.points[i] : null });
    }
    var typicalLap = M.median((rec.laps || []).slice(-20).map(function (l) { return l.time; }));
    return { theoretical: theo, bestLap: rec.bestLap > 0 ? rec.bestLap : null, gap: theo && rec.bestLap > 0 ? rec.bestLap - theo : null,
             typicalLap: typicalLap, typicalGap: theo && typicalLap ? typicalLap - theo : null, laps: (rec.laps || []).length, segs: seg,
             worst: seg.filter(function (s) { return s.lost > 0; }).sort(function (a, b) { return b.lost - a.lost; }).slice(0, 6),
             worstTypical: seg.filter(function (s) { return s.typical > 0; }).sort(function (a, b) { return b.typical - a.typical; }).slice(0, 6) };
  }

  // ---------- focus (the Improve page's ranking and "next session focus") ----------
  // per track + car, from the result files (dry laps, current game version): per sector your best ever, your typical time now (median of the counted laps
  // of your last `recent` sessions there with 3+ counted laps, default 5; fewer than 5 such laps: all your counted laps), what you lose there (typical - best)
  // and how much it varies (spreadOf); per one of those sessions which sector cost the most, and so how often each sector was the weakest.
  // potential = race pace - optimal lap; with the level gap from tracks() (if behind) added: score = what there is to find per lap. Sorted by score as a
  // share of the lap (rel), so a long track does not always come first.
  function focus(sessions, ref, now, slow, recent) {
    var lv = tracks(sessions, ref, now, slow, 30), byTrack = {};
    lv.list.forEach(function (g) { byTrack[R.trackKey(g.course, g.layout) + '\u0001' + (R.className(g.cls) || g.cls)] = g; });
    var n = recent > 0 ? recent : 5;
    return M.groups(sessions.filter(function (s) { return !s.old; })).map(function (g) {
      var c = M.combine(g.sessions, slow, null).dry; if (!c.optimal || c.clean < 5) return null;
      var clean = [], per = [];
      g.sessions.slice().sort(function (a, b) { return b.time - a.time; }).forEach(function (s) {
        var l = M.session(s, slow).laps.filter(function (x) { return !x.why && !x.wet && x.s[0] > 0 && x.s[1] > 0 && x.s[2] > 0; });
        clean = clean.concat(l); if (l.length >= 3 && per.length < n) per.push(l);
      });
      if (clean.length < 5) return null;
      var weak = [0, 0, 0];
      per.forEach(function (l) {
        var loss = [0, 1, 2].map(function (i) { return M.median(l.map(function (x) { return x.s[i]; })) - c.sectors[i]; });
        weak[loss.indexOf(Math.max.apply(null, loss))]++;
      });
      var lately = [].concat.apply([], per), use = lately.length >= 5 ? lately : clean;
      var sec = [0, 1, 2].map(function (i) {
        var v = use.map(function (x) { return x.s[i]; }), typ = M.median(v);
        return { i: i, best: c.sectors[i], typical: typ, loss: typ - c.sectors[i], sd: spreadOf(v, typ), weakest: weak[i] };
      });
      var top = sec.slice().sort(function (a, b) { return b.loss - a.loss; })[0], first = g.sessions[0];
      var t = byTrack[R.trackKey(first.track, first.layout) + '\u0001' + (R.className(g.cls) || g.cls)];
      var behind = t && t.gainSec > 0 ? t.gainSec : 0, potential = c.pace - c.optimal;
      return { key: g.key, track: g.track, layout: first.layout, car: g.car, cls: g.cls, last: g.last, best: c.best, optimal: c.optimal, pace: c.pace, clean: clean.length,
               spread: c.pace - c.best, potential: potential, behind: behind, stale: !!(t && t.stale && behind > 0), days: Math.floor((now - g.last) / DAY),
               score: potential + behind, rel: (potential + behind) / c.optimal, sectors: sec, top: top.i, sessions: per.length };
    }).filter(Boolean).sort(function (a, b) { return b.rel - a.rel; });
  }

  // how much a sector varies from lap to lap: the median distance from the typical time, scaled to match a standard deviation (one odd lap does not blow it up)
  function spreadOf(v, typ) { var d = M.median(v.map(function (x) { return Math.abs(x - typ); })); return d === null ? null : d * 1.4826; }

  // one entry per track (layout) + class: the car with your fastest best lap there (another car on the same track says little more); keeps the order
  function fastestCar(list) {
    var pick = {};
    list.forEach(function (f) { var k = R.trackKey(f.track, f.layout) + '\u0001' + (R.className(f.cls) || f.cls); if (!pick[k] || f.best < pick[k].best) pick[k] = f; });
    return list.filter(function (f) { return pick[R.trackKey(f.track, f.layout) + '\u0001' + (R.className(f.cls) || f.cls)] === f; });
  }

  // a segment record's sessions: the stored summaries (SegmentStore), else (older files) made from the last laps (a new session after an hour, laps within 5 %)
  function segSessions(rec) {
    if (rec.sessions && rec.sessions.length) return rec.sessions.filter(function (s) { return s.sum && s.sum.length === rec.n; });
    var out = [], cur = null;
    (rec.laps || []).forEach(function (l) {
      if (!l.segs || l.segs.length !== rec.n) return;
      if (!cur || l.t - cur.end > 3600) {
        cur = { start: l.t, end: l.t, laps: 0, sum: [], sq: [], best: [] };
        for (var j = 0; j < rec.n; j++) { cur.sum.push(0); cur.sq.push(0); cur.best.push(-1); }
        out.push(cur);
      }
      cur.end = l.t; if (!(rec.bestLap > 0) || l.time > rec.bestLap * 1.05) return;
      cur.laps++; l.segs.forEach(function (v, i) { cur.sum[i] += v; cur.sq[i] += v * v; if (cur.best[i] < 0 || v < cur.best[i]) cur.best[i] = v; });
    });
    return out;
  }
  // the k windows of w segments (round the lap) with the most loss, not overlapping: [{ i0, loss }]
  function windows(loss, w, k) {
    var n = loss.length, sums = [], used = [], out = [];
    for (var i = 0; i < n; i++) { var t = 0; for (var j = 0; j < w; j++) t += Math.max(0, loss[(i + j) % n] || 0); sums.push({ i0: i, loss: t }); }
    sums.sort(function (a, b) { return b.loss - a.loss || a.i0 - b.i0; });
    for (var q = 0; q < sums.length && out.length < k; q++) {
      var z = sums[q], free = true; if (!(z.loss > 0)) break;
      for (var m = 0; m < w; m++) if (used[(z.i0 + m) % n]) free = false;
      if (!free) continue;
      for (m = 0; m < w; m++) used[(z.i0 + m) % n] = true;
      out.push(z);
    }
    return out;
  }
  // which sector (0-2) a distance is in, from the sector lines (-1 = not known)
  function sectorAt(d, lines) { if (!lines || !(lines[0] > 0) || !(lines[1] > lines[0])) return -1; return d < lines[0] ? 0 : d < lines[1] ? 1 : 2; }

  // zones = your weak spots on the track: windows of 3 segments (~450 m) where your typical lap of the last `recent` sessions (default 5, 3+ laps each)
  // loses the most against your best ever there. seen = in how many of those sessions the zone overlapped one of that session's 3 biggest losses.
  // Per segment also its typical loss and how much it varies (sd over those sessions' laps).
  function zones(rec, recent) {
    if (!rec || !rec.n || !rec.best || rec.best.length !== rec.n || !rec.best.every(function (b) { return b > 0; })) return null;
    var ses = segSessions(rec).filter(function (s) { return s.laps >= 3; }).slice(-(recent > 0 ? recent : 5));
    if (!ses.length) return null;
    var n = rec.n, step = rec.length / n, W = 3, laps = 0, sum = [], sq = [], i;
    for (i = 0; i < n; i++) { sum.push(0); sq.push(0); }
    ses.forEach(function (s) { laps += s.laps; for (var i = 0; i < n; i++) { sum[i] += s.sum[i]; sq[i] += s.sq[i]; } });
    var segs = [];
    for (i = 0; i < n; i++) {
      var mean = sum[i] / laps, v = laps > 1 ? (sq[i] - laps * mean * mean) / (laps - 1) : 0;
      segs.push({ i: i, from: i * step, to: (i + 1) * step, best: rec.best[i], typical: mean, loss: mean - rec.best[i], sd: Math.sqrt(Math.max(0, v)), pts: rec.points ? rec.points[i] : null });
    }
    var each = ses.map(function (s) { return windows(s.sum.map(function (t, i) { return t / s.laps - rec.best[i]; }), W, 3); });
    var z = windows(segs.map(function (s) { return s.loss; }), W, 3).filter(function (w) { return w.loss >= 0.03; }).map(function (w, k) {
      var seen = each.filter(function (list) { return list.some(function (o) { var d = (o.i0 - w.i0 + n) % n; return d < W || n - d < W; }); }).length;
      var from = w.i0 * step, to = from + W * step, mid = ((w.i0 + 1.5) * step) % rec.length;
      return { n: k + 1, i0: w.i0, len: W, from: from, to: to > rec.length ? to - rec.length : to, loss: w.loss, sector: sectorAt(mid, rec.sectors), seen: seen, of: ses.length,
               pts: rec.points ? rec.points[(w.i0 + 1) % n] : null };
    });
    var lost = segs.reduce(function (a, s) { return a + Math.max(0, s.loss); }, 0);
    return { segs: segs, zones: z, sessions: ses.length, laps: laps, lost: lost, inZones: z.reduce(function (a, w) { return a + w.loss; }, 0), sectors: rec.sectors || [-1, -1] };
  }

  // repeat weaknesses over all tracks + cars: a sector that was the weakest in at least `min` (default 3) of the recent sessions there
  function repeats(list, min) {
    var out = [];
    list.forEach(function (f) { f.sectors.forEach(function (s) { if (s.weakest >= (min > 0 ? min : 3)) out.push({ f: f, sector: s, seen: s.weakest, of: f.sessions }); }); });
    return out.sort(function (a, b) { return b.seen / b.of - a.seen / a.of || b.sector.loss - a.sector.loss; });
  }

  // ---------- driving lines (api/segments?line=: per reading [metres into the lap, x, z, km/h, throttle %, brake %] one after another, -1 = not known) ----------
  var LS = 6;
  // a line in one stretch of the lap (from, len metres; it may run over the line), braking looked for up to `pre` m (default 150) before it.
  // -> { entry, min, exit (km/h), minAt (m into the lap), brakeAt (m: where the braking for the slowest point starts), brakeMax (%),
  //      throttleAt (m: full throttle again after the slowest point) }, a field null = not in the data / did not happen; null = no line here
  function lineSpot(line, from, len, L, pre) {
    if (!line || !(L > 0) || !(len > 0)) return null;
    pre = pre >= 0 ? pre : 150;
    var start = from - pre, pts = [], i, j;
    for (i = 0; i + LS <= line.length; i += LS) {
      var r = ((line[i] - start) % L + L) % L;
      if (r <= len + pre) pts.push({ r: r, d: line[i], v: line[i + 3], t: line[i + 4], b: line[i + 5] });
    }
    pts.sort(function (a, b) { return a.r - b.r; });
    var inside = pts.filter(function (p) { return p.r >= pre; });
    if (inside.length < 3) return null;
    var o = { entry: null, min: null, minAt: null, exit: null, brakeAt: null, brakeMax: null, throttleAt: null }, k = -1;
    pts.forEach(function (p, n) {
      if (p.r < pre || !(p.v >= 0)) return;
      if (o.entry === null) o.entry = p.v;
      if (o.min === null || p.v < o.min) { o.min = p.v; o.minAt = p.d; k = n; }
      o.exit = p.v;
    });
    if (k >= 0) {
      for (j = k; j >= 0 && !(pts[j].b >= 10); j--) {}                                      // the last braking before the slowest point ...
      if (j >= 0) {
        var mx = 0; for (; j >= 0 && pts[j].b >= 10; j--) mx = Math.max(mx, pts[j].b);      // ... back to where it started
        o.brakeAt = pts[j + 1].d; o.brakeMax = mx;
      }
      for (j = k; j < pts.length; j++) if (pts[j].t >= 95) { o.throttleAt = pts[j].d; break; }
    }
    return o;
  }
  // the median of each field over several laps' lineSpot (nulls left out); n = how many laps had this stretch
  function lineMedian(list) {
    list = (list || []).filter(Boolean); if (!list.length) return null;
    var o = { n: list.length };
    ['entry', 'min', 'minAt', 'exit', 'brakeAt', 'brakeMax', 'throttleAt'].forEach(function (f) {
      var v = list.map(function (x) { return x[f]; }).filter(function (x) { return x !== null && x !== undefined; }).sort(function (a, b) { return a - b; });
      o[f] = !v.length ? null : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    });
    return o;
  }
  // optimal.json -> one line (the pieces of your best segments in order; a missing piece leaves a gap) and how many pieces are known
  function optimalLine(opt) {
    var out = [], have = 0, last = -1;
    ((opt && opt.pieces) || []).forEach(function (p) {
      if (!p || !p.line || p.line.length < LS) return; have++;
      for (var i = 0; i + LS <= p.line.length; i += LS) { if (p.line[i] <= last) continue; last = p.line[i]; for (var k = 0; k < LS; k++) out.push(p.line[i + k]); }
    });
    return { line: out, have: have, n: opt && opt.n ? opt.n : 0 };
  }

  P.potentialMath = { markOld: markOld, tracks: tracks, optimal: optimal, segments: segments, focus: focus, zones: zones, segSessions: segSessions, windows: windows, sectorAt: sectorAt, repeats: repeats, fastestCar: fastestCar,
                      lineSpot: lineSpot, lineMedian: lineMedian, optimalLine: optimalLine };
  if (typeof module !== 'undefined') module.exports = P.potentialMath;
})(typeof window !== 'undefined' ? window : globalThis);
