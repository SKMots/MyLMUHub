// Race alerts (owner 2026-11-13): while you drive (or watch your team-mate), what the strategy says NOW, short enough to read on a straight.
// Pure functions (tests/js/alerts-math.test.js); the alert widget (widgets/alert.js) feeds them the live data and shows / speaks the result.
//   restOptions: the rest of the race from now for stint lengths around the one you follow (build(plan, live) per length)
//   decide:      'box this lap', a better stint length (push / lift), or the measuring of what lifting costs (practice), with the rules that keep it quiet
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  function SM() { return P.strategyMath; }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  // the plan as it stands live: the drivers' pace from this race (livePace), the stint length you accepted (accepted laps), your VE use now in
  // 'VE per lap' plans. o = { pace: 'live' | 'plan', accepted: laps }
  function livePlan(plan, raceLive, o) {
    o = o || {}; var q = copy(plan), pace = SM().livePace(raceLive);
    if (o.pace !== 'plan') q.drivers.forEach(function (d) { if (pace[d.name] > 0) d.lap = pace[d.name]; });
    var use = raceLive && raceLive.car ? raceLive.car.veUse : -1;
    if (q.ve && q.ve.mode !== 'laps' && use > 0) q.ve.perLap = use;
    if (o.accepted > 0) { q.ve = { mode: 'laps', laps: Math.round(o.accepted), max: num(q.ve && q.ve.max, 100), reserve: num(q.ve && q.ve.reserve, 0), perLap: q.ve && q.ve.perLap, push: q.ve && q.ve.push }; q.stints = []; }
    return q;
  }

  // the rest of the race for stint lengths around the current one (from now: stints done stay as they were). natural = your VE per lap without lifting,
  // cost = s per lap for 1 % less VE per lap (null = not known). Per length: VE per lap allowed, the saving against natural, stops, laps, finish.
  // best: cost known = the most laps, then the earliest finish (the drivers' laps slowed by the saving); not known = the best without extra lifting
  // (as strategy-math stintOptions). -> { now (the current length), options: [{ laps, perLap, save, stops, raceLaps, end }], best } or null
  function restOptions(q, live, o) {
    var S = SM(), cur = S.stintLaps(q.ve); if (!isFinite(cur)) return null;
    var natural = num(o && o.natural, 0), cost = o && o.cost !== null && o.cost !== undefined && o.cost !== '' ? num(o.cost, null) : null, out = [];
    for (var L = Math.max(2, cur - 3); L <= cur + 3; L++) {
      var t = copy(q); t.ve = { mode: 'laps', laps: L, max: num(q.ve.max, 100), reserve: num(q.ve.reserve, 0) }; t.stints = [];
      var per = S.veNeeded(t.ve, L), save = natural > 0 ? Math.max(0, natural - per) : 0;
      if (cost !== null && save > 0) t.drivers.forEach(function (d) { d.lap = num(d.lap, 0) + save * cost; });
      var r = S.build(t, live); if (!r.stints.length) continue;
      out.push({ laps: L, perLap: per, save: save, stops: r.stops, raceLaps: r.laps, end: r.end });
    }
    if (!out.length) return null;
    var rank = function (a, b) { return b.raceLaps - a.raceLaps || (cost !== null ? a.end - b.end : a.stops - b.stops) || a.save - b.save; };
    var minSave = Math.min.apply(null, out.map(function (x) { return x.save; }));
    var best = (cost !== null ? out.slice() : out.filter(function (x) { return x.save <= minSave + 0.05; })).sort(rank)[0];
    return { now: out.filter(function (x) { return x.laps === cur; })[0] || null, options: out, best: best };
  }

  // what to show now. s = { plan (live plan, livePlan), live (strategy-math fromLive), raceLive, natural, cost, lastChangeLap (the car's lap count when the
  // last strategy alert came), dismissed: { 'laps:24': true } (ignored suggestions), measure: { track, from (the car's laps at the start) } }
  // -> { box: { lap, fill, push, next, laps } | null, change: { to, from, kind: 'push' | 'lift', perLapTo, perLapFrom, stopsTo, stopsFrom, why } | null,
  //      measure: { phase: 'normal' | 'lift' | 'done', lap, of } | null, target: VE per lap allowed now in this stint | null }
  // Rules (driving: read on a straight, never nagging): box this lap = the last lap before the planned stop (not the finish); a strategy change only from the
  // 3rd lap of a stint, at most once every 3 laps, only when the best length differs from the one you follow, and not again after you ignored it.
  function decide(s) {
    var out = { box: null, change: null, measure: null, target: null }, L = s.live || {}, S = SM();
    if (s.measure && L.status === 'waiting' && s.raceLive && s.raceLive.car) {                    // practice: measure what lifting costs
      var done = Math.max(0, num(s.raceLive.car.laps, 0) - num(s.measure.from, 0));
      out.measure = done < 3 ? { phase: 'normal', lap: done + 1, of: 3 } : done < 6 ? { phase: 'lift', lap: done - 2, of: 3 } : { phase: 'done', lap: 6, of: 6 };
    }
    if (L.status !== 'live' || !s.plan || !L.current) return out;
    var q = s.plan, r = S.build(q, L), now = r.stints.filter(function (x) { return x.state === 'now'; })[0], cur = L.current;
    var t = S.liveTarget(q, L, now ? now.lap : 0); if (t && t.target > 0) out.target = t.target;
    if (t && !t.finish && t.left === 1) {
      var next = r.stints.filter(function (x) { return x.state === 'plan'; })[0];
      out.box = { lap: t.pitLap, next: next ? next.driver : '', laps: next ? next.laps : 0, fill: next && next.fill ? (next.fill.mode === 'push' ? next.fill.push : next.fill.save) : num(q.ve.max, 100) };
    }
    if (cur.laps < 2 || !t || t.finish) return out;
    var lapNow = num(s.raceLive && s.raceLive.car && s.raceLive.car.laps, 0);
    if (s.lastChangeLap !== null && s.lastChangeLap !== undefined && lapNow - s.lastChangeLap < 3) return out;
    var ro = restOptions(q, L, { natural: s.natural, cost: s.cost });
    if (!ro || !ro.now || !ro.best || ro.best.laps === ro.now.laps) return out;
    if (s.dismissed && s.dismissed['laps:' + ro.best.laps]) return out;
    var b = ro.best, n = ro.now, push = b.perLap > n.perLap;
    out.change = { to: b.laps, from: n.laps, kind: push ? 'push' : 'lift', perLapTo: b.perLap, perLapFrom: n.perLap, stopsTo: b.stops, stopsFrom: n.stops,
      why: push ? (b.stops === n.stops ? 'same ' + b.stops + ' stops: lifting no longer gains anything' : 'the rest of the race is better without the lifting')
                : (b.stops < n.stops ? 'saves ' + (n.stops - b.stops) + (n.stops - b.stops === 1 ? ' stop' : ' stops') : b.raceLaps > n.raceLaps ? 'gains ' + (b.raceLaps - n.raceLaps) + (b.raceLaps - n.raceLaps === 1 ? ' lap' : ' laps') : 'better finish') };
    return out;
  }

  P.alertsMath = { livePlan: livePlan, restOptions: restOptions, decide: decide };
  if (typeof module !== 'undefined') module.exports = P.alertsMath;
})(typeof window !== 'undefined' ? window : globalThis);
