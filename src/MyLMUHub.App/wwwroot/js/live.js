// Strategy tab "Live" (owner 2026-11-12): follows the race you are in with a plan you pick here; the plan itself is never changed (strategy.json is only read).
// What happened (api/race-live: StintTracker's log) + the rest planned again from now (strategy-math build(plan, live)), with the drivers' pace from this
// race (livePace) and, in 'VE per lap' plans, your VE use now. Status bar: will the VE last to the planned stop at this stint's average use (veCheck:
// push / on target / lift a little / lift; owner 2026-11-14: not red for one lap a bit over). Per stint: its average and fastest lap, its VE per lap. "Lifting: still worth it?": the rest of the race as planned against no lifting (VE per lap = your use without lifting).
// The choice (plan, options) and the VE target now go to api/strategy-live (strategy-live.json): the fuel widget takes the target as its goal.
(function (root) {
  'use strict';
  var P = root.MyLMUHub, H = P.hub, F = P.format, SM = P.strategyMath, R = P.paceRef, esc = H.esc;
  var $ = function (id) { return document.getElementById(id); };
  H.header('strategy');
  if (H.inApp) H.json('api/pace?light=1').then(function (i) { H.setWho(i.names && i.names[0]); }, function () {});
  var COLORS = ['#C8F24A', '#5AA9FF', '#FF8A3D', '#B47CFF', '#35D0E3', '#FFD21F'];
  var liveUse = -1, plans = [], opt = { plan: '', pace: 'live', natural: null }, raceLive = null, L = { status: 'off' }, lastKey = '', sentTarget = '';

  function plan() { return plans.filter(function (p) { return p.id === opt.plan; })[0] || null; }
  // the file is shared with the race alerts (accepted stint length): read it, change our part, write it
  // setPlan: only when you pick the plan here (else the choice made on the hub's Race Control page stays)
  function saveOpt(target, setPlan) {
    if (!H.inApp) return;
    H.json('api/strategy-live').catch(function () { return {}; }).then(function (o) {
      o = o || {}; if (setPlan) o.plan = opt.plan; else opt.plan = o.plan || ''; o.pace = opt.pace; o.natural = opt.natural; o.target = target || null;
      if (o.accepted && o.accepted.plan !== opt.plan) delete o.accepted; opt.accepted = o.accepted || null;
      fetch('api/strategy-live', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
    });
  }
  function trackMatches(p) {
    if (!p || !p.track || !L.track) return true;
    var n = R.trackName(L.track, '') || L.track;
    return n === p.track || p.track.indexOf(n) === 0 || n.indexOf(p.track) === 0;
  }
  function tile(k, v, n, cls) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="n">' + (n || '') + '</div></div>'; }

  // the plan as it stands live: drivers' pace from this race, VE per lap from your use now ('VE per lap' plans)
  // the live plan (alerts-math livePlan): this race's pace, your VE use, the stint length you accepted from a race alert
  function livePlan(p) {
    var acc = opt.accepted && opt.accepted.plan === p.id ? opt.accepted.laps : 0;
    return { plan: P.alertsMath.livePlan(p, raceLive, { pace: opt.pace, accepted: acc }), pace: SM.livePace(raceLive), use: raceLive && raceLive.car ? raceLive.car.veUse : -1, accepted: acc };
  }

  function render() {
    var p = plan();
    $('planSel').innerHTML = '<option value="">Pick the plan for this race</option>' + plans.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x === p ? ' selected' : '') + '>' + esc(x.name || 'Unnamed') + '</option>'; }).join('');
    if (!p) { status('idle', 'NO PLAN', plans.length ? 'Pick the plan for this race (top right).' : 'Make a plan first (Endurance plan).', ''); return; }
    var on = (L.status === 'live' || L.status === 'over') && trackMatches(p), lp = livePlan(p), q = on ? lp.plan : p;
    var r = on ? SM.build(q, L) : SM.build(p), pure = SM.build(p);
    // ---- status bar ----
    var target = null; liveUse = -1;
    if (!H.inApp) status('idle', 'PLAN ONLY', 'Open this page in the app to follow a race.', '');
    else if (L.status === 'off') status('idle', 'NOT LIVE', 'Start Le Mans Ultimate: this page follows the race from the green flag.', '');
    else if (L.status === 'waiting') status('wait', 'WAITING', F.sessionName(L.session) + (L.endsIn >= 0 ? ' ends in ' + F.clock(L.endsIn) : '') + (L.track ? ' · ' + L.track : ''), 'Following starts at the green flag of the race.');
    else if (L.status === 'grid') status('wait', 'ON THE GRID', 'Waiting for the green flag' + (L.track ? ' · ' + L.track : ''), '');
    else if (!trackMatches(p)) status('wait', 'OTHER TRACK', 'The race is at ' + L.track + '; the plan "' + (p.name || '') + '" is for ' + p.track + '.', 'Pick a plan for this track.');
    else {
      var now = r.stints.filter(function (s) { return s.state === 'now'; })[0], drvLap = now ? now.lap : (q.drivers[0] || {}).lap;
      var t = SM.liveTarget(q, L, drvLap), nums = [];
      // your usual VE use: this stint's average per lap once it has 2 laps, else the last 5 laps (the dashboard), else the previous stint's
      var cs = L.current ? SM.stintStats(L.current.lapLog, L.current.veStart) : null, ps = L.stints.length ? L.stints[L.stints.length - 1] : null, prevSt = ps ? SM.stintStats(ps.lapLog, ps.veStart) : null;
      var use = liveUse = cs && cs.veLaps >= 2 ? cs.ve : lp.use > 0 ? lp.use : prevSt && prevSt.ve ? prevSt.ve : -1, useLbl = cs && cs.veLaps >= 2 ? 'Your use (this stint)' : 'Your use (5 laps)';
      nums.push(['Race time', F.clock(L.time)], ['Lap', String((raceLive.car ? raceLive.car.laps : 0) + 1)], ['Stint', (L.stints.length + (L.current ? 1 : 0)) + ' of ' + r.stints.length]);
      if (L.status === 'over') status('ok', 'FINISHED', r.laps + ' laps', '', nums);
      else if (L.inPit) {
        var next = r.stints.filter(function (s) { return s.state === 'plan'; })[0];
        status('wait', 'IN THE PIT', next ? 'Next: ' + next.driver + ', ' + next.laps + ' laps' + (next.fill ? ' · fill ' + F.pct(next.fill.mode === 'push' ? next.fill.push : next.fill.save, 0) : '') : '', '', nums);
      } else if (t && t.target > 0) {
        target = t.target;
        // will it last? the VE now against the laps to go at your usual use (veCheck): push / on target / lift a little / lift
        var vc = SM.veCheck(t, use, q.ve.reserve), cls = !vc ? 'live' : vc.level === 'over' ? 'over' : vc.level === 'close' ? 'close' : 'ok';
        var head = !vc ? 'LIVE' : vc.level === 'push' ? 'YOU CAN PUSH: +' + F.pct(vc.room, 2) + ' A LAP' : vc.level === 'ok' ? 'ON TARGET' :
          vc.level === 'close' ? 'LIFT A LITTLE: ' + F.pct(-vc.room, 2) + ' A LAP' : 'LIFT: SAVE ' + F.pct(-vc.room, 2) + ' A LAP';
        var whereTo = t.finish ? 'the flag' : 'the stop';
        var why = !vc ? 'Your VE use per lap is not known yet.' : vc.spare >= 0 ? 'At this use you reach ' + whereTo + ' with ' + F.pct(vc.spare, 1) + ' VE spare (' + vc.spareLaps.toFixed(1) + ' laps).'
          : 'At this use you are ' + F.pct(-vc.spare, 1) + ' VE short of ' + whereTo + ' (' + (-vc.spareLaps).toFixed(1) + ' laps).';
        nums.push(['VE now', F.pct(t.veNow >= 0 ? t.veNow : t.ve, 1)], [useLbl, use > 0 ? F.pct(use, 2) : '--'], ['Allowed per lap', vc ? F.pct(vc.need, 2) : F.pct(t.target, 2)],
          [t.finish ? 'To the finish' : 'Pit in', t.left + (t.left === 1 ? ' lap' : ' laps') + (t.pitLap ? ' (end of lap ' + t.pitLap + ')' : '') + (now && localAt(now.end) ? ' · ~' + localAt(now.end) : '')]);
        status(cls, head, (liveDriver() || '?') + (L.entry ? ' · ' + L.entry : ''), why + (t.finish ? ' Last stint.' : (q.ve.reserve ? ' Keeps ' + q.ve.reserve + ' reserve ' + (q.ve.reserve === 1 ? 'lap.' : 'laps.') : '')), nums);
      } else status('live', 'LIVE', (liveDriver() || '?') + (L.entry ? ' · ' + L.entry : ''), 'No VE target: set the VE per lap or laps per stint in the plan.', nums);
    }
    var tk = target ? target.toFixed(2) + '|' + L.track : '';
    if (tk !== sentTarget) { sentTarget = tk; saveOpt(target ? { perLap: Math.round(target * 100) / 100, track: L.track, at: Date.now() } : null); }
    // ---- the live race-pace cards and the possible changes to the plan ----
    stintCard(on, r); dmgCard(on, q, r); drvCard(on, q); optCard(on, q, r, liveUse);
    // ---- the race: done (green), now (lime), the rest ----
    $('raceSub').textContent = on ? 'Live: what happened, and the rest planned again from now' + (opt.pace === 'live' && Object.keys(lp.pace).length ? ' with the lap times of this race' : '') + '.' +
      (L.raceEnd ? ' The race ends when the leader' + (L.leader && L.leader.me ? ' (you)' : L.leader ? ' (' + (L.leader.driver || '?') + (L.leader.cls ? ', ' + L.leader.cls : '') + ')' : '') + ' crosses the line after the time: about ' +
        F.clock(L.raceEnd) + ' race time at their pace now; you finish at your next line after that.' : '') : 'The plan (not live).';
    $('raceInfo').textContent = on && r.laps !== pure.laps ? (r.laps > pure.laps ? 'Ahead of the plan by ' : 'Behind the plan by ') + Math.abs(r.laps - pure.laps) + ' laps (' + r.laps + ' expected, plan ' + pure.laps + ')' : on ? 'On plan: ' + r.laps + ' laps expected' : '';
    $('sumTiles').innerHTML = tile('Stints', r.stints.length, r.stints.filter(function (s) { return s.state === 'done'; }).length + ' done') + tile('Pit stops', r.stops, '') +
      tile('Laps', r.laps || '--', 'expected at the finish') + tile('Finish', F.clock(r.end), 'race time') +
      q.drivers.map(function (d) { var x = r.drivers[d.name], pc = SM.paceOf(lp.pace, d.name), bst = on ? driverBest(d.name) : null;
        return x ? tile(d.name || 'Driver', F.hm(x.time), x.stints + ' stints · ' + (pc > 0 && on ? 'avg ' + F.lap(pc) + (bst ? ' · best ' + F.lap(bst) : '') : 'plan ' + F.lap(d.lap))) : ''; }).join('');
    $('warn').innerHTML = r.warnings.map(function (w) { return '<div class="warnbox">' + esc(w) + '</div>'; }).join('');
    $('timeline').innerHTML = r.stints.map(function (s) {
      var w = (s.end - s.start + (s.stop ? s.stop.loss : 0)) / r.end * 100, bg = s.state === 'done' ? 'var(--green)' : s.state === 'now' ? 'var(--lime)' : 'var(--tile2)';
      return '<div style="width:' + w.toFixed(3) + '%;background:' + bg + '" title="Stint ' + s.n + ': ' + esc(s.driver) + ', ' + s.laps + ' laps">' + (w > 3 ? s.n : '') + '</div>';
    }).join('');
    $('stintTbl').innerHTML = '<thead><tr><th class="num">#</th><th>Driver</th><th class="num">Laps</th><th class="num">Start</th><th class="num">End</th><th class="num">Your time</th><th class="num">Lap time</th><th class="num">VE / lap</th><th>Stop after</th></tr></thead><tbody>' +
      r.stints.map(function (s, i) {
        // a stint that happened / is happening: its own average (clean laps) and fastest lap, its real VE per lap
        var real = on ? (i < L.stints.length ? L.stints[i] : i === L.stints.length ? L.current : null) : null, st = real ? SM.stintStats(real.lapLog, real.veStart) : null;
        var lapCell = st && st.avg ? F.lap(st.avg) + '<span class="two">best ' + F.lap(st.best) + '</span>' : F.lap(s.lap);
        var veCell = st && st.ve ? F.pct(st.ve, 2) + '<span class="two">used a lap</span>' : s.state === 'done' ? '<span class="faint">--</span>' : s.fill ? F.pct(s.veNeed, 2) + '<span class="two">fill ' + F.pct(s.fill.mode === 'push' ? s.fill.push : s.fill.save, 0) + '</span>' : s.veNeed ? F.pct(s.veNeed, 2) : '--';
        var tag = s.state === 'done' ? '<span class="chip ok">DONE</span>' : s.state === 'now' ? '<span class="chip lime">NOW</span>' : '';
        var mine = on && s.state !== 'done' && L.status === 'live' ? localAt(s.end) : '', mineCell = mine ? '~' + mine + '<span class="two">' + (s.stop ? 'pit in' : 'finish') + '</span>' : '<span class="faint">--</span>';
        var laps = s.state === 'now' && L.current ? L.current.laps + ' / ' + s.laps : String(s.laps);
        return '<tr class="ls-' + (s.state || 'plan') + '"><td class="num">' + s.n + '</td><td><span class="dot" style="background:' + COLORS[q.drivers.map(function (d) { return d.name; }).indexOf(s.driver) % COLORS.length] + '"></span>' + esc(s.driver) + ' ' + tag + '</td>' +
          '<td class="num">' + laps + '<span class="two">' + s.fromLap + '-' + s.toLap + '</span></td><td class="num">' + F.clock(s.start) + '</td><td class="num">' + F.clock(s.end) + '</td><td class="num">' + mineCell + '</td><td class="num">' + lapCell + '</td>' +
          '<td class="num">' + veCell + '</td>' +
          '<td>' + (s.stop ? Math.round(s.stop.loss) + ' s' + (s.stop.real ? ' (real)' : '') + (s.stop.tyres ? ' · ' + tyreWord(s.stop.which) : '') + (s.stop.swap ? ' · swap to ' + esc(s.stop.next) : '') : '<span class="faint">finish</span>') + '</td></tr>';
      }).join('') + '</tbody>';
  }
  // your local clock at a race time still to come (owner 2026-11-15: when to be at the computer for a stop); a time on another day gets the day
  function localAt(raceT) {
    if (!(raceT >= 0) || !(L.time >= 0)) return '';
    var ms = Date.now() + (raceT - L.time) * 1000, d = new Date(ms), t = F.hhmm(d.getHours(), d.getMinutes());
    return new Date().toDateString() === d.toDateString() ? t : F.wallClock(ms);
  }
  // which tyres were changed at a stop: all four, the fronts, the rears, or the wheels by name
  function tyreWord(w) {
    if (typeof w !== 'string' || !w) return 'tyres';
    return w === 'FL FR RL RR' ? 'all 4 tyres' : w === 'FL FR' ? 'front tyres' : w === 'RL RR' ? 'rear tyres' : 'tyres ' + w;
  }
  // a driver's fastest clean lap in this race (all his stints)
  function driverBest(name) {
    var b = null;
    (L.stints || []).concat(L.current ? [L.current] : []).forEach(function (x) { if (!SM.sameDriver(x.driver, name)) return; var st = SM.stintStats(x.lapLog, x.veStart); if (st.best && (!b || st.best < b)) b = st.best; });
    return b;
  }
  function liveDriver() { return L.driver || (L.current && L.current.driver) || ''; }
  function status(cls, chip, main, sub, nums) {
    $('stat').className = 'lstat ' + cls; $('statChip').textContent = chip; $('statMain').textContent = main; $('statSub').textContent = sub || '';
    $('statNums').innerHTML = (nums || []).map(function (n) { return '<div><span>' + esc(n[0]) + '</span><b>' + esc(n[1]) + '</b></div>'; }).join('');
  }

  // ---- the live race-pace screen (owner 2026-11-14: "a live race pace screen + the possible changes to the plan") ----
  function stintsSoFar() { return (L.stints || []).concat(L.current ? [L.current] : []); }
  // VE used on each lap of a stint's lap log (from the VE at the line before it; the stint's start VE for its first lap), null = not known
  function lapUse(x) {
    var prev = x.veStart >= 0 ? x.veStart : null;
    return (x.lapLog || []).map(function (l) { var u = l[2] >= 0 && prev !== null && prev - l[2] > 0 && prev - l[2] < 50 ? prev - l[2] : null; if (l[2] >= 0) prev = l[2]; return u; });
  }
  function signed(v) { return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(3); }

  // THIS STINT: last lap, the stint's average and fastest lap, the driver's best in this race, VE per lap, and every lap of the stint
  function stintCard(on, r) {
    var list = stintsSoFar(), x = L.current || list[list.length - 1];
    $('stintCard').hidden = !(on && x);
    if ($('stintCard').hidden) return;
    var k = list.indexOf(x), st = SM.stintStats(x.lapLog, x.veStart), uses = lapUse(x), log = x.lapLog || [], planned = r.stints[k] ? r.stints[k].laps : null;
    var lastI = -1; for (var i = log.length - 1; i >= 0; i--) if (log[i][1] > 0) { lastI = i; break; }
    var last = lastI >= 0 ? log[lastI][1] : null, bestI = -1;
    log.forEach(function (l, i) { if (!l[3] && l[1] > 0 && l[1] === st.best) bestI = i; });
    var lastUse = null; for (i = uses.length - 1; i >= 0; i--) if (uses[i] !== null && !log[i][3]) { lastUse = uses[i]; break; }
    var veNow = x === L.current && x.ve >= 0 ? x.ve : null, dBest = driverBest(x.driver);
    $('stintInfo').textContent = (x === L.current ? 'Stint ' + (k + 1) + ', now' : 'Stint ' + (k + 1) + ' (in the pit now)') + (log.length ? '' : ' · lap times come in from the first lap the app sees');
    $('stintTiles').innerHTML =
      tile('Driver', esc(x.driver || '?'), 'stint ' + (k + 1)) +
      tile('Laps', x.laps + (planned ? ' / ' + planned : ''), planned && x === L.current ? Math.max(0, planned - x.laps) + ' to the planned stop' : '') +
      tile('Last lap', last ? F.lap(last) : '--', last && st.avg ? signed(last - st.avg) + ' vs the stint average' : '') +
      tile('Stint average', st.avg ? F.lap(st.avg) : '--', st.clean ? st.clean + ' clean laps' : 'no clean laps yet') +
      tile('Fastest this stint', st.best ? F.lap(st.best) : '--', bestI >= 0 ? 'lap ' + log[bestI][0] : '', 'purple') +
      tile('Best in this race', dBest ? F.lap(dBest) : '--', esc(x.driver || '')) +
      tile('VE per lap', st.ve ? F.pct(st.ve, 2) : '--', lastUse !== null ? 'last lap ' + F.pct(lastUse, 2) : 'this stint') +
      tile('VE left', veNow !== null ? F.pct(veNow, 1) : '--', veNow !== null && st.ve ? (veNow / st.ve).toFixed(1) + ' laps at this use' : '');
    // every lap of the stint, the newest on top: time, against the stint average, VE used; the fastest in purple
    var rows = log.map(function (l, i) {
      var t = l[1], d = t > 0 && st.avg && !l[3] ? t - st.avg : null, note = l[3] ? (i === 0 && k > 0 ? 'out lap' : 'in / out lap') : t > 0 && st.avg && t > st.avg * 1.07 ? 'slow (left out)' : '';
      return '<tr><td class="num">' + l[0] + '</td><td class="num"' + (i === bestI ? ' style="color:var(--purple);font-weight:700"' : '') + '>' + (t > 0 ? F.lap(t) : '--') + '</td>' +
        '<td class="num"' + (d !== null ? ' style="color:var(' + (d <= 0 ? '--green' : '--red') + ')"' : '') + '>' + (d !== null && !note ? signed(d) : '') + '</td>' +
        '<td class="num">' + (uses[i] !== null ? F.pct(uses[i], 2) : '--') + '</td><td class="num">' + (l[4] > 0 ? Math.round(l[4]) : '--') + '</td><td class="faint">' + note + '</td></tr>';
    }).reverse();
    $('lapTbl').innerHTML = '<thead><tr><th class="num">Lap</th><th class="num">Time</th><th class="num">vs average</th><th class="num">VE used</th><th class="num" title="km/h on the longest straight, flat out (learned point)">Top speed</th><th></th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="6" class="faint">No laps yet.</td></tr>') + '</tbody>';
  }

  // DAMAGE: top speed now against the car's healthy speed in this race (the game freezes a team-mate's aero damage while you spectate), the lap time it costs,
  // and whether a repair at the next stop (or an extra stop in the last stint) earns its time back (strategy-math damageCheck)
  function dmgCard(on, q, r) {
    var all = stintsSoFar(), now = r.stints.filter(function (s) { return s.state === 'now'; })[0], idx = now ? r.stints.indexOf(now) : -1, last = !!now && idx === r.stints.length - 1;
    var lapNow = L.current ? num(L.current.startLap) + L.current.laps : 0;
    var real = r.stints.filter(function (s) { return s.stop && s.stop.real; }).map(function (s) { return s.stop.loss; });
    var pitLoss = real.length ? P.paceMath.median(real) : num(q.pit && q.pit.base);
    var dc = on && L.status === 'live' && now ? SM.damageCheck(all, { deg: q.tyreDeg, damage: raceLive && raceLive.damage, lapsAfterStop: r.laps - now.toLap, lapsLeft: r.laps - lapNow, lastStint: last, pitLoss: pitLoss }) : null;
    var show = !!dc && ((dc.drop !== null && dc.drop >= 3) || (dc.aero !== null && dc.aeroLive && dc.aero < 0.97));
    $('dmgCard').hidden = !show; if (!show) return;
    var v = dc.worth === true ? '<b style="font-size:16px;color:var(--red)">' + (dc.extraStop ? 'WORTH AN EXTRA STOP TO REPAIR' : 'REPAIR AT THE NEXT STOP') + '</b>'
      : dc.worth === false ? '<b class="green" style="font-size:16px">NOT WORTH A REPAIR</b>' : '<b style="font-size:16px;color:var(--yellow)">WATCH IT</b>';
    var why = dc.lapLoss > 0.05 ? ' · ' + (dc.lapHow === 'guess' ? 'about ' : '') + dc.lapLoss.toFixed(2) + ' s a lap × ' + (dc.extraStop ? (r.laps - lapNow) + ' laps left' : (r.laps - now.toLap) + ' laps after the stop') +
        ' = ' + Math.round(dc.gain) + ' s; the repair costs ' + Math.round(dc.cost) + ' s' + (dc.breakEven ? ' (earned back in ' + dc.breakEven + ' laps)' : '')
      : dc.drop >= 3 ? ' · the lap time it costs is not known yet (needs 3 clean laps after the drop)' : '';
    $('dmgVerdict').innerHTML = v + '<span class="faint">' + why + '</span>';
    $('dmgInfo').textContent = dc.since ? 'since lap ' + dc.since : '';
    var d = raceLive && raceLive.damage;
    $('dmgTiles').innerHTML =
      tile('Top speed now', dc.now ? Math.round(dc.now) + ' km/h' : '--', 'last 5 laps') +
      tile('Healthy', dc.healthy ? Math.round(dc.healthy) + ' km/h' : '--', 'best 5 laps of this race') +
      tile('Down', dc.drop !== null ? '−' + dc.drop.toFixed(1) + ' km/h' : '--', dc.since ? 'since lap ' + dc.since : '', dc.drop >= 3 ? 'red' : '') +
      tile('Lap time lost', dc.lapLoss !== null ? (dc.lapHow === 'guess' ? '≈ ' : '') + '+' + dc.lapLoss.toFixed(2) + ' s' : '--', dc.lapHow === 'measured' ? 'same driver, before and after' : dc.lapHow === 'guess' ? 'rough guess from the speed' : '') +
      tile('Aero', dc.aero !== null && dc.aeroLive ? Math.round(dc.aero * 100) + ' %' : '--', dc.aeroLive ? 'from the game (you drive)' : 'the game does not show it while spectating') +
      tile('Repair', Math.round(dc.cost) + ' s', dc.extraStop ? 'extra stop + repair' : 'added to the stop');
    $('dmgSub').textContent = 'Top speed: taken every lap at the same point on the longest straight, flat out, so lifting before the braking point does not change it; a tow can, so the median of 5 laps is used. ' +
      'Repair time from the game: ' + (d && d.fixAero > 0 ? d.fixAero + ' s + up to ' + d.fixRandom + ' s random' : '30 s + up to 5 s random (not read yet)') + '.';
  }

  // DRIVERS: per driver in this race: stints, laps, drive time, average and fastest lap, VE per lap
  function drvCard(on, q) {
    var list = stintsSoFar(), names = [];
    q.drivers.forEach(function (d) { names.push(d.name); });
    list.forEach(function (x) { if (x.driver && x.driver !== SM.BEFORE && !names.some(function (n) { return SM.sameDriver(n, x.driver); })) names.push(x.driver); });
    $('drvCard').hidden = !(on && list.length);
    if ($('drvCard').hidden) return;
    var rows = names.map(function (n) {
      var mine = list.filter(function (x) { return SM.sameDriver(x.driver, n); }), laps = 0, time = 0, sum = 0, cnt = 0, best = null, ve = 0, veN = 0;
      mine.forEach(function (x) {
        laps += x.laps; time += (x.end >= 0 ? x.end : L.time) - x.start;
        var st = SM.stintStats(x.lapLog, x.veStart);
        if (st.avg) { sum += st.avg * st.clean; cnt += st.clean; }
        if (st.best && (!best || st.best < best)) best = st.best;
        if (st.ve) { ve += st.ve * st.veLaps; veN += st.veLaps; }
      });
      return '<tr><td>' + esc(n) + '</td><td class="num">' + mine.length + '</td><td class="num">' + laps + '</td><td class="num">' + (time > 0 ? F.hm(time) : '--') + '</td>' +
        '<td class="num">' + (cnt ? F.lap(sum / cnt) : '--') + '</td><td class="num" style="color:var(--purple)">' + (best ? F.lap(best) : '--') + '</td><td class="num">' + (veN ? F.pct(ve / veN, 2) : '--') + '</td></tr>';
    });
    $('drvTbl').innerHTML = '<thead><tr><th>Driver</th><th class="num">Stints</th><th class="num">Laps</th><th class="num">Drive time</th><th class="num">Average lap</th><th class="num">Fastest</th><th class="num">VE per lap</th></tr></thead><tbody>' + rows.join('') + '</tbody>';
  }

  // CHANGES TO THE PLAN: the rest of the race from now for stint lengths around the one you follow (alerts-math restOptions): the VE per lap each allows
  // against your use now (push / lift), stops left, laps at the finish; the best marked. Your VE without lifting: typed, else the highest stint average of
  // this race (5+ laps), else your use now. What lifting costs per lap: the plan's (Strategy, from your sessions), else not known (then: the best without extra lifting).
  function optCard(on, q, r, use) {
    $('optCard').hidden = !(on && L.status === 'live');
    if ($('optCard').hidden) return;
    if (document.activeElement !== $('naturalIn')) $('naturalIn').value = opt.natural > 0 ? opt.natural : '';
    $('paceSel').value = opt.pace;
    var hi = 0; stintsSoFar().forEach(function (x) { var st = SM.stintStats(x.lapLog, x.veStart); if (st.ve && st.veLaps >= 5 && st.ve > hi) hi = st.ve; });
    var nat = opt.natural > 0 ? opt.natural : hi > 0 ? hi : use > 0 ? use : 0, natWhy = opt.natural > 0 ? 'typed' : hi > 0 ? 'your highest stint average in this race' : 'your use now';
    var p0 = plan(), cost = p0 && p0.from && p0.from.cost > 0 ? p0.from.cost : null;
    var ro = SM.stintLaps(q.ve) < Infinity ? P.alertsMath.restOptions(q, L, { natural: nat, cost: cost }) : null;
    if (!ro) { $('optSub').textContent = 'Needs a plan with a stint length or a VE per lap.'; $('optTbl').innerHTML = ''; return; }
    // the best: what lifting costs known = restOptions' pick (laps, then the earliest finish). Not known: the most laps at the finish, then the fewest stops,
    // then the least change from your use now (owner 2026-11-14: 'no lifting at all' as best gave a lap less and a stop more)
    var now = ro.now, b = ro.best, done = L.stints.length, chosen = !!(opt.accepted && p0 && opt.accepted.plan === p0.id);
    if (cost === null) b = ro.options.slice().sort(function (x, y) { return y.raceLaps - x.raceLaps || x.stops - y.stops || (use > 0 ? Math.abs(x.perLap - use) - Math.abs(y.perLap - use) : 0); })[0];
    var verdict = !now || !b || b.laps === now.laps ? '<b class="green" style="font-size:16px">Keep the plan</b> · ' + (now ? now.laps + ' laps a stint is the best for the rest of the race.' : '')
      : '<b style="font-size:16px;color:var(--yellow)">Change to ' + b.laps + ' laps a stint</b> · ' + (b.perLap > now.perLap ? 'push: ' + F.pct(b.perLap, 2) + ' a lap instead of ' + F.pct(now.perLap, 2) : 'lift: ' + F.pct(b.perLap, 2) + ' a lap instead of ' + F.pct(now.perLap, 2)) +
        ' · ' + (b.stops < now.stops ? (now.stops - b.stops) + ' stop' + (now.stops - b.stops === 1 ? '' : 's') + ' less' : b.stops > now.stops ? (b.stops - now.stops) + ' stop' + (b.stops - now.stops === 1 ? '' : 's') + ' more' : 'same stops') +
        (b.raceLaps !== now.raceLaps ? ', ' + (b.raceLaps > now.raceLaps ? '+' : '') + (b.raceLaps - now.raceLaps) + (Math.abs(b.raceLaps - now.raceLaps) === 1 ? ' lap' : ' laps') + ' at the finish' : '') + (cost === null ? '' : ', finish ' + signed(b.end - now.end).replace(/\.(\d)\d\d$/, '.$1') + ' s');
    $('optSub').innerHTML = verdict + '<div class="faint" style="margin-top:6px">' + (cost === null
      ? 'Best = the most laps at the finish, then the fewest stops, then the least change from your use now (' + (use > 0 ? F.pct(use, 2) : '--') + ' a lap). Lifting more costs lap time; how much is not known yet (Strategy: start from a normal and a saving session).'
      : 'Best = the most laps, then the earliest finish. Lifting costs ' + cost.toFixed(2) + ' s per lap for 1 % less VE (from your plan); your VE per lap without lifting: ' + (nat > 0 ? F.pct(nat, 2) + ' (' + natWhy + ')' : 'not known') + '.') + '</div>';
    if (chosen) $('optSub').innerHTML = '<div style="margin-bottom:6px">You chose <b>' + opt.accepted.laps + ' laps a stint</b> (' + (now ? F.pct(now.perLap, 2) + ' a lap' : '') + '): the status bar, the stints below and the fuel widget follow it.</div>' + $('optSub').innerHTML;
    $('natField').hidden = cost === null;
    $('optTbl').innerHTML = '<thead><tr><th class="num">Laps a stint</th><th class="num">VE per lap allowed</th><th class="num">Against your use now</th><th class="num">Stops left</th><th class="num">Laps at the finish</th><th class="num">Finish</th><th></th></tr></thead><tbody>' +
      ro.options.map(function (o) {
        var diff = use > 0 ? o.perLap - use : null, tag = (now && o.laps === now.laps ? '<span class="chip lime">' + (chosen ? 'CHOSEN' : 'NOW') + '</span> ' : '') + (o === b ? '<span class="chip ok">BEST</span> ' : '') +
          (now && o.laps === now.laps ? (chosen ? '<button class="btn" style="padding:3px 10px;font-size:12px" data-laps="0">Back to the plan</button>' : '') : '<button class="btn" style="padding:3px 10px;font-size:12px" data-laps="' + o.laps + '">Use this</button>');
        return '<tr' + (o === b ? ' class="ls-now"' : '') + '><td class="num">' + o.laps + '</td><td class="num">' + F.pct(o.perLap, 2) + '</td>' +
          '<td class="num"' + (diff !== null ? ' style="color:var(' + (diff >= 0 ? '--green' : '--red') + ')"' : '') + '>' + (diff === null ? '--' : diff >= 0 ? 'push +' + F.pct(diff, 2) : 'lift ' + F.pct(-diff, 2)) + '</td>' +
          '<td class="num">' + Math.max(0, o.stops - done) + '</td><td class="num">' + o.raceLaps + '</td>' +
          '<td class="num">' + F.clock(o.end) + '</td><td>' + tag + '</td></tr>';
      }).join('') + '</tbody>';
  }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  // pick a stint length from CHANGES TO THE PLAN (owner 2026-11-15): the live plan, the status bar and the fuel widget follow it; null = back to the plan
  function choose(laps) {
    var p = plan(); if (!p || !H.inApp) return;
    opt.accepted = laps > 0 ? { plan: p.id, laps: laps, at: Date.now() } : null; sentTarget = ''; lastKey = '';
    H.json('api/strategy-live').catch(function () { return {}; }).then(function (o) {
      o = o || {}; if (opt.accepted) o.accepted = opt.accepted; else delete o.accepted;
      return fetch('api/strategy-live', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
    }).then(render, render);
  }
  $('optTbl').onclick = function (e) { var b = e.target.closest && e.target.closest('[data-laps]'); if (b) choose(Number(b.getAttribute('data-laps'))); };

  $('planSel').onchange = function () { opt.plan = this.value; saveOpt(null, true); sentTarget = ''; render(); };
  $('naturalIn').onchange = function () { var v = Number(String(this.value).replace(',', '.')); opt.natural = v > 0 ? v : null; saveOpt(null); sentTarget = ''; render(); };
  $('paceSel').onchange = function () { opt.pace = this.value; saveOpt(null); sentTarget = ''; render(); };

  var polls = 0;
  function poll() {
    if (++polls % 5 === 0) H.json('api/strategy-live').then(function (o) {                              // the plan may be picked on the hub page meanwhile
      o = o || {}; var acc = o.accepted || null;
      if ((o.plan || '') !== opt.plan || JSON.stringify(acc) !== JSON.stringify(opt.accepted)) { opt.plan = o.plan || ''; opt.accepted = acc; sentTarget = ''; lastKey = ''; render(); }
    }, function () {});
    H.json('api/race-live').then(function (x) {
      raceLive = x; var p = plan(); L = SM.fromLive(x, p ? p.length : null);
      var key = JSON.stringify([L.status, L.track, x.log && x.log.stints, x.car && [x.car.laps, x.car.inPits, x.car.driver, Math.round((x.car.ve || 0) * 10), Math.round((x.car.veUse || 0) * 100)], Math.floor((L.time || 0) / 30)]);
      if (key !== lastKey) { lastKey = key; render(); }
    }, function () { L = { status: 'off' }; render(); });
  }
  var plansP = H.inApp ? H.json('api/strategy') : Promise.reject();
  plansP.then(function (st) {
    plans = (st && st.plans) || [];
    return H.json('api/strategy-live').catch(function () { return {}; }).then(function (o) {
      opt.plan = o && plans.some(function (p) { return p.id === o.plan; }) ? o.plan : '';                // only a plan you picked (hub Race Control or here)
      opt.pace = o && o.pace === 'plan' ? 'plan' : 'live'; opt.natural = o && o.natural > 0 ? o.natural : null; opt.accepted = o && o.accepted ? o.accepted : null;
      render(); poll(); setInterval(function () { if (!document.hidden) poll(); }, 3000);
    });
  }, function () { render(); });
})(typeof window !== 'undefined' ? window : globalThis);
