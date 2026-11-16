// Fuel + virtual energy (SimHub "FuP"): what is left with a bar, estimated laps, average of the last 5 laps (~ = estimate from the lap so far), last lap, and what to
// add for the rest of the race. Data: state.car.fuel / state.car.ve (UsageView, counted by the app: pit laps and the first partial lap are left out).
// VE goal per lap (option): LIVE (default: will the VE left last the laps a stint at your 5-lap average? the title says PUSH +x% / ON TARGET / LIFT x%,
// coloured green / yellow / red; the laps a stint: the hub's Race Control page for this track (default), the plan picked for the race, or typed; + / - a
// lap by hotkey), a typed VE number, or off. A fixed goal: the title shows it and the 5-lap average / last lap turn green (well under it), orange (within 'cutting close' % under it) or red (over it: the average flashes).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, F = P.format, D = P.dom;
  var ROWS = [552.9, 583.7, 614.5, 645.4];                                          // label y; the value sits 12.9 below
  // a value for the track you are on from a per-track map of the hub's Race Control page ({ "Bahrain (wec)": 26 }: laps a stint), the game's track name read
  // like the hub does. None for this track = null.
  P.trackValue = function (map, live) {
    if (!live || !map) return null;
    var R = P.paceRef, n = (R && R.trackName(live, '')) || live, g = map[n] || map[live];
    return g > 0 ? g : null;
  };
  var hub = { at: -1e9, laps: null };
  function hubLaps(live) {
    var now = Date.now();
    if (now - hub.at > 15000 && typeof root.fetch === 'function' && !(root.location && root.location.protocol === 'file:')) {
      hub.at = now;
      root.fetch('/api/stintlaps').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { hub.laps = j; }, function () {});
    }
    return P.trackValue(hub.laps, live);
  }
  // LIVE VE goal (owner 2026-11-14: "like the in-game MFD: will we make the 26 laps at this average, or lift / push?"; the game does not share the MFD's
  // own numbers, so worked out here). o = { ve: % now, use: % per lap (your average), stint: laps a stint, done: laps done in this stint, frac: share of
  // the lap now driven 0..1, raceLeft: race laps left (the last stint goes to the flag), reserve: laps kept }
  // -> { left (laps to go), allowed (% per lap), room (% per lap more you may use, < 0 = save), spareLaps, level: 'push' | 'ok' | 'close' | 'over' } | null
  // Same rules as the Live tab: more than a lap spare = push; short by up to half a lap = lift a little; more = lift (red).
  P.veLiveGoal = function (o) {
    if (!o || !(o.ve >= 0) || !(o.use > 0) || !(o.stint > 0) || !(o.done >= 0)) return null;
    var left = o.stint - o.done - Math.min(0.95, Math.max(0, o.frac || 0)), fin = o.raceLeft > 0 && o.raceLeft < left;
    if (fin) left = o.raceLeft;
    if (!(left > 0.05)) return null;
    var res = fin ? 0 : Math.max(0, o.reserve || 0), spare = o.ve - (left + res) * o.use, spareLaps = spare / o.use;
    return { left: left, allowed: o.ve / (left + res), room: spare / left, spareLaps: spareLaps, finish: fin,
      level: spareLaps >= 1 ? 'push' : spareLaps >= 0 ? 'ok' : spareLaps >= -0.5 ? 'close' : 'over' };
  };
  // the stint length of the plan picked for this race (Live tab / hub Race Control: strategy-live.json), polled every 15 s while the live goal is on
  var live = { at: -1e9, laps: null, reserve: 0 };
  function planStint() {
    var now = Date.now();
    if (now - live.at > 15000 && typeof root.fetch === 'function' && !(root.location && root.location.protocol === 'file:')) {
      live.at = now;
      var j = function (u) { return root.fetch(u).then(function (r) { return r.ok ? r.json() : null; }); };
      Promise.all([j('/api/strategy-live'), j('/api/strategy')]).then(function (a) {
        var id = a[0] && a[0].plan, p = a[1] && (a[1].plans || []).filter(function (x) { return x.id === id; })[0], v = p && p.ve;
        live.laps = !v ? null : v.mode === 'laps' ? (Number(v.laps) > 0 ? Math.round(v.laps) : null) : Number(v.perLap) > 0 ? Math.floor((Number(v.max) || 100) / Number(v.perLap) + 1e-9) - (Number(v.reserve) || 0) : null;
        live.reserve = v ? Number(v.reserve) || 0 : 0;
        var acc = a[0] && a[0].accepted; live.chosen = p && acc && acc.plan === id && Number(acc.laps) > 0 ? Math.round(acc.laps) : null; live.got = true;   // chosen on the Live tab
      }, function () {});
    }
    return live;
  }
  // the laps a stint moved by hotkeys (Race Control: "Fuel widget: stint laps + 1 / - 1"), for the rest of this race session; kept in the browser
  var adj = { key: '', delta: 0 }, refresh = [];
  try { var sv = JSON.parse(root.localStorage.getItem('pw-stint-delta') || 'null'); if (sv && typeof sv.key === 'string') adj = { key: sv.key, delta: Number(sv.delta) || 0, chosen: Number(sv.chosen) > 0 ? Number(sv.chosen) : null }; } catch (e) {}
  function saveAdj() { try { root.localStorage.setItem('pw-stint-delta', JSON.stringify(adj)); } catch (e) {} }
  P.stintLapsKey = function (d) { adj.delta += d; saveAdj(); refresh.forEach(function (f) { f(); }); };
  function sessionKey(state) { var t = state && state.track; return t && t.name ? t.name + '|' + Math.round(t.sessionLength || 0) : ''; }
  var T = P.panelWidget('fuel', 'Fuel / energy', 520, 482.3, 245, 218.8, 'green', [
    ['titles', 'Titles + row names', 'label'], ['values', 'Values', 'white'], ['divider', 'Middle divider', 'track'], ['barBg', 'Bar background', 'rowLine'],
    ['fuelBar', 'Fuel bar', 'green'], ['veText', 'Energy %', 've'], ['veBar', 'Energy bar', 've'],
    ['mid', 'Under 30 % (text + bar)', 'yellow'], ['low', 'Under 15 % (text + bar)', 'red'], ['none', 'Energy: none', 'label'], ['race', 'Race laps left', 'label'],
    ['goalOk', 'VE goal: well under', 'green'], ['goalClose', 'VE goal: cutting close', 'yellow'], ['goalOver', 'VE goal: over (flashes)', 'red']],
    [['fuel', 'Fuel (left side)'], ['ve', 'Virtual energy (right side)'], ['estLaps', 'Estimated laps'], ['avg', 'Average of 5 laps'], ['lastLap', 'Last lap use'],
     ['add', 'Refuel / add energy'], ['race', 'Race laps left (bottom line)'],
     { key: 'veGoal', label: 'VE goal per lap', type: 'select', def: 'live', choices: [['live', 'Live: make the laps a stint at your average (lift / push)'], ['typed', 'A fixed number (below)'], ['off', 'Off']] },
     { key: 'stintFrom', label: 'Live: laps a stint', type: 'select', def: 'hub', choices: [['hub', 'From the hub (Race Control): this track\'s laps'], ['plan', 'From the plan picked for this race (Live tab)'], ['typed', 'The number below']] },
     { key: 'stintLapsN', label: 'Live: laps a stint (when typed)', type: 'number', def: 0, min: 0, max: 200, step: 1 },
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
        o.rows.push(v); (o.labels = o.labels || []).push(l); all.push(l, v); k.hideIf(ROWKEYS[i], [l, v]);
      });
      k.hideIf(key, all);
      return o;
    }
    e.fuel = side('fuel', 528, 'FUEL', ['EST LAPS', 'AVG 5 LAPS', 'LAST LAP', 'REFUEL (L)']);
    e.ve = side('ve', 650, 'VIRTUAL ENERGY', ['EST LAPS', 'AVG 5 LAPS', 'LAST LAP', 'ADD ENERGY (%)']);
    e.race = k.txt(524, 679.2, 236, 13.9, 14, 700, 'center', K.race); k.hideIf('race', [e.race]);
    if (!k.show('fuel') || !k.show('ve')) D.show(div, false);
    var LVL = { none: K.none, low: K.low, mid: K.mid }, GOAL = { ok: K.goalOk, close: K.goalClose, over: K.goalOver };
    var src = k.opt('veGoal', 'live'); if (src === 'plan') src = 'live';                    // the old 'VE goal per track' setting (until 2026-11-15) = live
    var typed = Number(k.opt('veGoalPct', 0)) || 0, close = Number(k.opt('veClose', 2));
    var stintFrom = k.opt('stintFrom', 'hub'), stintTyped = Math.round(Number(k.opt('stintLapsN', 0)) || 0);
    var LIVE = { push: K.goalOk, ok: K.goalOk, close: K.goalClose, over: K.goalOver };
    function bar(o, p, okColor) {
      var w = p >= 0 ? Math.round(Math.min(100, p) / 100 * o.full()) : 0;
      if (o.bar._w !== w) { o.bar.style.width = w + 'px'; o.bar._w = w; } D.bg(o.bar, F.levelColor(p, okColor, LVL));
    }
    var lastState = null;
    refresh.push(function () { if (lastState) update(lastState); }); if (refresh.length > 8) refresh.shift();   // widgets made again in edit mode: only the newest few
    function update(state) {
      lastState = state;
      var c = state.car || {};                                              // no game: the frame with dashes
      var f = c.fuel || {}, v = c.ve || {};
      D.text(e.fuel.now, F.litres(f.now, 1)); bar(e.fuel, f.pct, K.fuelBar);
      D.text(e.fuel.rows[0], F.laps1(f.laps)); D.text(e.fuel.rows[1], F.perLap(f, 'L')); D.text(e.fuel.rows[2], f.last > 0 ? F.litres(f.last, 2) : '--'); D.text(e.fuel.rows[3], f.add > 0 ? F.litres(f.add, 1) : '--');
      D.text(e.ve.now, F.pct(v.now)); D.color(e.ve.now, F.levelColor(v.now, K.veText, LVL)); bar(e.ve, v.now, K.veBar);
      // live: will the VE last the stint at your average? (race only: the laps done in this stint come from the app's stint log)
      var lg = null, target = null, sk = sessionKey(state);
      if (sk && adj.key !== sk) { if (adj.key) adj.delta = 0; adj.key = sk; saveAdj(); }                // a new race session: the hotkey change starts over
      if (src === 'live') {
        // a stint length chosen on the Live tab ("Changes to the plan", owner 2026-11-15) goes before the hub / plan laps; a typed number goes first
        var pl = stintFrom === 'typed' ? null : planStint(), chosen = pl && pl.chosen > 0 ? pl.chosen : null;
        if (pl && pl.got && (adj.chosen || null) !== chosen) { adj.chosen = chosen; adj.delta = 0; saveAdj(); }   // a new choice: the hotkey change starts over
        var ps = stintFrom === 'typed' ? { laps: stintTyped > 0 ? stintTyped : null, reserve: 0 } : chosen ? { laps: chosen, reserve: pl.reserve } : stintFrom === 'plan' ? pl : { laps: hubLaps(state.track && state.track.name), reserve: 0 }, t = state.top || {};
        target = ps.laps > 0 ? Math.max(1, ps.laps + adj.delta) : null;
        if (!c.inPits && c.stintLaps >= 0) lg = P.veLiveGoal({ ve: v.now, use: v.avg > 0 ? v.avg : v.live, stint: target, done: c.stintLaps, frac: t.cur > 0 && t.est > 0 ? t.cur / t.est : 0, raceLeft: c.lapsLeft, reserve: ps.reserve });
      }
      // live: the first row = laps done in this stint / the laps you aim for (+ / - by hotkey), else the estimated laps
      var liveRow = src === 'live' && target && c.stintLaps >= 0;
      D.text(e.ve.labels[0], liveRow ? 'STINT LAPS' + (adj.delta ? ' (' + (adj.delta > 0 ? '+' : '') + adj.delta + ')' : '') : 'EST LAPS');
      if (lg) {
        var lc = LIVE[lg.level], ll2 = F.goalLevel(v.last, lg.allowed, close);
        D.text(e.ve.title, lg.level === 'push' ? 'PUSH +' + F.pct(lg.room, 2) : lg.level === 'ok' ? 'ON TARGET' : 'LIFT ' + F.pct(-lg.room, 2));
        D.color(e.ve.title, lc); D.color(e.ve.rows[1], lc); D.cls(e.ve.rows[1], 'pw-flash', lg.level === 'over'); D.color(e.ve.rows[2], GOAL[ll2] || K.values);
      } else {
        var goal = src === 'typed' ? (typed > 0 ? typed : null) : null;                       // live, not in a race stint: no goal
        var la = F.goalLevel(v.avg > 0 ? v.avg : v.live, goal, close), ll = F.goalLevel(v.last, goal, close);
        D.text(e.ve.title, goal ? 'VE GOAL ' + F.pct(goal, 2) : 'VIRTUAL ENERGY'); D.color(e.ve.title, K.titles);
        D.color(e.ve.rows[1], GOAL[la] || K.values); D.cls(e.ve.rows[1], 'pw-flash', la === 'over'); D.color(e.ve.rows[2], GOAL[ll] || K.values);
      }
      D.text(e.ve.rows[0], liveRow ? c.stintLaps + ' / ' + target : F.laps1(v.laps)); D.text(e.ve.rows[1], F.perLap(v, '%')); D.text(e.ve.rows[2], v.last > 0 ? F.pct(v.last, 2) : '--'); D.text(e.ve.rows[3], v.add > 0 ? F.pct(v.add) : '--');
      D.text(e.race, F.raceLaps(c.lapsLeft));
    }
    return update;
  });
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
