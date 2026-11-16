// Race review (owner 2026-11-15: "review what happened, and see if we could've done things differently"): a finished race from its results file
// (api/stints: every driver's laps of your car). Pure functions (tests/js/review-math.test.js).
//   stints:   split at the pit laps; per stint the average of its clean laps, its fastest lap, VE per lap, VE left at the stop, the stop's time loss,
//             which tyres were changed (from the wear per wheel; a team-mate's laps have none)
//   liftCost: what using less VE cost per lap in this race (stints of one driver against each other), null = not measurable
//   review:   all of it + findings in plain words + "what if" (strategy-math stintOptions with this race's own numbers) + the plan against what happened
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  var WHEELS = ['FL', 'FR', 'RL', 'RR'];

  // lap rows of api/stints -> objects. [n, time, pit, wear %, driver, VE used %, VE left %, wheels [4] 0..1, et]
  // A stop the file did not mark (owner 2026-11-16: an 8 h race whose file had no pit lap at all, so two drivers became one 115-lap stint): a lap is the
  // in-lap too when the next lap has another driver, or when the VE left went up by more than 5 % in it (refilled). pitGuess = found that way.
  function laps(race) {
    var L = ((race && race.laps) || []).map(function (l) {
      return { n: l[0], t: l[1] > 0 ? l[1] : null, pit: !!l[2], driver: l[4] || '', veUsed: l[5] > 0 ? l[5] : null, veLeft: l[6] >= 0 ? l[6] : null, wheels: Array.isArray(l[7]) && l[7].length === 4 ? l[7] : null, et: num(l[8], -1) };
    }).sort(function (a, b) { return a.n - b.n; });
    L.forEach(function (l, i) {
      if (l.pit) return;
      var nx = L[i + 1], pv = L[i - 1];
      var swap = nx && l.driver && nx.driver && nx.driver !== l.driver, refill = pv && !pv.pit && pv.veLeft !== null && l.veLeft !== null && l.veLeft > pv.veLeft + 5;   // right after a pit lap: that stop's refill
      if ((swap || refill) && nx) { l.pit = true; l.pitGuess = true; }
    });
    return L;
  }

  // which tyres were changed at a stop: the wear per wheel at the end of the in-lap against the end of the out-lap (fresher = changed). In-lap not known
  // (a team-mate drove it): a tyre at 97 % or more after the out-lap was new. -> 'FL FR RL RR' / 'FL FR' / '' (none) / null (not known); likely = guessed
  function tyresAt(inLap, outLap) {
    if (!outLap || !outLap.wheels) return { which: null, likely: false };
    if (inLap && inLap.wheels) return { which: WHEELS.filter(function (w, i) { return outLap.wheels[i] > inLap.wheels[i] + 0.02; }).join(' '), likely: false };
    return { which: WHEELS.filter(function (w, i) { return outLap.wheels[i] >= 0.97; }).join(' '), likely: true };
  }

  // the race in stints: a stint ends with a pit lap (the in-lap); the next begins with the out-lap
  function stints(race) {
    var L = laps(race), out = [], cur = null;
    L.forEach(function (l, i) {
      if (!cur) { cur = { laps: [], outLap: out.length > 0 ? l : null }; }
      cur.laps.push(l);
      if (l.pit || i === L.length - 1) { cur.inLap = l.pit ? l : null; out.push(cur); cur = null; }
    });
    return out.map(function (s, k) {
      var ls = s.laps, who = {}, best = null;
      ls.forEach(function (l) { if (l.driver) who[l.driver] = (who[l.driver] || 0) + 1; });
      var driver = Object.keys(who).sort(function (a, b) { return who[b] - who[a]; })[0] || '';
      var times = ls.filter(function (l) { return l.t && l !== s.inLap && l !== s.outLap && l.n > 1; }).map(function (l) { return l.t; }), med = median(times);
      var clean = times.filter(function (t) { return t <= med * 1.07; });
      clean.forEach(function (t) { if (best === null || t < best) best = t; });
      var ve = ls.filter(function (l) { return l !== s.outLap && l.veUsed && l.veUsed < 20; }).map(function (l) { return l.veUsed; });
      var prev = k > 0 ? out[k - 1] : null, ty = k > 0 ? tyresAt(prev.inLap, s.outLap) : { which: null, likely: false };
      return { n: k + 1, driver: driver, from: ls[0].n, to: ls[ls.length - 1].n, laps: ls.length, avg: avg(clean), best: best, clean: clean.length,
        ve: avg(ve), veLaps: ve.length, veLeft: s.inLap ? s.inLap.veLeft : ls[ls.length - 1].veLeft, pitted: !!s.inLap,
        tyres: ty.which, tyresLikely: ty.likely, inT: s.inLap ? s.inLap.t : null, outT: s.outLap ? s.outLap.t : null, lapList: ls };
    }).map(function (s, k, all) {
      // the stop after this stint: in-lap + the next out-lap against two normal laps (the average of the stints before and after it)
      var nx = all[k + 1];
      if (s.pitted && nx && s.inT && nx.outT) { var ref = avg([s.avg, nx.avg].filter(function (x) { return x > 0; })); if (ref) s.stopLoss = s.inT + nx.outT - 2 * ref; }
      return s;
    });
  }

  // what using less VE cost per lap, from this race: per driver (each against himself: two drivers have different pace) whose stints differ by 0.08 % VE a
  // lap or more, his stints with more VE against those with less (split halfway between his lowest and highest). -> { cost (s per lap for 1 % less VE per
  // lap; < 0 = lifting was not slower), groups: [{ driver, more: { stints, ve, avg }, less: { ... } }] } | null (not measurable)
  function liftCost(st) {
    var by = {}, groups = [], dt = 0, dv = 0;
    st.forEach(function (s) { if (s.avg && s.ve && s.clean >= 6 && s.veLaps >= 6 && s.driver) (by[s.driver] = by[s.driver] || []).push(s); });
    Object.keys(by).forEach(function (d) {
      var a = by[d], lo = Math.min.apply(null, a.map(function (s) { return s.ve; })), hi = Math.max.apply(null, a.map(function (s) { return s.ve; }));
      if (a.length < 2 || hi - lo < 0.08) return;
      var mid = (lo + hi) / 2, part = function (f) { var x = a.filter(f); return { stints: x.map(function (s) { return s.n; }), ve: avg(x.map(function (s) { return s.ve; })), avg: avg(x.map(function (s) { return s.avg; })) }; };
      var g = { driver: d, more: part(function (s) { return s.ve > mid; }), less: part(function (s) { return s.ve <= mid; }) };
      groups.push(g); dt += g.less.avg - g.more.avg; dv += g.more.ve - g.less.ve;
    });
    if (!groups.length || !(dv > 0)) return null;
    return { cost: dt / dv, groups: groups };
  }

  // the whole review. o = { plan (a strategy plan to compare with, optional), length ({ kind: 'time', time } race length; else the plan's, else the finish
  // time rounded down to 15 min) }
  function review(race, o) {
    o = o || {};
    var SM = P.strategyMath, st = stints(race), all = laps(race), F = [];
    if (!st.length) return null;
    var drivers = {};
    st.forEach(function (s) {
      var d = drivers[s.driver] = drivers[s.driver] || { name: s.driver, stints: 0, laps: 0, sum: 0, clean: 0, best: null, ve: 0, veLaps: 0 };
      d.stints++; d.laps += s.laps; if (s.avg) { d.sum += s.avg * s.clean; d.clean += s.clean; }
      if (s.best && (d.best === null || s.best < d.best)) d.best = s.best;
      if (s.ve) { d.ve += s.ve * s.veLaps; d.veLaps += s.veLaps; }
    });
    var dl = Object.keys(drivers).map(function (k) { var d = drivers[k]; d.avg = d.clean ? d.sum / d.clean : null; d.vePerLap = d.veLaps ? d.ve / d.veLaps : null; return d; });
    var stops = st.filter(function (s) { return s.stopLoss > 0; }), losses = stops.map(function (s) { return s.stopLoss; }), pitLoss = median(losses);
    var car = (race && race.car) || {}, finish = car.finishTime > 0 ? car.finishTime : (all.length && all[all.length - 1].et > 0 ? all[all.length - 1].et + (all[all.length - 1].t || 0) : 0);
    var length = o.length || (o.plan && o.plan.length) || (finish > 0 ? { kind: 'time', time: Math.floor(finish / 900) * 900 } : null);
    var cost = liftCost(st), full = st.filter(function (s) { return s.pitted && s.laps >= 5; });

    // ---- findings ----
    // 1. using more VE: worth it?
    var vs = st.filter(function (s) { return s.ve && s.avg && s.clean >= 6; });
    if (cost) {
      var c = cost.cost, g0 = cost.groups;
      F.push({ kind: 'info', title: c > 0.05 ? 'Using more VE was worth about ' + (c * 0.1).toFixed(2) + ' s a lap per 0.1 %' : 'Using more VE did not make you faster',
        text: g0.map(function (g) { return g.driver + ': stints ' + g.more.stints.join(', ') + ' at ' + g.more.ve.toFixed(2) + ' % a lap averaged ' + fmt(g.more.avg) + ', stints ' + g.less.stints.join(', ') + ' at ' +
          g.less.ve.toFixed(2) + ' % averaged ' + fmt(g.less.avg) + ' (' + (g.less.avg - g.more.avg >= 0 ? '' : '+') + Math.abs(g.less.avg - g.more.avg).toFixed(2) + ' s ' + (g.less.avg >= g.more.avg ? 'slower' : 'faster') + ' with less VE)'; }).join(' · ') +
          '. Tyre age, traffic and the track change too: a hint, not a measurement.' });
    }
    // 2. VE left at the stops
    var left = full.map(function (s) { return s.veLeft; }).filter(function (v) { return v >= 0; });
    if (left.length) {
      var la = avg(left), per = avg(full.map(function (s) { return s.ve; }).filter(function (v) { return v > 0; })) || 0, lapsLeft = per > 0 ? la / per : 0;
      F.push({ kind: lapsLeft >= 0.75 ? 'tip' : 'ok', title: 'VE left at the stops: ' + la.toFixed(1) + ' % on average' + (per > 0 ? ' (' + lapsLeft.toFixed(1) + ' laps)' : ''),
        text: lapsLeft >= 0.75 ? 'You came in with VE to spare: you could have used about ' + (la / Math.max(1, avg(full.map(function (s) { return s.laps; })))).toFixed(2) + ' % a lap more (push), or done a longer stint.'
          : 'Tight and right: the stints used nearly all their VE.' });
    }
    // 3. pit stops
    if (losses.length) {
      var slow = stops.filter(function (s) { return s.stopLoss > pitLoss + 15; });
      F.push({ kind: slow.length ? 'tip' : 'ok', title: stops.length + ' stops, ' + Math.round(pitLoss) + ' s each (median, in + out lap against two normal laps)',
        text: slow.length ? 'Longer: ' + slow.map(function (s) { return 'after stint ' + s.n + ' (' + Math.round(s.stopLoss) + ' s' + (st[s.n] && st[s.n].tyres ? ', ' + tyreWord(st[s.n].tyres) : '') + ')'; }).join(', ') + '.' : 'All stops about the same.' });
    }
    // 4. tyre changes
    var ch = st.filter(function (s) { return s.tyres; });
    if (ch.length) F.push({ kind: 'info', title: 'Tyres changed ' + ch.length + (ch.length === 1 ? ' time' : ' times'), text: ch.map(function (s) { return 'stint ' + s.n + ': ' + tyreWord(s.tyres) + (s.tyresLikely ? ' (likely)' : ''); }).join(' · ') +
      (st.some(function (s, i) { return i > 0 && s.tyres === null; }) ? '. Stops where a team-mate drove the in- or out-lap are not known: the file has tyre wear only for your own laps.' : '.') });
    // 5. drivers
    if (dl.length > 1) {
      var fast = dl.filter(function (d) { return d.avg; }).sort(function (a, b) { return a.avg - b.avg; });
      if (fast.length > 1) F.push({ kind: 'info', title: fast[0].name + ' was ' + (fast[1].avg - fast[0].avg).toFixed(2) + ' s a lap faster on average', text: fast.map(function (d) { return d.name + ': ' + fmt(d.avg) + ' average, best ' + fmt(d.best) + ', ' + (d.vePerLap ? d.vePerLap.toFixed(2) + ' % VE a lap' : ''); }).join(' · ') });
    }

    // ---- what if: the race again with this race's own numbers (pace = the average clean lap, VE per lap = the most a stint used, pit stop = the median) ----
    var pace = avg(vs.map(function (s) { return s.avg; })), rate = vs.length ? Math.max.apply(null, vs.map(function (s) { return s.ve; })) : null, whatIf = null;
    if (SM && pace && rate && pitLoss && length) {
      whatIf = SM.stintOptions({ pace: pace, rate: rate, cost: cost && cost.cost > 0 ? cost.cost : null }, { max: 100, reserve: 0, pitLoss: pitLoss, length: length });
      var did = Math.round(median(full.map(function (s) { return s.laps; })) || 0);
      whatIf.did = did; whatIf.pace = pace; whatIf.rate = rate; whatIf.costKnown = !!(cost && cost.cost > 0);
      var b = whatIf.best, mine = whatIf.options.filter(function (x) { return x.laps === did; })[0];
      if (b && mine && b.laps !== mine.laps) F.push({ kind: 'tip', title: 'Worth trying: ' + b.laps + ' laps a stint instead of ' + did,
        text: (b.raceLaps > mine.raceLaps ? '+' + (b.raceLaps - mine.raceLaps) + ' laps' : b.stops < mine.stops ? (mine.stops - b.stops) + ' stop less' : 'same laps, earlier finish') + ' with this race\'s numbers (' + b.perLap.toFixed(2) + ' % VE a lap' + (b.save > 0 ? ', lifting ' + b.save.toFixed(2) + ' %' : ', no lifting') + ').' });
      else if (b && mine) F.push({ kind: 'ok', title: 'Your stint length (' + did + ' laps) was the best for this race', text: 'With this race\'s pace, VE use and pit stop time no other stint length gives more laps.' });
    }

    // ---- the plan against what happened ----
    var vsPlan = null;
    if (o.plan && SM) {
      var pr = SM.build(o.plan);
      vsPlan = { plan: pr, stints: st.map(function (s, i) { var p = pr.stints[i]; return { real: s, plan: p || null }; }), laps: { real: all.length ? all[all.length - 1].n : 0, plan: pr.laps }, stops: { real: st.length - 1, plan: pr.stops } };
      var dLaps = vsPlan.laps.real - vsPlan.laps.plan;
      F.unshift({ kind: dLaps >= 0 ? 'ok' : 'tip', title: 'Against the plan "' + (o.plan.name || '') + '": ' + (dLaps === 0 ? 'the same ' + vsPlan.laps.real + ' laps' : (dLaps > 0 ? '+' : '') + dLaps + ' laps (' + vsPlan.laps.real + ' driven, ' + vsPlan.laps.plan + ' planned)'),
        text: (vsPlan.stops.real === vsPlan.stops.plan ? 'Stops as planned (' + vsPlan.stops.real + ').' : vsPlan.stops.real + ' stops instead of ' + vsPlan.stops.plan + '.') + ' ' +
          o.plan.drivers.map(function (pd) { var d = dl.filter(function (x) { return SM.sameDriver ? SM.sameDriver(x.name, pd.name) : x.name === pd.name; })[0]; return d && d.avg ? pd.name + ': ' + fmt(d.avg) + ' driven, ' + fmt(pd.lap) + ' planned' : ''; }).filter(Boolean).join(' · ') });
    }
    return { stints: st, drivers: dl, pitLoss: pitLoss, cost: cost, findings: F, whatIf: whatIf, vsPlan: vsPlan, length: length, laps: all.length ? all[all.length - 1].n : 0, finish: finish, car: car };
  }

  function tyreWord(w) { return !w ? 'no tyres' : w === 'FL FR RL RR' ? 'all 4 tyres' : w === 'FL FR' ? 'front tyres' : w === 'RL RR' ? 'rear tyres' : 'tyres ' + w; }
  function fmt(s) { if (!(s > 0)) return '--'; var m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3); }

  P.reviewMath = { laps: laps, stints: stints, liftCost: liftCost, review: review, tyreWord: tyreWord };
  if (typeof module !== 'undefined') module.exports = P.reviewMath;
})(typeof window !== 'undefined' ? window : globalThis);
