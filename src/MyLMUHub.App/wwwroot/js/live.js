// Strategy tab "Live" (owner 2026-11-12): follows the race you are in with a plan you pick here; the plan itself is never changed (strategy.json is only read).
// What happened (api/race-live: StintTracker's log) + the rest planned again from now (strategy-math build(plan, live)), with the drivers' pace from this
// race (livePace) and, in 'VE per lap' plans, your VE use now. Status bar: the VE per lap you may still use in this stint (liveTarget) against your 5-lap
// average. "Lifting: still worth it?": the rest of the race as planned against no lifting (VE per lap = your use without lifting).
// The choice (plan, options) and the VE target now go to api/strategy-live (strategy-live.json): the fuel widget takes the target as its goal.
(function (root) {
  'use strict';
  var P = root.MyLMUHub, H = P.hub, F = P.format, SM = P.strategyMath, R = P.paceRef, esc = H.esc;
  var $ = function (id) { return document.getElementById(id); };
  H.header('strategy');
  if (H.inApp) H.json('api/pace?light=1').then(function (i) { H.setWho(i.names && i.names[0]); }, function () {});
  var COLORS = ['#C8F24A', '#5AA9FF', '#FF8A3D', '#B47CFF', '#35D0E3', '#FFD21F'];
  var plans = [], opt = { plan: '', pace: 'live', natural: null }, raceLive = null, L = { status: 'off' }, lastKey = '', sentTarget = '';

  function plan() { return plans.filter(function (p) { return p.id === opt.plan; })[0] || null; }
  function saveOpt(target) {
    var body = JSON.stringify({ plan: opt.plan, pace: opt.pace, natural: opt.natural, target: target || null });
    if (H.inApp) fetch('api/strategy-live', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body });
  }
  function trackMatches(p) {
    if (!p || !p.track || !L.track) return true;
    var n = R.trackName(L.track, '') || L.track;
    return n === p.track || p.track.indexOf(n) === 0 || n.indexOf(p.track) === 0;
  }
  function tile(k, v, n, cls) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="n">' + (n || '') + '</div></div>'; }

  // the plan as it stands live: drivers' pace from this race, VE per lap from your use now ('VE per lap' plans)
  function livePlan(p) {
    var q = JSON.parse(JSON.stringify(p)), pace = SM.livePace(raceLive);
    if (opt.pace === 'live') q.drivers.forEach(function (d) { if (pace[d.name] > 0) d.lap = pace[d.name]; });
    var use = raceLive && raceLive.car ? raceLive.car.veUse : -1;
    if (q.ve && q.ve.mode !== 'laps' && use > 0) q.ve.perLap = use;
    return { plan: q, pace: pace, use: use };
  }

  function render() {
    var p = plan();
    $('planSel').innerHTML = plans.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x === p ? ' selected' : '') + '>' + esc(x.name || 'Unnamed') + '</option>'; }).join('');
    if (!p) { status('idle', 'NO PLAN', 'Make a plan first (Endurance plan).', ''); return; }
    var on = (L.status === 'live' || L.status === 'over') && trackMatches(p), lp = livePlan(p), q = on ? lp.plan : p;
    var r = on ? SM.build(q, L) : SM.build(p), pure = SM.build(p);
    // ---- status bar ----
    var target = null;
    if (!H.inApp) status('idle', 'PLAN ONLY', 'Open this page in the app to follow a race.', '');
    else if (L.status === 'off') status('idle', 'NOT LIVE', 'Start Le Mans Ultimate: this page follows the race from the green flag.', '');
    else if (L.status === 'waiting') status('wait', 'WAITING', F.sessionName(L.session) + (L.endsIn >= 0 ? ' ends in ' + F.clock(L.endsIn) : '') + (L.track ? ' · ' + L.track : ''), 'Following starts at the green flag of the race.');
    else if (L.status === 'grid') status('wait', 'ON THE GRID', 'Waiting for the green flag' + (L.track ? ' · ' + L.track : ''), '');
    else if (!trackMatches(p)) status('wait', 'OTHER TRACK', 'The race is at ' + L.track + '; the plan "' + (p.name || '') + '" is for ' + p.track + '.', 'Pick a plan for this track.');
    else {
      var now = r.stints.filter(function (s) { return s.state === 'now'; })[0], drvLap = now ? now.lap : (q.drivers[0] || {}).lap;
      var t = SM.liveTarget(q, L, drvLap), use = lp.use, nums = [];
      nums.push(['Race time', F.clock(L.time)], ['Lap', String((raceLive.car ? raceLive.car.laps : 0) + 1)], ['Stint', (L.stints.length + (L.current ? 1 : 0)) + ' of ' + r.stints.length]);
      if (L.status === 'over') status('ok', 'FINISHED', r.laps + ' laps', '', nums);
      else if (L.inPit) {
        var next = r.stints.filter(function (s) { return s.state === 'plan'; })[0];
        status('wait', 'IN THE PIT', next ? 'Next: ' + next.driver + ', ' + next.laps + ' laps' + (next.fill ? ' · fill ' + F.pct(next.fill.mode === 'push' ? next.fill.push : next.fill.save, 0) : '') : '', '', nums);
      } else if (t && t.target > 0) {
        target = t.target;
        var lv = F.goalLevel(use, t.target, 2), cls = lv === 'over' ? 'over' : lv === 'close' ? 'close' : lv === 'ok' ? 'ok' : 'live';
        var head = lv === 'over' ? 'OVER TARGET: SAVE ' + F.pct(use - t.target, 2) + ' A LAP' : lv === 'close' ? 'CUTTING IT CLOSE' : lv === 'ok' ? 'ON TARGET' : 'LIVE';
        nums.push(['VE now', F.pct(t.ve, 1)], ['Allowed per lap', F.pct(t.target, 2)], ['Your use (5 laps)', use > 0 ? F.pct(use, 2) : '--'],
          [t.finish ? 'To the finish' : 'Pit in', t.left + (t.left === 1 ? ' lap' : ' laps') + (t.pitLap ? ' (end of lap ' + t.pitLap + ')' : '')]);
        status(cls, head, (liveDriver() || '?') + (L.entry ? ' · ' + L.entry : ''), t.finish ? 'Last stint: VE for the laps to the flag.' : 'To reach the planned stop with ' + (q.ve.reserve || 0) + ' reserve ' + ((q.ve.reserve || 0) === 1 ? 'lap' : 'laps') + '.', nums);
      } else status('live', 'LIVE', (liveDriver() || '?') + (L.entry ? ' · ' + L.entry : ''), 'No VE target: set the VE per lap or laps per stint in the plan.', nums);
    }
    var tk = target ? target.toFixed(2) + '|' + L.track : '';
    if (tk !== sentTarget) { sentTarget = tk; saveOpt(target ? { perLap: Math.round(target * 100) / 100, track: L.track, at: Date.now() } : null); }
    // ---- lifting still worth it? ----
    liftCheck(on, q, r, lp);
    // ---- the race: done (green), now (lime), the rest ----
    $('raceSub').textContent = on ? 'Live: what happened, and the rest planned again from now' + (opt.pace === 'live' && Object.keys(lp.pace).length ? ' with the lap times of this race' : '') + '.' : 'The plan (not live).';
    $('raceInfo').textContent = on && r.laps !== pure.laps ? (r.laps > pure.laps ? 'Ahead of the plan by ' : 'Behind the plan by ') + Math.abs(r.laps - pure.laps) + ' laps (' + r.laps + ' expected, plan ' + pure.laps + ')' : on ? 'On plan: ' + r.laps + ' laps expected' : '';
    $('sumTiles').innerHTML = tile('Stints', r.stints.length, r.stints.filter(function (s) { return s.state === 'done'; }).length + ' done') + tile('Pit stops', r.stops, '') +
      tile('Laps', r.laps || '--', 'expected at the finish') + tile('Finish', F.clock(r.end), 'race time') +
      q.drivers.map(function (d) { var x = r.drivers[d.name]; return x ? tile(d.name || 'Driver', F.hm(x.time), x.stints + ' stints · ' + (lp.pace[d.name] > 0 && on ? 'pace ' + F.lap(lp.pace[d.name]) : 'plan ' + F.lap(d.lap))) : ''; }).join('');
    $('warn').innerHTML = r.warnings.map(function (w) { return '<div class="warnbox">' + esc(w) + '</div>'; }).join('');
    $('timeline').innerHTML = r.stints.map(function (s) {
      var w = (s.end - s.start + (s.stop ? s.stop.loss : 0)) / r.end * 100, bg = s.state === 'done' ? 'var(--green)' : s.state === 'now' ? 'var(--lime)' : 'var(--tile2)';
      return '<div style="width:' + w.toFixed(3) + '%;background:' + bg + '" title="Stint ' + s.n + ': ' + esc(s.driver) + ', ' + s.laps + ' laps">' + (w > 3 ? s.n : '') + '</div>';
    }).join('');
    $('stintTbl').innerHTML = '<thead><tr><th class="num">#</th><th>Driver</th><th class="num">Laps</th><th class="num">Start</th><th class="num">End</th><th class="num">Lap time</th><th class="num">VE / lap allowed</th><th>Stop after</th></tr></thead><tbody>' +
      r.stints.map(function (s, i) {
        var tag = s.state === 'done' ? '<span class="chip ok">DONE</span>' : s.state === 'now' ? '<span class="chip lime">NOW</span>' : '';
        var laps = s.state === 'now' && L.current ? L.current.laps + ' / ' + s.laps : String(s.laps);
        return '<tr class="ls-' + (s.state || 'plan') + '"><td class="num">' + s.n + '</td><td><span class="dot" style="background:' + COLORS[q.drivers.map(function (d) { return d.name; }).indexOf(s.driver) % COLORS.length] + '"></span>' + esc(s.driver) + ' ' + tag + '</td>' +
          '<td class="num">' + laps + '<span class="two">' + s.fromLap + '-' + s.toLap + '</span></td><td class="num">' + F.clock(s.start) + '</td><td class="num">' + F.clock(s.end) + '</td><td class="num">' + F.lap(s.lap) + '</td>' +
          '<td class="num">' + (s.state === 'done' ? '<span class="faint">--</span>' : s.fill ? F.pct(s.veNeed, 2) + '<span class="two">fill ' + F.pct(s.fill.mode === 'push' ? s.fill.push : s.fill.save, 0) + '</span>' : s.veNeed ? F.pct(s.veNeed, 2) : '--') + '</td>' +
          '<td>' + (s.stop ? Math.round(s.stop.loss) + ' s' + (s.stop.real ? ' (real)' : '') + (s.stop.tyres ? ' · tyres' : '') + (s.stop.swap ? ' · swap to ' + esc(s.stop.next) : '') : '<span class="faint">finish</span>') + '</td></tr>';
      }).join('') + '</tbody>';
  }
  function liveDriver() { return L.driver || (L.current && L.current.driver) || ''; }
  function status(cls, chip, main, sub, nums) {
    $('stat').className = 'lstat ' + cls; $('statChip').textContent = chip; $('statMain').textContent = main; $('statSub').textContent = sub || '';
    $('statNums').innerHTML = (nums || []).map(function (n) { return '<div><span>' + esc(n[0]) + '</span><b>' + esc(n[1]) + '</b></div>'; }).join('');
  }

  // the rest of the race as planned (your lifting) against no lifting at all; only for a race that is on and a plan with a stint length
  function liftCheck(on, q, r, lp) {
    var nat = opt.natural > 0 ? opt.natural : num(plan().ve.perLap);                // typed, else the plan's VE per lap (from a session)
    $('liftCard').hidden = !(on && L.status === 'live');
    if ($('liftCard').hidden) return;
    if (document.activeElement !== $('naturalIn')) $('naturalIn').value = opt.natural > 0 ? opt.natural : '';
    $('paceSel').value = opt.pace;
    var stintsPlan = SM.stintLaps(q.ve);
    if (!(nat > 0)) { $('liftSub').textContent = 'Type your VE per lap when you do not lift: then this compares the rest of the race with and without lifting.'; $('liftTiles').innerHTML = ''; return; }
    var nq = JSON.parse(JSON.stringify(q)); nq.ve = { mode: 'perLap', perLap: nat, max: q.ve.max, reserve: q.ve.reserve }; nq.stints = [];
    var n = SM.build(nq, L), restA = r.stops - L.stints.length, restB = n.stops - L.stints.length;
    var verdict = n.stops <= r.stops ? ['ok', 'No need to lift', 'Without lifting the rest of the race takes the same ' + restB + ' stops (' + n.laps + ' laps).'] :
      ['close', 'Lifting saves ' + (n.stops - r.stops) + (n.stops - r.stops === 1 ? ' stop' : ' stops'), 'Without lifting: ' + restB + ' more stops instead of ' + restA + ' (about ' + Math.round((n.stops - r.stops) * num(q.pit.base)) + ' s in the pit).'];
    $('liftSub').innerHTML = '<b class="' + (verdict[0] === 'ok' ? 'green' : '') + '" style="font-size:16px">' + esc(verdict[1]) + '</b> · ' + esc(verdict[2]);
    $('liftTiles').innerHTML = tile('As planned', restA + ' stops left', (isFinite(stintsPlan) ? stintsPlan + ' laps a stint · ' : '') + r.laps + ' laps') + tile('No lifting', restB + ' stops left', F.pct(nat, 2) + ' a lap · ' + Math.floor((q.ve.max || 100) / nat - num(q.ve.reserve)) + ' laps a stint · ' + n.laps + ' laps');
  }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }

  $('planSel').onchange = function () { opt.plan = this.value; saveOpt(null); sentTarget = ''; render(); };
  $('naturalIn').onchange = function () { var v = Number(String(this.value).replace(',', '.')); opt.natural = v > 0 ? v : null; saveOpt(null); sentTarget = ''; render(); };
  $('paceSel').onchange = function () { opt.pace = this.value; saveOpt(null); sentTarget = ''; render(); };

  function poll() {
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
      opt.plan = o && plans.some(function (p) { return p.id === o.plan; }) ? o.plan : (st.current || (plans[0] && plans[0].id) || '');
      opt.pace = o && o.pace === 'plan' ? 'plan' : 'live'; opt.natural = o && o.natural > 0 ? o.natural : null;
      render(); poll(); setInterval(function () { if (!document.hidden) poll(); }, 3000);
    });
  }, function () { render(); });
})(typeof window !== 'undefined' ? window : globalThis);
