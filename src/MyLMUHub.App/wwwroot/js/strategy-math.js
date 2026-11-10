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
    var ve = plan.ve || {}, pit = plan.pit || {}, ty = plan.tyres || {}, over = plan.stints || [], maxLaps = stintLaps(ve), veMax = num(ve.max, 100);
    var per = ve.mode === 'laps' ? 0 : num(ve.perLap, 0);                            // known VE use per lap (else only "needed")
    var wearPer = num(ty.wearPerLap, 0), useWear = ty.mode === 'wear' && wearPer > 0, every = Math.max(0, Math.round(num(ty.every, 0)));
    drivers.forEach(function (d) { out.drivers[d.name] = { time: 0, stints: 0, laps: 0 }; });
    function index(name) { for (var k = 0; k < drivers.length; k++) if (drivers[k].name === name) return k; return -1; }
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
        prev.stop = { loss: loss, tyres: tyres, swap: swap, next: drivers[j].name, real: !!real };
        t += loss; out.stops++;
        if (tyres) { set++; onSet = 0; wear = 100; newSet = true; }
        if (swap) { i = j; inRow = 0; } else inRow++;
      } else if (ovDriver >= 0) i = ovDriver;
      if (real) t = real.start;
      else if (live && prev && prev.state === 'done') t = Math.max(t, num(live.time, t));   // in the pit now: the next stint starts no sooner than now
      var d = drivers[i], state = real === cur && cur ? 'now' : (real ? 'done' : 'plan'), n, end;
      if (state === 'done') { n = real.laps; end = real.end; }
      else if (state === 'now') {
        // the laps this stint can still do: what the VE left allows (live), else the plan; never fewer than already driven
        var now = num(live.time, t), left = per > 0 && real.ve >= 0 ? Math.max(0, Math.floor(real.ve / per + 1e-9) - num(ve.reserve, 0)) : Math.max(0, planned - real.laps);
        var toGo = timed ? Math.max(1, Math.ceil((total - now) / d.lap - 1e-9)) : total - lap - real.laps;
        n = real.laps + Math.min(left, toGo); end = now + (n - real.laps) * d.lap;
      } else {
        var need = timed ? Math.max(1, Math.ceil((total - t) / d.lap - 1e-9)) : total - lap;
        n = Math.min(planned, need);
        if (!(ovLaps > 0) && num(d.maxTime, 0) > 0) n = Math.max(1, Math.min(n, Math.floor((d.maxTime - out.drivers[d.name].time) / d.lap + 1e-9)));
        end = t + n * d.lap;
      }
      var last = timed ? end >= total : lap + n >= total, s = { n: k + 1, driver: d.name, lap: d.lap, laps: n, fromLap: lap + 1, toLap: lap + n, start: t, end: end, state: state,
        veNeed: veNeeded(ve, n), veUsed: per > 0 ? per * n : null, veLeft: per > 0 ? veMax - per * n : null, set: set, newSet: newSet,
        wearEnd: wearPer > 0 ? wear - wearPer * n : null, changed: { driver: !real && ovDriver >= 0, laps: !real && ovLaps > 0, tyres: !real && k > 0 && (ov.tyres === 'new' || ov.tyres === 'used') }, stop: null };
      out.stints.push(s);
      t = s.end; lap += n; wear -= wearPer * n; onSet++; prev = s;
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

  // ---- quick race: q = { length: { kind, time, laps }, lap: s, unit: 've' | 'fuel', perLap (VE % / litres), max (the most you may fill: VE % cap / tank litres),
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
    function conv(x) { return { driver: x.driver, laps: x.laps, newSet: typeof x.newTyres === 'boolean' ? x.newTyres : null, start: x.start - green, end: x.end >= 0 ? x.end - green : -1 }; }
    var done = list.filter(function (x) { return x.end >= 0; }).map(conv), last = list[list.length - 1], cur = last && last.end < 0 ? conv(last) : null;
    if (cur) { cur.laps = Math.max(cur.laps, (r.car ? r.car.laps : 0) - last.startLap); if (r.car && r.car.ve >= 0) cur.ve = r.car.ve; }
    // the app started during the race: the laps before it count as one stint, so the lap count and the race time line up
    if (log.missedStart && lapsBefore > 0 && list.length) done.unshift({ driver: BEFORE, laps: lapsBefore, newSet: null, start: 0, end: list[0].start - green });
    return { status: s.phase === 8 ? 'over' : 'live', track: s.track, phase: s.phase, time: time, greenMs: log.greenClock > 0 ? log.greenClock : r.clock - time * 1000,
      greenEstimated: !(log.greenClock > 0), stints: done, current: cur, inPit: !cur, driver: r.car ? r.car.driver : '', lapsBefore: lapsBefore, entry: log.entry };
  }

  P.strategyMath = { build: build, stintLaps: stintLaps, veNeeded: veNeeded, pastStints: pastStints, fromSessions: fromSessions, clockAt: clockAt, fromLive: fromLive, BEFORE: BEFORE, quickPlan: quickPlan, parseEvent: parseEvent };
  if (typeof module !== 'undefined') module.exports = P.strategyMath;
})(typeof window !== 'undefined' ? window : globalThis);
