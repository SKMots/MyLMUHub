// Fuel + virtual energy (SimHub "FuP"): what is left with a bar, estimated laps, average of the last 5 laps (~ = estimate from the lap so far), last lap, and what to
// add for the rest of the race. Data: state.car.fuel / state.car.ve (UsageView, counted by the app: pit laps and the first partial lap are left out).
// VE goal per lap (option: automatic = your goal for this track from the hub's Race Control page, else the strategy plan for this track; a typed number; off): the energy title shows it and the 5-lap average / last lap turn
// green (well under it), orange (within 'cutting close' % under it) or red (over it: the average flashes). The plan is read from /api/strategy at most every 15 s,
// and its goal only shows on the plan's track (another track: no goal, unless one is typed in the widget's settings).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, F = P.format, D = P.dom;
  var ROWS = [552.9, 583.7, 614.5, 645.4];
  // the VE goal per lap of the current strategy plan (strategy.json): 'VE per lap' mode = that number, 'laps I aim for' = start VE / (laps + reserve)
  P.veGoalOfPlan = function (st) {
    var p = st && (st.plans || []).filter(function (x) { return x.id === st.current; })[0], v = p && p.ve;
    if (!v) return null;
    var max = v.max > 0 ? v.max : 100;
    if (v.mode === 'perLap') return v.perLap > 0 ? v.perLap : null;
    return v.laps > 0 ? max / (v.laps + (v.reserve > 0 ? v.reserve : 0)) : null;
  };
  // the plan is for one track: its goal only shows at that track (live track name read the same way as the strategy page)
  P.planTrackMatches = function (st, live) {
    var p = st && (st.plans || []).filter(function (x) { return x.id === st.current; })[0], R = P.paceRef;
    if (!p || !live) return false; if (!p.track) return true;
    var n = (R && R.trackName(live, '')) || live;
    return n === p.track || p.track.indexOf(n) === 0 || n.indexOf(p.track) === 0;
  };
  // the goal for the track you are on: your VE goal for that track (hub Race Control page, vegoals.json { "Bahrain (wec)": 3.8 }), else the strategy plan's
  // goal when the plan is for this track, else none
  // lv = the Live strategy page's file (strategy-live.json): while a race is on there, its VE target for the stint you are in comes first (set in the last
  // 15 minutes, for this track), and its plan is the plan used
  P.veGoalFor = function (goals, st, live, lv, now) {
    if (!live) return null;
    var tg = lv && lv.target; if (tg && tg.perLap > 0 && tg.track === live && (now || Date.now()) - tg.at < 15 * 60000) return tg.perLap;
    if (lv && lv.plan && st && (st.plans || []).some(function (x) { return x.id === lv.plan; })) st = { current: lv.plan, plans: st.plans };
    var R = P.paceRef, n = (R && R.trackName(live, '')) || live, g = goals && (goals[n] || goals[live]);
    if (g > 0) return g;
    return P.planTrackMatches(st, live) ? P.veGoalOfPlan(st) : null;
  };
  var plan = { at: -1e9, st: null, goals: null, lv: null };
  function planGoal(live) {
    var now = Date.now();
    if (now - plan.at > 15000 && typeof root.fetch === 'function' && !(root.location && root.location.protocol === 'file:')) {
      plan.at = now;
      root.fetch('/api/strategy').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { plan.st = j; }, function () {});
      root.fetch('/api/vegoals').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { plan.goals = j; }, function () {});
      root.fetch('/api/strategy-live').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { plan.lv = j; }, function () {});
    }
    var bt = P.alertBus && P.alertBus.target; if (bt && bt.perLap > 0 && bt.track === live && Date.now() - bt.at < 60000) return bt.perLap;   // race alerts: this stint, as accepted
    return P.veGoalFor(plan.goals, plan.st, live, plan.lv);
  }                                          // label y; the value sits 12.9 below
  var T = P.panelWidget('fuel', 'Fuel / energy', 520, 482.3, 245, 218.8, 'green', [
    ['titles', 'Titles + row names', 'label'], ['values', 'Values', 'white'], ['divider', 'Middle divider', 'track'], ['barBg', 'Bar background', 'rowLine'],
    ['fuelBar', 'Fuel bar', 'green'], ['veText', 'Energy %', 've'], ['veBar', 'Energy bar', 've'],
    ['mid', 'Under 30 % (text + bar)', 'yellow'], ['low', 'Under 15 % (text + bar)', 'red'], ['none', 'Energy: none', 'label'], ['race', 'Race laps left', 'label'],
    ['goalOk', 'VE goal: well under', 'green'], ['goalClose', 'VE goal: cutting close', 'yellow'], ['goalOver', 'VE goal: over (flashes)', 'red']],
    [['fuel', 'Fuel (left side)'], ['ve', 'Virtual energy (right side)'], ['estLaps', 'Estimated laps'], ['avg', 'Average of 5 laps'], ['lastLap', 'Last lap use'],
     ['add', 'Refuel / add energy'], ['race', 'Race laps left (bottom line)'],
     { key: 'veGoal', label: 'VE goal per lap', type: 'select', def: 'plan', choices: [['plan', 'Automatic: your goal for the track (hub), else the strategy plan'], ['typed', 'The number below'], ['off', 'Off']] },
     { key: 'veGoalPct', label: 'VE goal (% per lap, when typed)', type: 'number', def: 0, min: 0, max: 30, step: 0.05 },
     { key: 'veClose', label: 'Cutting close = within this % under the goal', type: 'number', def: 2, min: 0, max: 20, step: 0.5 }],
  function (k, e, K) {
    var div = k.rect(642, 505.2, 0.8, 171, K.divider), ROWKEYS = ['estLaps', 'avg', 'lastLap', 'add'];
    function side(key, x, title, labels) {
      var o = { rows: [] }, all = [o.title = k.txt(x, 486.2, 108, 13.9, 15, 600, 'left', K.titles, title)];
      o.now = k.txt(x, 500.2, 108, 35.8, 30, 700, 'left', K.values);
      all.push(o.now, k.rect(x, 538, 108, 7, K.barBg)); o.bar = k.rect(x, 538, 108, 7, K.fuelBar); o.bar._dynW = true; o.full = function () { return k.ux(108); }; all.push(o.bar);
      ROWS.forEach(function (y, i) {
        var l = k.txt(x, y, 108, 12.9, 13, 600, 'left', K.titles, labels[i]), v = k.txt(x, y + 12.9, 108, 23.8, 24, 700, 'left', K.values);
        o.rows.push(v); all.push(l, v); k.hideIf(ROWKEYS[i], [l, v]);
      });
      k.hideIf(key, all);
      return o;
    }
    e.fuel = side('fuel', 528, 'FUEL', ['EST LAPS', 'AVG 5 LAPS', 'LAST LAP', 'REFUEL (L)']);
    e.ve = side('ve', 650, 'VIRTUAL ENERGY', ['EST LAPS', 'AVG 5 LAPS', 'LAST LAP', 'ADD ENERGY (%)']);
    e.race = k.txt(524, 679.2, 236, 13.9, 14, 700, 'center', K.race); k.hideIf('race', [e.race]);
    if (!k.show('fuel') || !k.show('ve')) D.show(div, false);
    var LVL = { none: K.none, low: K.low, mid: K.mid }, GOAL = { ok: K.goalOk, close: K.goalClose, over: K.goalOver };
    var src = k.opt('veGoal', 'plan'), typed = Number(k.opt('veGoalPct', 0)) || 0, close = Number(k.opt('veClose', 2));
    function bar(o, p, okColor) {
      var w = p >= 0 ? Math.round(Math.min(100, p) / 100 * o.full()) : 0;
      if (o.bar._w !== w) { o.bar.style.width = w + 'px'; o.bar._w = w; } D.bg(o.bar, F.levelColor(p, okColor, LVL));
    }
    return function (state) {
      var c = state.car || {};                                              // no game: the frame with dashes
      var f = c.fuel || {}, v = c.ve || {};
      D.text(e.fuel.now, F.litres(f.now, 1)); bar(e.fuel, f.pct, K.fuelBar);
      D.text(e.fuel.rows[0], F.laps1(f.laps)); D.text(e.fuel.rows[1], F.perLap(f, 'L')); D.text(e.fuel.rows[2], f.last > 0 ? F.litres(f.last, 2) : '--'); D.text(e.fuel.rows[3], f.add > 0 ? F.litres(f.add, 1) : '--');
      D.text(e.ve.now, F.pct(v.now)); D.color(e.ve.now, F.levelColor(v.now, K.veText, LVL)); bar(e.ve, v.now, K.veBar);
      var goal = src === 'typed' ? (typed > 0 ? typed : null) : src === 'plan' ? planGoal(state.track && state.track.name) : null;
      var la = F.goalLevel(v.avg > 0 ? v.avg : v.live, goal, close), ll = F.goalLevel(v.last, goal, close);
      D.text(e.ve.title, goal ? 'VE GOAL ' + F.pct(goal, 2) : 'VIRTUAL ENERGY');
      D.color(e.ve.rows[1], GOAL[la] || K.values); D.cls(e.ve.rows[1], 'pw-flash', la === 'over'); D.color(e.ve.rows[2], GOAL[ll] || K.values);
      D.text(e.ve.rows[0], F.laps1(v.laps)); D.text(e.ve.rows[1], F.perLap(v, '%')); D.text(e.ve.rows[2], v.last > 0 ? F.pct(v.last, 2) : '--'); D.text(e.ve.rows[3], v.add > 0 ? F.pct(v.add) : '--');
      D.text(e.race, F.raceLaps(c.lapsLeft));
    };
  });
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
