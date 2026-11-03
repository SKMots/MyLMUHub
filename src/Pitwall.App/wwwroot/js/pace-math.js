// Race Pace maths: which laps count, best / optimal / average pace, dry and wet. Pure functions (unit-tested in tests/js/pace-math.test.js).
// A session from /api/pace: { time, type, track, car, class, classBest, classPos, classCars, laps: [[n, t, s1, s2, s3, flags, pos], ...] } (flags 1 = pit, 2 = wet)
// Rules (why a lap does not count for the pace):
//   invalid = no time; pit = in the pits during the lap; out = the first lap of a stint (race start, after a pit stop, after a driver change, out of the garage);
//   slow = more than `slow` (fraction, default 5 %) slower than the median of the counted laps of that session in the same conditions (an incident, traffic, yellow flags).
// Best lap / optimal lap use every lap except invalid, pit and out laps. Optimal = the best sector 1 + best sector 2 + best sector 3.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {};

  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function mean(a) { if (!a.length) return null; var t = 0; a.forEach(function (v) { t += v; }); return t / a.length; }
  function sd(a) { if (a.length < 2) return null; var m = mean(a), t = 0; a.forEach(function (v) { t += (v - m) * (v - m); }); return Math.sqrt(t / (a.length - 1)); }
  function min(a) { return a.length ? Math.min.apply(null, a) : null; }

  // every lap of a session with the reason it does not count ('' = it counts)
  function classify(session, slow) {
    slow = slow > 0 ? slow : 0.05;
    var nums = {}, raw = session.laps || [];
    raw.forEach(function (l) { nums[l[0]] = l; });
    var laps = raw.map(function (l) {
      var n = l[0], prev = nums[n - 1], why = '';
      if (!(l[1] > 0)) why = 'invalid';
      else if (l[5] & 1) why = 'pit';
      else if (!prev || (prev[5] & 1)) why = 'out';
      return { n: n, t: l[1] > 0 ? l[1] : null, s: [l[2], l[3], l[4]], pit: !!(l[5] & 1), wet: !!(l[5] & 2), pos: l[6], why: why };
    });
    [false, true].forEach(function (wet) {
      var group = laps.filter(function (l) { return !l.why && l.wet === wet; }), m = median(group.map(function (l) { return l.t; }));
      group.forEach(function (l) { if (l.t > m * (1 + slow)) l.why = 'slow'; });
    });
    return laps;
  }

  // numbers of a set of laps: best, optimal (+ its sectors), pace (average of the counted laps), median, consistency (standard deviation), counts
  function stats(laps) {
    var timed = laps.filter(function (l) { return l.t && l.why !== 'pit' && l.why !== 'out' && l.why !== 'invalid'; }), clean = laps.filter(function (l) { return !l.why; });
    var best = [null, null, null];
    timed.forEach(function (l) { for (var i = 0; i < 3; i++) if (l.s[i] > 0 && (best[i] === null || l.s[i] < best[i])) best[i] = l.s[i]; });
    var t = clean.map(function (l) { return l.t; });
    return { best: min(timed.map(function (l) { return l.t; })), optimal: best[0] && best[1] && best[2] ? best[0] + best[1] + best[2] : null, sectors: best,
             pace: mean(t), median: median(t), sd: sd(t), clean: clean.length, laps: laps.length };
  }

  // one session: { dry, wet } stats + the laps (with reasons)
  function session(s, slow) {
    var laps = classify(s, slow);
    return { laps: laps, dry: stats(laps.filter(function (l) { return !l.wet; })), wet: stats(laps.filter(function (l) { return l.wet; })) };
  }

  // several sessions (a track + car): the same numbers over all of them. types = which session types count for the PACE (e.g. ['Race']); best / optimal use all.
  function combine(sessions, slow, types) {
    var all = { dry: [], wet: [] }, pace = { dry: [], wet: [] };
    sessions.forEach(function (s) {
      var a = session(s, slow), forPace = !types || types.indexOf(s.type) >= 0;
      a.laps.forEach(function (l) { var k = l.wet ? 'wet' : 'dry'; all[k].push(l); if (forPace) pace[k].push(l); });
    });
    function one(k) { var b = stats(all[k]), p = stats(pace[k]); return { best: b.best, optimal: b.optimal, sectors: b.sectors, pace: p.pace, median: p.median, sd: p.sd, clean: p.clean, laps: b.laps }; }
    return { dry: one('dry'), wet: one('wet') };
  }

  // group sessions into the pace sheet rows: one per track + car, newest first
  function groups(sessions) {
    var by = {}, list = [];
    sessions.forEach(function (s) {
      var k = s.track + '\u0001' + s.car;
      if (!by[k]) { by[k] = { key: k, track: s.track, car: s.car, cls: s['class'], sessions: [], last: 0 }; list.push(by[k]); }
      by[k].sessions.push(s); by[k].last = Math.max(by[k].last, s.time);
    });
    return list.sort(function (a, b) { return b.last - a.last; });
  }

  // the last `days` days (default 7) per track + class (keyFn(session) -> key): what you drove, and how this week compares with everything BEFORE it.
  // Pace (dry, the given session types, at least 3 counted laps on both sides) and best lap (dry, all sessions). Differences = this week minus before
  // (negative = faster). Sorted by laps this week, most first.
  function weekly(sessions, now, keyFn, slow, types, days) {
    var from = now - (days > 0 ? days : 7) * 86400, by = {}, list = [];
    sessions.forEach(function (s) {
      var k = keyFn(s); if (!k) return;
      if (!by[k]) { by[k] = { key: k, recent: [], before: [] }; list.push(by[k]); }
      (s.time >= from ? by[k].recent : by[k].before).push(s);
    });
    return list.filter(function (g) { return g.recent.length; }).map(function (g) {
      var now = combine(g.recent, slow, types).dry, was = g.before.length ? combine(g.before, slow, types).dry : null, laps = 0, secs = 0;
      g.recent.forEach(function (s) { (s.laps || []).forEach(function (l) { laps++; if (l[1] > 0) secs += l[1]; }); });
      var pd = was && now.pace && was.pace && now.clean >= 3 && was.clean >= 3 ? now.pace - was.pace : null, bd = was && now.best && was.best ? now.best - was.best : null;
      return { key: g.key, sample: g.recent[0], sessions: g.recent.length, laps: laps, secs: secs, pace: now.pace, clean: now.clean, best: now.best,
               pacePrev: was ? was.pace : null, bestPrev: was ? was.best : null, paceDiff: pd, bestDiff: bd, paceRel: pd !== null ? pd / was.pace : null };
    }).sort(function (a, b) { return b.laps - a.laps; });
  }

  P.paceMath = { median: median, mean: mean, sd: sd, classify: classify, stats: stats, session: session, combine: combine, groups: groups, weekly: weekly };
  if (typeof module !== 'undefined') module.exports = P.paceMath;
})(typeof window !== 'undefined' ? window : globalThis);
