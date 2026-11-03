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

  P.potentialMath = { markOld: markOld, tracks: tracks, optimal: optimal, segments: segments };
  if (typeof module !== 'undefined') module.exports = P.potentialMath;
})(typeof window !== 'undefined' ? window : globalThis);
