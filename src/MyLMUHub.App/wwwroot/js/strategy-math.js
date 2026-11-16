// Strategy planner maths. Pure functions (tests/js/strategy-math.test.js); the page (strategy.js) only draws.
// Everything is in RACE TIME (seconds since the green flag), never clock time: real clock = the actual green flag + race time.
// A plan:
//   length: { kind: 'time' | 'laps', time: s, laps: n }      a timed race ends when your car crosses the line after the clock ran out
//   ve:     { mode: 'laps' (aim for `laps` per stint: gives the VE per lap that needs) | 'perLap' (your VE use per lap: gives the laps), laps, perLap: %,
//             max: % a stint starts with, reserve: laps kept spare }
//   pit:    { base: s lost by a stop (pit lane + refill), tyres: s extra for a tyre change, swap: s extra for a driver swap }
//   tyres:  { mode: 'stints' (new set every `every` stints, 0 = never) | 'wear' (new set when the next stint would end below `minLeft` %), wearPerLap: %, sets: 0 = no limit }
//   drivers: [{ name (full name as in the game), lap: s, maxStints: in a row (0 = no limit), maxTime: s in total (0 = none), minTime: s in total (0 = none) }]
//   stints: your changes per stint, by position (index 0 = stint 1): { driver: name, laps: n, tyres: 'new' | 'used' } (missing / '' / 0 = automatic)
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  var MAX_STINTS = 400, BEFORE = 'Before the app was watching';

  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  // the same driver? The game's name vs the name typed in a plan: case, extra spaces, a '#1234' tag and the order of the words do not matter
  // (owner 2026-11-14: the plan had 'Sam Partner', the game said 'Partner Sam', and the Live tab gave him every stint as an unknown 3rd driver)
  function nameKey(n) { return String(n || '').toLowerCase().replace(/#\d+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' '); }
  function sameDriver(a, b) { var x = nameKey(a); return x.length > 0 && x === nameKey(b); }
  function paceOf(pace, name) { if (!pace) return undefined; if (pace[name] > 0) return pace[name]; for (var k in pace) if (sameDriver(k, name)) return pace[k]; return undefined; }
  // laps one stint does by default: the laps you aim for, or what fits in the start VE less the reserve; at least 1; no VE info = no limit
  function stintLaps(ve) {
    ve = ve || {};
    if (ve.mode === 'laps') return num(ve.laps, 0) > 0 ? Math.round(ve.laps) : Infinity;
    var per = num(ve.perLap, 0); return per > 0 ? Math.max(1, Math.floor(num(ve.max, 100) / per + 1e-9) - num(ve.reserve, 0)) : Infinity;
  }
  // the VE per lap (%) a stint of `laps` laps may use: the start VE spread over the laps + the reserve
  function veNeeded(ve, laps) { return laps > 0 ? num(ve && ve.max, 100) / (laps + num(ve && ve.reserve, 0)) : null; }

  // the plan -> { stints: [...], stops, laps, end (race time at the finish), drivers: { name: { time, stints, laps } }, warnings: [] }
  // stint = { n, driver, lap (s), laps, fromLap, toLap, start, end, veNeed (% per lap allowed), veUsed, veLeft (null = VE use unknown), set, newSet, wearEnd,
  //           fill (only a stint that needs less than a full refill): { mode: 'save' | 'push', save / push (fill to, %), max, rate (the race's VE per lap),
  //           pushPerLap (VE per lap with the push fill), room (pushPerLap / rate - 1) },
  //           changed: { driver, laps, tyres } (your changes), stop: null | { loss, tyres, swap, next } (the stop after it) }
  // live (optional, the race so far from the live data): { time: race time now, stints: [{ driver, laps, newSet, start, end }] (finished stints, as driven),
  //   current: { driver, laps (done in this stint), newSet, start, ve (VE % now, optional) } }. Finished stints keep what really happened (a stop that came early
  //   for damage, a long repair: the real stop time = the next stint's start - this stint's end); the current stint ends when its VE runs out (or as planned);
  //   everything after it is planned again from the real race time and lap. Stints get state 'done' | 'now' | 'plan'.
  function build(plan, live) {
    var out = { stints: [], stops: 0, laps: 0, end: 0, drivers: {}, warnings: [] };
    var drivers = (plan.drivers || []).filter(function (d) { return d && num(d.lap, 0) > 0; });
    if (!drivers.length) { out.warnings.push('Add a driver with a lap time.'); return out; }
    var timed = !plan.length || plan.length.kind !== 'laps', total = timed ? num(plan.length && plan.length.time, 0) : num(plan.length.laps, 0);
    if (!(total > 0)) { out.warnings.push('Set the race length.'); return out; }
    if (timed && live && live.raceEnd > total) total = live.raceEnd;                // live: the race ends at the leader's line after the time (fromLive)
    var ve = plan.ve || {}, pit = plan.pit || {}, ty = plan.tyres || {}, over = plan.stints || [], maxLaps = stintLaps(ve), veMax = num(ve.max, 100);
    var per = ve.mode === 'laps' ? 0 : num(ve.perLap, 0);                            // known VE use per lap (else only "needed")
    var wearPer = num(ty.wearPerLap, 0), useWear = ty.mode === 'wear' && wearPer > 0, every = Math.max(0, Math.round(num(ty.every, 0)));
    drivers.forEach(function (d) { out.drivers[d.name] = { time: 0, stints: 0, laps: 0 }; });
    function index(name) { for (var k = 0; k < drivers.length; k++) if (sameDriver(drivers[k].name, name)) return k; return -1; }
    function canDrive(d, laps) { return !(num(d.maxTime, 0) > 0) || out.drivers[d.name].time + laps * d.lap <= d.maxTime + 1e-6; }
    function nextDriver(from) {                                                       // the next driver in the order who still has drive time left
      for (var k = 1; k <= drivers.length; k++) { var j = (from + k) % drivers.length; if (canDrive(drivers[j], 1)) return j; }
      return from;
    }

    var done = (live && live.stints) || [], cur = live && live.current;
    function liveDriver(name) {                                                      // a driver in the live data who is not in the plan: added, with the first driver's lap time
      var k = index(name); if (k >= 0) return k;
      drivers.push({ name: name, lap: drivers[0].lap }); out.drivers[name] = { time: 0, stints: 0, laps: 0 }; return drivers.length - 1;
    }
    var t = 0, lap = 0, i = 0, inRow = 0, set = 1, onSet = 0, wear = 100, prev = null;
    // tyre age (plan.tyreDeg from this race, tyreDeg()): a stint's lap time = the driver's pace + s per lap of age x (its tyres' average age - the age his
    // pace was driven at). Each wheel's age in laps; a stint with new tyres starts them at 0 (real stints: the wheels that were changed)
    var deg = plan.tyreDeg && plan.tyreDeg.perLap > 0 ? plan.tyreDeg : null, wAge = [0, 0, 0, 0], refAll = null;
    if (deg) { var rv = Object.keys(deg.refAge || {}).map(function (k) { return deg.refAge[k]; }); refAll = rv.length ? rv.reduce(function (a, b) { return a + b; }, 0) / rv.length : 0; }
    function lapAt(d, avgAge) {
      if (!deg) return d.lap;
      var ref = null; for (var rk in deg.refAge || {}) if (sameDriver(rk, d.name)) ref = deg.refAge[rk];
      return d.lap + deg.perLap * (avgAge - (ref === null ? refAll : ref));
    }
    while (out.stints.length < MAX_STINTS) {
      var k = out.stints.length, ov = over[k] || {}, ovDriver = ov.driver ? index(ov.driver) : -1, ovLaps = Math.round(num(ov.laps, 0)), newSet = !prev;
      var real = k < done.length ? done[k] : (cur && k === done.length ? cur : null);   // this stint really happened / is happening
      if (real) ovDriver = liveDriver(real.driver);
      var planned = ovLaps > 0 ? ovLaps : maxLaps;
      if (prev) {                                                                     // the stop before this stint: tyres? driver swap?
        var autoTyres = useWear ? wear - wearPer * (isFinite(planned) ? planned : 0) < num(ty.minLeft, 0) : (every > 0 && onSet >= every);
        var tyres = real && typeof real.newSet === 'boolean' ? real.newSet : ov.tyres === 'new' ? true : ov.tyres === 'used' ? false : autoTyres;   // live, not known: as planned
        var d0 = drivers[i], autoJ = (num(d0.maxStints, 0) > 0 && inRow + 1 >= d0.maxStints) || !canDrive(d0, isFinite(maxLaps) ? maxLaps : 1) ? nextDriver(i) : i;
        var j = ovDriver >= 0 ? ovDriver : autoJ, swap = j !== i, loss = real ? Math.max(0, real.start - prev.end) : num(pit.base, 0) + (tyres ? num(pit.tyres, 0) : 0) + (swap ? num(pit.swap, 0) : 0);
        prev.stop = { loss: loss, tyres: tyres, which: real && typeof real.tyres === 'string' ? real.tyres : null, swap: swap, next: drivers[j].name, real: !!real };
        t += loss; out.stops++;
        if (tyres) { set++; onSet = 0; wear = 100; newSet = true; }
        var chW = real && typeof real.tyres === 'string' && real.tyres ? real.tyres.split(' ') : tyres ? WHEELS : [];
        WHEELS.forEach(function (w, q) { if (chW.indexOf(w) >= 0) wAge[q] = 0; });
        if (swap) { i = j; inRow = 0; } else inRow++;
      } else if (ovDriver >= 0) i = ovDriver;
      if (real) t = real.start;
      else if (live && prev && prev.state === 'done') t = Math.max(t, num(live.time, t));   // in the pit now: the next stint starts no sooner than now
      var d = drivers[i], state = real === cur && cur ? 'now' : (real ? 'done' : 'plan'), n, end, a0 = (wAge[0] + wAge[1] + wAge[2] + wAge[3]) / 4, sLap = d.lap;
      if (state === 'done') { n = real.laps; end = real.end; }
      else if (state === 'now') {
        // the laps this stint can still do: what the VE left allows (live), else the plan; never fewer than already driven
        var now = num(live.time, t), left = per > 0 && real.ve >= 0 ? Math.max(0, Math.floor(lineVe(real) / per + 1e-9) - num(ve.reserve, 0)) : Math.max(0, planned - real.laps);
        var toGo = timed ? Math.max(1, Math.ceil((total - now) / d.lap - 1e-9)) : total - lap - real.laps;
        n = real.laps + Math.min(left, toGo); sLap = lapAt(d, a0 + (real.laps + n) / 2); end = now + (n - real.laps) * sLap;
      } else {
        var l0 = lapAt(d, a0 + (isFinite(planned) ? planned : 20) / 2), need = timed ? Math.max(1, Math.ceil((total - t) / l0 - 1e-9)) : total - lap;
        n = Math.min(planned, need);
        if (!(ovLaps > 0) && num(d.maxTime, 0) > 0) n = Math.max(1, Math.min(n, Math.floor((d.maxTime - out.drivers[d.name].time) / l0 + 1e-9)));
        sLap = lapAt(d, a0 + n / 2); end = t + n * sLap;
      }
      var last = timed ? end >= total : lap + n >= total, s = { n: k + 1, driver: d.name, lap: sLap, tyreAge: deg ? Math.round(a0) : null, laps: n, fromLap: lap + 1, toLap: lap + n, start: t, end: end, state: state,
        veNeed: veNeeded(ve, n), veUsed: per > 0 ? per * n : null, veLeft: per > 0 ? veMax - per * n : null, set: set, newSet: newSet,
        wearEnd: wearPer > 0 ? wear - wearPer * n : null, changed: { driver: !real && ovDriver >= 0, laps: !real && ovLaps > 0, tyres: !real && k > 0 && (ov.tyres === 'new' || ov.tyres === 'used') }, stop: null };
      // a stint shorter than a full one (the last one, mostly) does not need a full refill (more VE = a longer stop and a heavier car). SAVE = fill what it
      // needs at the race's VE per lap (what a full stint allows in 'laps I aim for', else the plan's VE per lap) + the reserve; PUSH = ve.push % more per
      // lap (default 15; owner: a session's VE use can be a lift-and-coast one, so it is not 'your use without saving'); never over the max.
      // ov.fill = 'push' | 'save' (default)
      var res = num(ve.reserve, 0), pushPct = ve.push === null || ve.push === undefined || ve.push === '' ? 15 : num(ve.push, 15);
      var rate = ve.mode === 'laps' ? (isFinite(maxLaps) ? veNeeded(ve, maxLaps) : 0) : num(ve.perLap, 0);
      if (state === 'plan' && rate > 0) {
        var saveFill = Math.min(veMax, Math.ceil((n + res) * rate - 1e-9));
        if (saveFill < veMax - 0.5) {
          var pushRate = rate * (1 + Math.max(0, pushPct) / 100), pushFill = Math.min(veMax, Math.ceil((n + res) * pushRate - 1e-9)), push = ov.fill === 'push';
          s.fill = { mode: push ? 'push' : 'save', save: saveFill, push: pushFill, max: veMax, rate: rate, pushPerLap: pushFill / (n + res), room: pushFill / (n + res) / rate - 1 };
          s.veNeed = (push ? pushFill : saveFill) / (n + res);
          if (per > 0) { s.veUsed = per * n; s.veLeft = (push ? pushFill : saveFill) - per * n; }
        }
      }
      out.stints.push(s);
      t = s.end; lap += n; wear -= wearPer * n; onSet++; prev = s; wAge = wAge.map(function (a) { return a + n; });
      var dd = out.drivers[d.name]; dd.time += end - s.start; dd.stints++; dd.laps += n;
      if (state === 'plan' && per > 0 && s.veLeft < num(ve.reserve, 0) * per - 1e-6) out.warnings.push('Stint ' + s.n + ': ' + n + ' laps need ' + s.veNeed.toFixed(2) + ' % VE per lap or less; the plan uses ' + per + ' %.');
      if (last) break;
    }
    out.laps = lap; out.end = t;
    drivers.forEach(function (d) {
      var dd = out.drivers[d.name];
      if (num(d.minTime, 0) > 0 && dd.time < d.minTime) out.warnings.push(d.name + ' drives ' + Math.round(dd.time / 60) + ' min, below the minimum of ' + Math.round(d.minTime / 60) + ' min.');
    });
    if (num(ty.sets, 0) > 0 && set > ty.sets) out.warnings.push('Needs ' + set + ' tyre sets, ' + ty.sets + ' allowed.');
    if (wearPer > 0 && out.stints.some(function (x) { return x.wearEnd < 0; })) out.warnings.push('A stint ends with worn-out tyres: change tyres more often.');
    if (!isFinite(maxLaps) && out.stints.length === 1) out.warnings.push('Set the laps per stint (or the VE per lap): now the whole race is one stint.');
    if (out.stints.length >= MAX_STINTS) out.warnings.push('Too many stints: check the laps per stint.');
    return out;
  }

  // ---- a past race (api/stints: laps [n, time, pit, tyre left %, driver]) -> its stints: { driver, laps, from, to, newTyres (true / false / null = no tyre data) }
  // a stint ends at a pit lap; new tyres = the tyres are fresher on the lap after the stop (only known where the file has tyre wear: while your game was connected)
  function pastStints(laps) {
    var out = [], cur = null;
    laps.forEach(function (l, i) {
      if (!cur) { var before = out[out.length - 1], pl = laps[i - 1]; cur = { driver: l[4] || '', laps: 0, from: l[0], to: l[0], newTyres: !before ? true : (pl && pl[3] > 0 && l[3] > 0 ? l[3] > pl[3] + 2 : null) }; }
      cur.laps++; cur.to = l[0];
      if (l[2] || i === laps.length - 1) { out.push(cur); cur = null; }
    });
    return out;
  }

  // ---- pre-fill from your result files (Race Pace sessions: laps [n, t, s1, s2, s3, flags, pos, ve, wear]) ----
  // the laps that count (pace-math rules), their VE and tyre wear per lap, and the time lost by your stops
  function fromSessions(sessions, slow) {
    var M = P.paceMath, laps = [], veUse = [], wearUse = [], losses = [];
    sessions.forEach(function (s) {
      var c = M.classify(s, slow), byN = {};
      s.laps.forEach(function (l) { byN[l[0]] = l; });
      var pace = M.median(c.filter(function (l) { return !l.why && !l.wet; }).map(function (l) { return l.t; }));
      c.forEach(function (l) {
        var raw = byN[l.n], prev = byN[l.n - 1];
        if (!l.why && !l.wet) {
          laps.push(l.t);
          if (raw[7] > 0) veUse.push(raw[7]);
          if (prev && prev[8] > 0 && raw[8] > 0 && prev[8] - raw[8] >= 0) wearUse.push(prev[8] - raw[8]);
        }
        // the lap before, the pit lap and the lap after hold the in lap and the out lap (whichever of them the file flags): those 3 - 3 x pace = the stop
        var nx = byN[l.n + 1];
        if (l.pit && pace && l.t > 0 && prev && prev[1] > 0 && !(prev[5] & 1) && nx && nx[1] > 0 && !(nx[5] & 1)) {
          var loss = prev[1] + l.t + nx[1] - 3 * pace; if (loss > 0 && loss < 300) losses.push(loss);
        }
      });
    });
    return { laps: laps.length, lap: M.mean(laps), vePerLap: M.median(veUse), veLaps: veUse.length, wearPerLap: M.median(wearUse), pitLoss: M.median(losses), stops: losses.length };
  }

  // ---- one race you drove (a Race Pace session: laps [n, t, s1, s2, s3, flags, pos, ve, wear]) -> what a plan needs from it.
  // o = { veStart: % a stint starts with (100), veLeft: % left when you came in after the first stint that ended in a stop (typed; only used when the
  //       file has no VE), reserve: laps kept spare (as the plan) }
  // VE and tyre wear per lap = the AVERAGE over your normal laps: not a pit / out / slow (incident) / wet lap, and not a lap far from the others
  // (more than 15 % VE, 50 % wear off the median: damage, a refill). So one bad moment does not change the plan.
  // A pit lap that follows a pit lap or opens the race is an out lap (pit lane start, out of a repair), not a new stop. A stop with more than 1.5 laps of VE
  // left is EARLY (damage, a penalty): its time is not a pit stop time and its stint is not a full stint.
  // -> { pace (median clean lap), best, laps, stints: [{ from, to, laps, avg, stop }], stops: [{ after (in lap), loss (in + out lap - 2 x pace), tyres: true /
  //      false / null, early, veLeft }], full (the first stint that ended in a normal stop), vePerLap, veLaps (laps it is the average of), veOut (laps left
  //      out), veFrom: 'file' | 'typed' | null, wearPerLap, wearLaps, wearOut, fit (laps a stint of veStart allows with the reserve), veLeft / spareLaps (at
  //      the end of the full stint), more: { laps (fit + 1), perLap (VE % per lap allowed), save (% per lap less than your average) },
  //      options: the same for fit, fit + 1, + 2, + 3 laps }
  function fromRace(s, o) {
    o = o || {};
    var M = P.paceMath, c = M.classify(s, 0.05), byN = {}, out = { pace: null, best: null, laps: 0, stints: [], stops: [], full: null, vePerLap: null, veLaps: 0, veOut: 0,
      veFrom: null, wearPerLap: null, wearLaps: 0, wearOut: 0, fit: null, veLeft: null, spareLaps: null, more: null };
    s.laps.forEach(function (l) { byN[l[0]] = l; });
    var normal = c.filter(function (l) { return !l.why && !l.wet; });
    var clean = normal.map(function (l) { return l.t; });
    out.pace = M.median(clean); out.best = clean.length ? Math.min.apply(null, clean) : null; out.laps = s.laps.length ? s.laps[s.laps.length - 1][0] : 0;
    var start = num(o.veStart, 100), reserve = num(o.reserve, 0);
    // the averages over the normal laps, far-off laps left out
    function avg(vals, tol) {
      var m = M.median(vals); if (m === null) return { v: null, n: 0, out: 0 };
      var keep = vals.filter(function (v) { return Math.abs(v - m) <= m * tol; });
      return { v: M.mean(keep), n: keep.length, out: vals.length - keep.length };
    }
    var ve = avg(normal.map(function (l) { return byN[l.n][7]; }).filter(function (v) { return v > 0; }), 0.15);
    var wr = avg(normal.map(function (l) { var a = byN[l.n - 1], b = byN[l.n]; return a && a[8] > 0 && b[8] > 0 && a[8] > b[8] ? a[8] - b[8] : null; })
      .filter(function (v) { return v > 0; }), 0.5);
    if (wr.v > 0) { out.wearPerLap = wr.v; out.wearLaps = wr.n; out.wearOut = wr.out; }
    if (ve.v > 0 && ve.n >= 3) { out.vePerLap = ve.v; out.veLaps = ve.n; out.veOut = ve.out + (c.length - normal.length); out.veFrom = 'file'; }
    // stints and stops (stint laps by the lap counter: a lap without a time still counts)
    var cur = null;
    c.forEach(function (l, i) {
      if (!cur) cur = { from: l.n, to: l.n, laps: 0, times: [], stop: false };
      cur.to = l.n; cur.laps = cur.to - cur.from + 1; if (!l.why && !l.wet) cur.times.push(l.t);
      var last = i === c.length - 1, prev = byN[l.n - 1], outLap = i === 0 || (prev && (prev[5] & 1));
      if (l.pit && !last && !outLap) {
        cur.stop = true;
        var inL = byN[l.n], outL = byN[l.n + 1], wb = inL && inL[8], wa = outL && outL[8];
        out.stops.push({ after: l.n, stint: cur, loss: out.pace && inL[1] > 0 && outL && outL[1] > 0 ? Math.max(0, inL[1] + outL[1] - 2 * out.pace) : null,
          tyres: wb > 0 && wa > 0 ? wa > wb + 2 : null, early: false, veLeft: null });
      }
      if (cur.stop || last) { cur.avg = M.mean(cur.times); delete cur.times; out.stints.push(cur); cur = null; }
    });
    // VE left at each stop (the stint's recorded VE, your average for laps without it): an early stop had plenty left
    if (out.vePerLap) out.stops.forEach(function (p) {
      var used = 0; for (var n = p.stint.from; n <= p.stint.to; n++) used += byN[n] && byN[n][7] > 0 ? byN[n][7] : out.vePerLap;
      p.veLeft = Math.max(0, start - used);                                         // every stint starts with veStart
      p.early = p.veLeft !== null && p.veLeft > 1.5 * out.vePerLap;
    });
    out.stops.forEach(function (p) { p.stint.early = p.early; delete p.stint; });
    out.full = out.stints.filter(function (x) { return x.stop && !x.early; })[0] || null;
    if (!out.vePerLap && out.full && o.veLeft !== null && o.veLeft !== undefined && o.veLeft !== '' && num(o.veLeft, -1) >= 0 && num(o.veLeft, 0) < start) {
      out.vePerLap = (start - num(o.veLeft, 0)) / out.full.laps; out.veLaps = out.full.laps; out.veFrom = 'typed';
    }
    if (out.vePerLap > 0) {
      out.fit = Math.max(1, Math.floor(start / out.vePerLap - reserve + 1e-9));
      if (out.full) { out.veLeft = out.veFrom === 'typed' ? num(o.veLeft, 0) : out.stops.filter(function (p) { return p.after === out.full.to; })[0].veLeft; out.spareLaps = out.veLeft / out.vePerLap; }
      var per = veNeeded({ max: start, reserve: reserve }, out.fit + 1);
      out.more = { laps: out.fit + 1, perLap: per, save: out.vePerLap - per };
      out.options = [0, 1, 2, 3].map(function (k) { var p = veNeeded({ max: start, reserve: reserve }, out.fit + k); return { laps: out.fit + k, perLap: p, save: out.vePerLap - p }; });
    }
    return out;
  }

  // ---- a suggested stint length from your sessions on a track (Race Pace sessions with VE per lap: races and practice).
  // o = { sessions, max (VE a stint starts with), reserve, pitLoss (s), length: { kind, time, laps } (the plan's race), rate (VE per lap to plan with: the
  //       session you picked, as events scale VE differently; else the average of the sessions), cost (typed s per % per lap: used when not measured),
  //       kind: how that session was driven: 'push' (no saving: rate = your normal use), 'lift' (saving VE: rate = what you can hold; the pace = that session's
  //       pace, ownPace, as it includes the lifting; 'save' = saving MORE than that), 'mixed' (as push; its spread lets the cost be measured) }
  // Your pace = the median of the sessions' paces (races first), your VE use = the average over their normal laps. What saving VE costs: lap time against
  // VE per lap over all normal laps, each session around its own averages (an event can scale VE: 5.3 % a lap in one, 3.8 % in another) (a straight
  // line: s per % less per lap), only when there are 20+ laps with at least 0.15 % spread and it is a cost
  // (less VE = slower). Per stint length (what your VE allows - 1 .. + 4): VE per lap allowed, the saving, the lap time with that saving, the stops and
  // the laps (timed race: the most laps first) or the finish time (laps race). best = the most laps, then the earliest finish.
  // -> { pace, rate, laps (normal laps used), sessions, cost (s per % per lap, null = not known), options: [{ laps, perLap, save, lap, stops, raceLaps, end }], best,
  //      breakEven (cost not known: s per % per lap lifting may cost for the best to be worth it; null = the best lifts no more than needed) }
  function suggest(o) {
    var M = P.paceMath, paces = [], racePaces = [], pts = [], vSum = 0, vN = 0, used = 0, max = num(o.max, 100), res = num(o.reserve, 0), loss = num(o.pitLoss, 0);
    (o.sessions || []).forEach(function (s) {
      var x = fromRace(s, { veStart: max, reserve: res }); if (!(x.vePerLap > 0) || x.veFrom !== 'file') return;
      used++; vSum += x.vePerLap * x.veLaps; vN += x.veLaps; if (x.pace) (s.type === 'Race' ? racePaces : paces).push(x.pace);
      var own = [];                                                                   // this session's laps, centred on its own averages (events scale VE differently)
      M.classify(s, 0.05).forEach(function (l) { var v = s.laps.filter(function (q) { return q[0] === l.n; })[0][7]; if (!l.why && !l.wet && v > 0 && Math.abs(v - x.vePerLap) <= x.vePerLap * 0.15) own.push([v, l.t]); });
      if (own.length >= 3) { var ov = M.mean(own.map(function (p) { return p[0]; })), ot = M.mean(own.map(function (p) { return p[1]; })); own.forEach(function (p) { pts.push([p[0] - ov, p[1] - ot]); }); }
    });
    var out = { pace: M.median(racePaces.length ? racePaces : paces), rate: num(o.rate, 0) > 0 ? num(o.rate, 0) : vN ? vSum / vN : null, laps: vN, sessions: used, cost: null, measured: false, options: [], best: null };
    if ((o.kind === 'lift' || !out.pace) && num(o.ownPace, 0) > 0) out.pace = num(o.ownPace, 0);   // no session with VE in the file: the picked one's pace
    out.kind = o.kind || 'push';
    if (!out.pace || !out.rate) return out;
    if (pts.length >= 20) {
      var mv = M.mean(pts.map(function (p) { return p[0]; })), mt = M.mean(pts.map(function (p) { return p[1]; })), sxx = 0, sxy = 0;
      pts.forEach(function (p) { sxx += (p[0] - mv) * (p[0] - mv); sxy += (p[0] - mv) * (p[1] - mt); });
      var sd = Math.sqrt(sxx / pts.length), b = sxx > 0 ? sxy / sxx : 0;
      if (sd >= 0.15 && b < 0) { out.cost = Math.min(10, -b); out.measured = true; }
    }
    if (out.cost === null && num(o.cost, -1) >= 0 && o.cost !== '' && o.cost !== null) out.cost = num(o.cost, 0);
    return stintOptions(out, { max: max, reserve: res, pitLoss: loss, length: o.length });
  }
  // the stint lengths for numbers you already have: c = { pace, rate (VE per lap without extra saving), cost (s per % per lap, null = not known) } (filled in:
  // options, best, breakEven); o = { max, reserve, pitLoss, length }
  function stintOptions(out, o) {
    var max = num(o.max, 100), res = num(o.reserve, 0), loss = num(o.pitLoss, 0); out.options = []; out.best = null; out.breakEven = null;
    if (!(out.pace > 0) || !(out.rate > 0)) return out;
    var fit = Math.max(1, Math.floor(max / out.rate - res + 1e-9)), timed = !o.length || o.length.kind !== 'laps', total = timed ? num(o.length && o.length.time, 0) : num(o.length.laps, 0);
    if (!(total > 0)) return out;
    for (var L = Math.max(1, fit - 1); L <= fit + 4; L++) {
      var per = veNeeded({ max: max, reserve: res }, L), save = Math.max(0, out.rate - per), lap = out.pace + save * (out.cost || 0), n, stops;
      if (timed) { for (stops = 0; stops < 400; stops++) { n = Math.max(1, Math.ceil((total - stops * loss) / lap - 1e-9)); if (Math.ceil(n / L) - 1 <= stops) break; } }
      else { n = total; stops = Math.ceil(n / L) - 1; }
      stops = Math.max(0, Math.ceil(n / L) - 1);
      out.options.push({ laps: L, perLap: per, save: save, lap: lap, stops: stops, raceLaps: n, end: n * lap + stops * loss });
    }
    // best. Cost known: the most laps, then the earliest finish (the lap time has the cost of the saving in it), then the least lifting.
    // Cost not known: only the options without extra lifting can be judged (owner 2026-11-13: it picked 3.45 % a lap, as lifting looked free): of those
    // the most laps, then the fewest stops. Each lifting option gets breakEven = what 1 % less VE per lap may cost you a lap for it to beat that best
    // (the stops it saves against the laps you lift), null = it saves nothing (never worth it).
    var rank = function (a, b) { return b.raceLaps - a.raceLaps || (out.cost !== null ? a.end - b.end : a.stops - b.stops) || a.save - b.save; };
    var minSave = Math.min.apply(null, out.options.map(function (o) { return o.save; }));
    out.best = (out.cost !== null ? out.options.slice() : out.options.filter(function (o) { return o.save <= minSave + 0.05; })).sort(rank)[0] || null;   // 0.05 %: too little to call lifting
    var base = out.best;
    out.options.forEach(function (o) {
      o.breakEven = out.cost === null && base && o.save > Math.max(base.save, minSave + 0.05) ? (o.stops < base.stops || o.raceLaps > base.raceLaps ? Math.max(0, (base.stops - o.stops) * loss + (o.raceLaps - base.raceLaps) * out.pace) / (o.raceLaps * (o.save - base.save)) : null) : undefined;
    });
    return out;
  }

  // ---- several sessions you drove, each with how you drove it (owner 2026-11-13: more than one session). items = [{ s: Race Pace session, kind: 'push' (no
  // saving) | 'lift' (saving VE) | 'mixed' }], o = { max, reserve }. Per session fromRace() (normal laps only, early stops left out); together:
  // pace = the median of the no-saving sessions (races first; none: the saving ones), VE per lap per kind (weighted by laps; mixed sessions only for the cost),
  // what saving costs: lap time against VE inside each session (as suggest, 20+ laps, 0.15 % spread), else from a no-saving and a saving session:
  // (saving pace - normal pace) / (normal VE - saving VE). rate / kind = what a plan starts from: your normal VE when known, else the saving VE.
  // -> { rows: [{ s, kind, x (fromRace) }], pace, pacePush, paceLift, vePush, veLift, rate, kind, cost, costFrom: 'laps' | 'pair' | null, wear, pitLoss, laps }
  function combine(items, o) {
    var M = P.paceMath, max = num(o && o.max, 100), res = num(o && o.reserve, 0), rows = [], pts = [], losses = [], wearS = 0, wearN = 0, laps = 0;
    var by = { push: { ve: 0, n: 0, race: [], other: [] }, lift: { ve: 0, n: 0, race: [], other: [] }, mixed: { ve: 0, n: 0, race: [], other: [] } };
    (items || []).forEach(function (it) {
      if (!it || !it.s) return;
      var k = by[it.kind] ? it.kind : 'push', s = it.s, x = fromRace(s, { veStart: max, reserve: res }), g = by[k];
      rows.push({ s: s, kind: k, x: x });
      if (x.pace) (s.type === 'Race' ? g.race : g.other).push(x.pace);
      if (x.vePerLap > 0 && x.veFrom === 'file') { g.ve += x.vePerLap * x.veLaps; g.n += x.veLaps; laps += x.veLaps; }
      if (x.wearPerLap > 0) { wearS += x.wearPerLap * x.wearLaps; wearN += x.wearLaps; }
      if (s.type === 'Race') x.stops.forEach(function (p) { if (!p.early && p.loss > 0) losses.push(p.loss); });
      if (x.vePerLap > 0) {
        var own = [];
        M.classify(s, 0.05).forEach(function (l) { var v = s.laps.filter(function (q) { return q[0] === l.n; })[0][7]; if (!l.why && !l.wet && v > 0 && Math.abs(v - x.vePerLap) <= x.vePerLap * 0.15) own.push([v, l.t]); });
        if (own.length >= 3) { var ov = M.mean(own.map(function (p) { return p[0]; })), ot = M.mean(own.map(function (p) { return p[1]; })); own.forEach(function (p) { pts.push([p[0] - ov, p[1] - ot]); }); }
      }
    });
    function pace(g) { return M.median(g.race.length ? g.race : g.other); }
    var out = { rows: rows, pacePush: pace(by.push), paceLift: pace(by.lift), vePush: by.push.n ? by.push.ve / by.push.n : null, veLift: by.lift.n ? by.lift.ve / by.lift.n : null,
      cost: null, costFrom: null, wear: wearN ? wearS / wearN : null, pitLoss: M.median(losses), laps: laps };
    out.pace = out.pacePush || pace(by.mixed) || out.paceLift;
    out.rate = out.vePush || (by.mixed.n ? by.mixed.ve / by.mixed.n : null) || out.veLift; out.kind = out.vePush || by.mixed.n ? 'push' : out.veLift ? 'lift' : 'push';
    if (out.kind === 'lift') out.pace = out.paceLift || out.pace;
    if (pts.length >= 20) {
      var mv = M.mean(pts.map(function (p) { return p[0]; })), mt = M.mean(pts.map(function (p) { return p[1]; })), sxx = 0, sxy = 0;
      pts.forEach(function (p) { sxx += (p[0] - mv) * (p[0] - mv); sxy += (p[0] - mv) * (p[1] - mt); });
      if (Math.sqrt(sxx / pts.length) >= 0.15 && sxx > 0 && sxy < 0) { out.cost = Math.min(10, -sxy / sxx); out.costFrom = 'laps'; }
    }
    if (out.cost === null && out.vePush && out.veLift && out.vePush > out.veLift + 0.1 && out.pacePush && out.paceLift && out.paceLift >= out.pacePush) {
      out.cost = Math.min(10, (out.paceLift - out.pacePush) / (out.vePush - out.veLift)); out.costFrom = 'pair';
    }
    out.costNote = out.cost === null && out.vePush && out.veLift && out.pacePush && out.paceLift && out.paceLift < out.pacePush ? 'faster' : null;   // saving was faster: other conditions
    return out;
  }

  // ---- quick race: q ={ length: { kind, time, laps }, lap: s, unit: 've' | 'fuel', perLap (VE % / litres), max (the most you may fill: VE % cap / tank litres),
  //      reserve: laps kept spare at the end of every stint, pitLoss: s per stop }
  // -> { laps, stops, lapsPerFill, stints: [{ n, fromLap, toLap, laps, fill (fill to), add (at the stop before it), window: [earliest, latest] lap of that stop }], warnings }
  // Fewest stops first (stops cost laps in a timed race); with stops the car starts full and the last fill is only what the finish needs (a shorter stop).
  function quickPlan(q) {
    var out = { laps: 0, stops: 0, lapsPerFill: Infinity, stints: [], warnings: [] }, lap = num(q.lap, 0), per = num(q.perLap, 0), reserve = Math.max(0, num(q.reserve, 0));
    var timed = !q.length || q.length.kind !== 'laps', total = timed ? num(q.length && q.length.time, 0) : num(q.length.laps, 0);
    if (!(lap > 0)) { out.warnings.push('Set your lap time.'); return out; }
    if (!(total > 0)) { out.warnings.push('Set the race length.'); return out; }
    var cap = num(q.max, 0) > 0 ? num(q.max, 0) : (q.unit === 'fuel' ? Infinity : 100), loss = Math.max(0, num(q.pitLoss, 0));
    var perFill = per > 0 ? Math.floor(cap / per - reserve + 1e-9) : Infinity;
    if (!(perFill >= 1)) { out.warnings.push('Not even one lap fits in ' + cap + (q.unit === 'fuel' ? ' L' : ' %') + ': check the use per lap.'); return out; }
    var laps = 0, stops = 0;
    for (stops = 0; stops < 50; stops++) {
      laps = timed ? Math.max(1, Math.ceil((total - stops * loss) / lap - 1e-9)) : total;   // a timed race: you finish the lap you are on when the clock runs out
      if (Math.ceil(laps / perFill) - 1 <= stops) break;
    }
    stops = isFinite(perFill) ? Math.max(0, Math.ceil(laps / perFill) - 1) : 0;
    out.laps = laps; out.stops = stops; out.lapsPerFill = perFill;
    function up(v) { return Math.ceil(v - 1e-9); }                                    // fill to whole % / litres, rounded up
    var from = 1, left = 0;
    for (var k = 0; k <= stops; k++) {
      var n = k < stops ? perFill : laps - perFill * stops, fill = k < stops && stops > 0 ? cap : Math.min(cap, up((n + reserve) * per));
      if (k === 0 && stops > 0) fill = cap;
      var s = { n: k + 1, fromLap: from, toLap: from + n - 1, laps: n, fill: per > 0 ? fill : null, add: k > 0 && per > 0 ? Math.max(0, fill - left) : null,
        window: k > 0 ? [Math.max(1, laps - (stops - k + 1) * perFill), k * perFill] : null };
      out.stints.push(s); left = per > 0 ? fill - n * per : 0; from += n;
    }
    if (!(per > 0)) out.warnings.push('Set the ' + (q.unit === 'fuel' ? 'fuel' : 'VE') + ' use per lap to plan the fill.');
    return out;
  }

  // ---- an event text ("ELMS Super 60: Monza (Curva Grande), LMP2 (ELMS) (70L fuel tank) LMP3 (70L fuel tank ) & LMGT3 (75% VE/NRG) Classes, 60m races, ...")
  // -> { name, track, length: { kind: 'time', time } | null, classes: { LMGT3: { ve: 75 }, LMP2elms: { fuel: 70 }, ... } }
  var EVENT_CLASSES = [[/^(hypercar|hyper|lmh)$/i, 'LMH'], [/^lmp2\s*(\(elms\)|elms)$/i, 'LMP2elms'], [/^lmp2$/i, 'LMP2wec'], [/^lmp3$/i, 'LMP3'], [/^(lmgt3|gt3)$/i, 'LMGT3'], [/^gte$/i, 'GTE']];
  function parseEvent(text) {
    var t = String(text || ''), out = { name: '', track: '', length: null, classes: {} };
    var colon = t.indexOf(':');
    if (colon > 0) { out.name = t.slice(0, colon).trim(); out.track = (t.slice(colon + 1).split(',')[0] || '').trim(); }
    var len = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\s+races?\b/i.exec(t) || /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|min|mins|minutes?)\b/i.exec(t);
    if (len) out.length = { kind: 'time', time: Number(len[1]) * (/^h/i.test(len[2]) ? 3600 : 60) };
    var lapsM = /(\d+)\s*laps?\s+races?\b/i.exec(t); if (!len && lapsM) out.length = { kind: 'laps', laps: Number(lapsM[1]) };
    var re = /\b(Hypercar|Hyper|LMH|LMP2\s*\(ELMS\)|LMP2\s*ELMS|LMP2|LMP3|LMGT3|GT3|GTE)((?:\s*\([^)]*\))*)/gi, m;
    while ((m = re.exec(t))) {
      var key = null; EVENT_CLASSES.forEach(function (c) { if (!key && c[0].test(m[1].trim())) key = c[1]; });
      if (!key) continue;
      var c = out.classes[key] = out.classes[key] || {}, inside = m[2] || '';
      var ve = /(\d+(?:\.\d+)?)\s*%\s*(?:VE|NRG|energy|virtual)/i.exec(inside), fuel = /(\d+(?:\.\d+)?)\s*L\b/i.exec(inside);
      if (ve) c.ve = Number(ve[1]); if (fuel) c.fuel = Number(fuel[1]);
    }
    return out;
  }

  // a race length as typed -> s: "8" / "8h" = 8 h, "8:00" / "8h00" / "8.30" (h.mm) = 8 h (30 min), "800" / "1230" (no separator, 3-4 digits) = h mm; else 0
  function parseDur(t) {
    var m = /^\s*(\d+)\s*(?:[:h.]\s*(\d{1,2}))?\s*h?\s*$/i.exec(t || '');
    if (!m) return 0;
    var h = Number(m[1]), min = Number(m[2] || 0);
    if (m[2] === undefined && m[1].length >= 3 && m[1].length <= 4) { h = Math.floor(h / 100); min = Number(m[1].slice(-2)); }
    return min < 60 ? h * 3600 + min * 60 : 0;
  }

  // real clock (ms) of a race time: the green flag (ms) + race time (s)
  function clockAt(greenMs, raceSec) { return greenMs + raceSec * 1000; }

  // ---- live (api/race-live: { clock, session: { id, phase, et, endEt, maxLaps, track }, car: { driver, laps, inPits, ve }, log: StintTracker's RaceLog }) ----
  // -> { status, ... }: 'off' (no game / no data), 'waiting' (practice / qualifying / warm-up: endsIn s), 'grid' (race, before the green flag),
  //    'live' { time: race time now, greenMs (PC clock of the green flag), greenEstimated, stints (done), current, inPit, driver, phase, lapsBefore },
  //    'over' (chequered flag). Race time = session time - the green flag; a missed start: green = session end - the planned race length.
  function fromLive(r, length) {
    var s = r && r.session;
    if (!s) return { status: 'off' };
    if (s.id < 10 || s.id > 13) return { status: 'waiting', session: s.id, endsIn: s.endEt > 0 && s.endEt >= s.et ? s.endEt - s.et : -1, track: s.track };
    var log = r.log;
    if (!log || (log.greenEt < 0 && !log.missedStart)) return { status: 'grid', track: s.track, phase: s.phase };
    var green = log.greenEt >= 0 ? log.greenEt : (length && length.kind !== 'laps' && length.time > 0 && s.endEt > 0 ? s.endEt - length.time : (log.stints.length ? log.stints[0].start : s.et));
    var time = s.et - green, list = log.stints || [], lapsBefore = list.length ? list[0].startLap : 0;
    // a stint's laps: up to the next stint's start lap when there is one (the in-lap ends in the pit lane: logs before 2026-11-14 missed it, 25 instead of 26)
    function conv(x, i) {
      var nx = list[i + 1], laps = nx && nx.startLap > x.startLap ? Math.max(x.laps, nx.startLap - x.startLap) : x.laps;
      return { driver: x.driver, laps: laps, newSet: typeof x.newTyres === 'boolean' ? x.newTyres : null, tyres: typeof x.tyresChanged === 'string' ? x.tyresChanged : null,
        start: x.start - green, end: x.end >= 0 ? x.end - green : -1, lapLog: x.lapLog || [], veStart: x.veStart, startLap: x.startLap };
    }
    var all = list.map(conv), done = all.filter(function (x) { return x.end >= 0; }), last = list[list.length - 1], cur = last && last.end < 0 ? all[all.length - 1] : null;
    if (cur) { cur.laps = Math.max(cur.laps, (r.car ? r.car.laps : 0) - last.startLap); if (r.car && r.car.ve >= 0) cur.ve = r.car.ve; }
    // the app started during the race: the laps before it count as one stint, so the lap count and the race time line up
    if (log.missedStart && lapsBefore > 0 && list.length) done.unshift({ driver: BEFORE, laps: lapsBefore, newSet: null, start: 0, end: list[0].start - green });
    // a timed race ends when the overall LEADER crosses the line after the time is up; you finish at your next line after that (a lap down or not).
    // raceEnd = race time of the leader's line after the time (their last lap, else estimated; their time into the lap now), null = not known / a lap race
    var raceEnd = null, ld = r.leader, total = length && length.kind !== 'laps' ? num(length.time, 0) : 0;
    if (ld && total > 0) {
      var llap = ld.last > 0 ? ld.last : ld.est > 0 ? ld.est : 0;
      if (llap > 30 && ld.into >= 0) { var x = time + Math.max(0, llap - ld.into); while (x < total) x += llap; raceEnd = x; }
    }
    return { status: s.phase === 8 ? 'over' : 'live', track: s.track, phase: s.phase, time: time, raceEnd: raceEnd, leader: ld || null, greenMs: log.greenClock > 0 ? log.greenClock : r.clock - time * 1000,
      greenEstimated: !(log.greenClock > 0), stints: done, current: cur, inPit: !cur, driver: r.car ? r.car.driver : '', lapsBefore: lapsBefore, entry: log.entry };
  }

  // ---- one stint from its lap log ([lap count, lap time, VE at the line, in/out lap]): the average of its clean laps (no in / out lap, none over 107 % of
  // their median: a spin, a slow zone), its fastest lap, and the VE it used per lap (laps not in the pit lane). veStart = VE when it began.
  // -> { avg, best, clean (laps), ve (% per lap, null = not known), veLaps }
  function stintStats(lapLog, veStart) {
    var L = lapLog || [], t = L.filter(function (x) { return !x[3] && x[1] > 0; }).map(function (x) { return x[1]; }), med = t.length ? P.paceMath.median(t) : 0;
    var clean = t.filter(function (v) { return v <= med * 1.07; }), out = { avg: null, best: null, clean: clean.length, ve: null, veLaps: 0 };
    if (clean.length) { out.avg = clean.reduce(function (a, b) { return a + b; }, 0) / clean.length; out.best = Math.min.apply(null, clean); }
    var used = 0, n = 0, prev = veStart >= 0 ? veStart : null;
    L.forEach(function (x) { var v = x[2]; if (v >= 0 && prev !== null && !x[3] && prev - v > 0 && prev - v < 50) { used += prev - v; n++; } if (v >= 0) prev = v; });
    if (n) { out.ve = used / n; out.veLaps = n; }
    return out;
  }

  // ---- live pace per driver: the average of his clean laps over all his stints (stintStats); a log without lap times: a stint's time / its laps
  // (in and out lap in it, so slow; owner: '2:07 for both of us' made no sense). -> { name: s }
  function livePace(r) {
    var log = r && r.log, et = r && r.session ? r.session.et : -1, per = {}, old = {};
    ((log && log.stints) || []).forEach(function (x) {
      if (!x.driver) return;
      var L = (x.lapLog || []).filter(function (l) { return !l[3] && l[1] > 0; }).map(function (l) { return l[1]; });
      if (L.length) { var med = P.paceMath.median(L); (per[x.driver] = per[x.driver] || []).push.apply(per[x.driver], L.filter(function (v) { return v <= med * 1.07; })); return; }
      var end = x.end >= 0 ? x.end : et, n = x.laps; if (!(n >= 3) || !(end > x.start)) return;
      (old[x.driver] = old[x.driver] || []).push((end - x.start) / n);
    });
    var out = {};
    Object.keys(old).forEach(function (d) { out[d] = P.paceMath.median(old[d]); });
    Object.keys(per).forEach(function (d) { if (per[d].length) out[d] = per[d].reduce(function (a, b) { return a + b; }, 0) / per[d].length; });
    return out;
  }

  // ---- tyre age (owner 2026-11-16: a second stint on the same tyres is not as fast as the first). From this race's laps: how much slower a lap gets per lap
  // the tyres have done. Each wheel's age counts from its last change (a stint's tyres: 'FL FR' = the fronts; newSet true without names = all four; not
  // known at the start = new); a lap's age = the four wheels' average. Fitted on clean laps (no in / out lap, within 107 % of the driver's median) with each
  // driver his own level and the lap in the stint as a second measure (the car gets lighter as the VE goes: faster), so neither the driver nor the fuel is
  // counted as tyre wear. stints = fromLive's (done + current, in order).
  // -> { perLap (s slower per lap of tyre age, >= 0), laps (used), refAge: { driver: his average tyre age } } | null (too little to tell: no double stints)
  var WHEELS = ['FL', 'FR', 'RL', 'RR'];
  function wheelAges(stints) {
    var age = [0, 0, 0, 0], out = [];
    (stints || []).forEach(function (x, i) {
      if (i > 0) {
        var w = typeof x.tyres === 'string' && x.tyres ? x.tyres.split(' ') : x.newSet === true || (x.newSet === null && x.tyres === null) ? WHEELS : [];
        WHEELS.forEach(function (n, k) { if (w.indexOf(n) >= 0) age[k] = 0; });
      }
      out.push(age.slice()); var n = num(x.laps, 0); age = age.map(function (a) { return a + n; });
    });
    return out;                                                                             // per stint: each wheel's age (laps) at its start
  }
  function tyreDeg(stints) {
    var starts = wheelAges(stints), rows = [], byDrv = {}, vs = [], healthy = 0;
    // laps with a clearly lower top speed (damage, lapLog [4]) are left out: their time is not the tyres'
    (stints || []).forEach(function (x) { (x.lapLog || []).forEach(function (l) { if (!l[3] && l[4] > 0) vs.push(l[4]); }); });
    for (var h = 4; h < vs.length; h++) { var mh = P.paceMath.median(vs.slice(h - 4, h + 1)); if (mh > healthy) healthy = mh; }
    (stints || []).forEach(function (x, i) {
      if (!x.driver || !x.lapLog || !x.lapLog.length) return;
      var a0 = (starts[i][0] + starts[i][1] + starts[i][2] + starts[i][3]) / 4, first = num(x.startLap, 0), L = x.lapLog.filter(function (l) { return !l[3] && l[1] > 0 && !(healthy > 0 && l[4] > 0 && l[4] < healthy - 4); });
      L.forEach(function (l) { var k = l[0] - first; (byDrv[x.driver] = byDrv[x.driver] || []).push({ t: l[1], age: a0 + k - 0.5, k: k }); });
    });
    var refAge = {}, n = 0, sxx = 0, sxy = 0, syy = 0, sxt = 0, syt = 0;                  // x = tyre age, y = lap in the stint, both less the driver's mean
    Object.keys(byDrv).forEach(function (d) {
      var r = byDrv[d], med = P.paceMath.median(r.map(function (q) { return q.t; }));
      r = r.filter(function (q) { return q.t <= med * 1.07; }); if (r.length < 5) return;
      var mt = 0, ma = 0, mk = 0; r.forEach(function (q) { mt += q.t; ma += q.age; mk += q.k; }); mt /= r.length; ma /= r.length; mk /= r.length;
      refAge[d] = ma;
      r.forEach(function (q) { var x = q.age - ma, y = q.k - mk, t = q.t - mt; sxx += x * x; sxy += x * y; syy += y * y; sxt += x * t; syt += y * t; n++; });
    });
    var det = sxx * syy - sxy * sxy;
    if (n < 30 || !(det > 1e-9 * sxx * syy) || det / syy < 25 * n) return null;          // the tyre age must vary apart from the lap in the stint (double stints)
    var b = (sxt * syy - syt * sxy) / det, c = (syt * sxx - sxt * sxy) / det;
    return { perLap: Math.max(0, Math.min(0.15, b)), perStintLap: Math.max(-0.1, Math.min(0.1, c)), laps: n, refAge: refAge };   // perStintLap: s per lap into the stint (< 0: lighter, faster)
  }

  // ---- damage (owner 2026-11-16: spectating a team-mate, the game froze the aero damage; at the swap it was 69 % and the top speed was well down). From the
  // top speed per lap (lapLog [4] = km/h at the learned point on the longest straight, StintTracker): healthy = the best 5-lap median of the race, now =
  // the last 5 laps' median; the drop since the lap it fell. Lap time lost: the same driver's clean laps after against before (tyre age taken out:
  // tyreDeg), else the drivers who drove both, else a rough guess from the speed (about a third of a lap at high speed). Repair: the game's time
  // (dmg.fixAero + half its random delay; 30 + 2.5 s when not known) against the time lost over the laps after the next stop (or an extra stop + the
  // repair when this is the last stint). stints = fromLive's (done + current); o = { deg, damage (race-live), lapsAfterStop, lapsLeft, lastStint, pitLoss }
  // -> { drop (km/h), healthy, now, since (lap), lapLoss (s, null = not known), lapHow ('measured' | 'guess'), aero (0..1 or null), aeroLive, fix (s),
  //      cost (s), gain (s), worth (bool | null), breakEven (laps), extraStop (bool) } | null (no speeds yet)
  function med(a) { return a.length ? P.paceMath.median(a) : null; }
  function damageCheck(stints, o) {
    o = o || {}; var rows = [], starts = wheelAges(stints);
    (stints || []).forEach(function (x, i) {
      var a0 = starts[i] ? (starts[i][0] + starts[i][1] + starts[i][2] + starts[i][3]) / 4 : 0;
      (x.lapLog || []).forEach(function (l) { var k = l[0] - num(x.startLap, 0); if (!l[3] && l[4] > 0) rows.push({ lap: l[0], t: l[1], v: l[4], d: x.driver, age: a0 + k - 0.5, k: k }); });
    });
    var dmg = o.damage || null, out = { aero: dmg && dmg.aero >= 0 ? dmg.aero : null, aeroLive: !!(dmg && dmg.live) };
    if (rows.length < 6) return rows.length || out.aero !== null ? Object.assign(out, { drop: null }) : null;
    var healthy = 0; for (var i = 4; i < rows.length; i++) { var m = med(rows.slice(i - 4, i + 1).map(function (r) { return r.v; })); if (m > healthy) healthy = m; }
    var now = med(rows.slice(-5).map(function (r) { return r.v; })), drop = Math.max(0, healthy - now), since = null;
    if (drop >= 3) {                                                                        // the lap it fell: after the last 3-lap median still near the healthy speed
      for (var j = rows.length - 1; j >= 2; j--) if (med(rows.slice(j - 2, j + 1).map(function (r) { return r.v; })) >= healthy - drop / 2) { since = j + 1 < rows.length ? rows[j + 1].lap : null; break; }
      if (since === null) since = rows[0].lap;
    }
    Object.assign(out, { drop: drop, healthy: healthy, now: now, since: since, lapLoss: null, lapHow: null });
    if (drop >= 3 && since !== null) {
      var deg = o.deg, adj = function (r) { var ref = deg && deg.refAge ? deg.refAge[r.d] : null; return deg && ref !== undefined && ref !== null ? r.t - deg.perLap * (r.age - ref) - num(deg.perStintLap, 0) * r.k : r.t; };
      var per = {}; rows.forEach(function (r) { if (r.t > 0) (per[r.d] = per[r.d] || []).push(r); });
      var diffs = [], cur = rows[rows.length - 1].d, curDiff = null;
      Object.keys(per).forEach(function (d) {
        var all = per[d], m0 = med(all.map(function (r) { return r.t; })), ok = all.filter(function (r) { return r.t <= m0 * 1.07; });
        var b = ok.filter(function (r) { return r.lap < since; }).slice(-8).map(adj), a = ok.filter(function (r) { return r.lap >= since; }).slice(0, 8).map(adj);   // the laps just before and after
        if (b.length >= 5 && a.length >= 3) { var df = a.reduce(function (x, y) { return x + y; }, 0) / a.length - b.reduce(function (x, y) { return x + y; }, 0) / b.length; diffs.push(df); if (sameDriver(d, cur)) curDiff = df; }
      });
      if (curDiff !== null) { out.lapLoss = Math.max(0, curDiff); out.lapHow = 'measured'; }
      else if (diffs.length) { out.lapLoss = Math.max(0, diffs.reduce(function (x, y) { return x + y; }, 0) / diffs.length); out.lapHow = 'measured'; }
      else { var lt = med(rows.map(function (r) { return r.t; }).filter(function (t) { return t > 0; })); if (lt) { out.lapLoss = lt * 0.33 * drop / healthy; out.lapHow = 'guess'; } }
    }
    // what a repair costs and earns back
    var fix = (dmg && dmg.fixAero > 0 ? dmg.fixAero : 30) + (dmg && dmg.fixRandom >= 0 ? dmg.fixRandom / 2 : 2.5);
    out.fix = fix; out.extraStop = !!o.lastStint; out.cost = fix + (o.lastStint ? num(o.pitLoss, 0) : 0);
    var laps = o.lastStint ? num(o.lapsLeft, 0) : num(o.lapsAfterStop, 0);
    if (out.lapLoss > 0.05) { out.gain = out.lapLoss * laps; out.breakEven = Math.ceil(out.cost / out.lapLoss); out.worth = out.gain > out.cost; }
    else { out.gain = 0; out.breakEven = null; out.worth = drop >= 3 ? null : false; }
    return out;
  }

  // ---- will the VE last to the planned stop? Not one lap against a strict limit (owner 2026-11-14: one lap a bit over turned it red although we had saved
  // plenty before): the VE in the tank now against the laps still to drive at your usual use (use = this stint's average per lap). t = liveTarget().
  // -> { level: 'push' | 'ok' | 'close' | 'over', spare (% VE left at the stop, may be < 0), spareLaps, room (% per lap you may use more, < 0 = save), use, need (% per lap allowed) } | null
  function veCheck(t, use, reserve) {
    if (!t || !(t.left > 0) || !(use > 0) || !(t.ve >= 0)) return null;
    var res = t.finish ? 0 : num(reserve, 0), spare = t.ve - (t.left + res) * use, spareLaps = spare / use, room = spare / t.left;
    var level = spareLaps >= 1 ? 'push' : spareLaps >= 0 ? 'ok' : spareLaps >= -0.5 ? 'close' : 'over';
    return { level: level, spare: spare, spareLaps: spareLaps, room: room, use: use, need: use + room };
  }
  // ---- the stint you are in: the VE per lap you may still use to reach its planned end (planned laps, or the finish if that comes first) with the
  // reserve. plan, live = fromLive(), lap = the driver's lap time -> { laps (planned), left (laps to go), pitLap (the car's lap count at the stop, null =
  // the finish), target (% per lap), ve (now), finish } or null (not in a stint / VE not known)
  // the VE left at the last line (lapLog), so the laps still to go are whole laps; else the VE now (owner 2026-11-15: mid-lap the VE now with the lap
  // counted whole looked short: LIFT while on target)
  function lineVe(cur) {
    var g = cur && cur.lapLog, e = g && g.length ? g[g.length - 1] : null;
    return e && e[0] === num(cur.startLap, -1e9) + cur.laps && e[2] >= 0 ? e[2] : cur ? cur.ve : -1;
  }
  function liveTarget(plan, live, lap) {
    var cur = live && live.current; if (!cur || !(cur.ve >= 0)) return null;
    var ve = lineVe(cur);
    var k = (live.stints || []).length, ov = (plan.stints || [])[k] || {}, n = Math.round(num(ov.laps, 0)) > 0 ? Math.round(ov.laps) : stintLaps(plan.ve), res = num(plan.ve && plan.ve.reserve, 0);
    var timed = !plan.length || plan.length.kind !== 'laps', total = timed ? num(plan.length && plan.length.time, 0) : num(plan.length.laps, 0);
    if (timed && live.raceEnd > total) total = live.raceEnd;
    var done = (live.stints || []).reduce(function (a, x) { return a + x.laps; }, 0) + cur.laps;
    var toGo = timed ? (lap > 0 && total > 0 ? Math.max(0, Math.ceil((total - live.time) / lap - 1e-9)) : Infinity) : Math.max(0, total - done);
    var left = isFinite(n) ? Math.max(0, n - cur.laps) : toGo, finish = toGo <= left;
    left = Math.min(left, toGo); if (!isFinite(left)) return null;
    return { laps: n, left: left, pitLap: finish ? null : done + left, target: left > 0 ? ve / (left + (finish ? 0 : res)) : null, ve: ve, veNow: cur.ve, finish: finish };
  }

  P.strategyMath = { build: build, damageCheck: damageCheck, tyreDeg: tyreDeg, wheelAges: wheelAges, stintLaps: stintLaps, veNeeded: veNeeded, pastStints: pastStints, fromSessions: fromSessions, fromRace: fromRace, suggest: suggest, stintOptions: stintOptions, combine: combine, parseDur: parseDur, clockAt: clockAt, fromLive: fromLive, livePace: livePace, liveTarget: liveTarget, stintStats: stintStats, veCheck: veCheck, sameDriver: sameDriver, paceOf: paceOf, BEFORE: BEFORE, quickPlan: quickPlan, parseEvent: parseEvent };
  if (typeof module !== 'undefined') module.exports = P.strategyMath;
})(typeof window !== 'undefined' ? window : globalThis);
