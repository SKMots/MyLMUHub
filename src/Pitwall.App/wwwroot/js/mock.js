// Demo mode (index.html opened from a folder, or ?mock): plays a recorded scenario and lets the gaps drift so the arrows and numbers move.
// Keys 1-5 switch scenario. The real data comes from the C# app over the WebSocket (net.js).
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {};
  var names = ['gt3_mid', 'gt3_p3', 'hyper_p2', 'gt3_near_back', 'no_focus'], cur = null, timer = null;
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function jitter(g) { if (g && g.kind === 'time') g.value = Math.max(0.05, g.value + (Math.random() - 0.5) * 0.6); }
  // demo top bar (hand-made; the recorded race has no live lap data)
  var top = { has: true, session: 10, timeLeft: 15732, classPos: 20, overall: 35, lap: 42, lapsLeft: 141.6, last: 111.204, lastFlag: 0, lastDiff: 0.51,
              best: 110.694, bestFlag: 2, cur: 31.2, est: 110.4, delta: -0.294, sectors: [{ value: 30.515, diff: -0.12, flag: 2 }, { value: -1, diff: null, flag: 0 }, { value: -1, diff: null, flag: 0 }] };
  // demo car / track / forecast (hand-made) and an oval-ish outline so the map shows something
  function wheel(t, w, b) { return { wear: w, temp: t, temps: [t - 4, t, t + 5], pressure: 172, brake: b, flat: false, detached: false }; }
  var car = { has: true, driver: 'Demo Driver', model: 'BMW M4 LMGT3', entry: 'Team WRT #31', inPits: false, brakeBias: 54.2, tc: 4, tcSlip: 3, tcCut: 5, abs: 6, map: 1,
              compound: 'Medium', wheels: [wheel(92, 0.86, 520), wheel(97, 0.82, 540), wheel(84, 0.9, 410), wheel(88, 0.88, 430)], dents: [0, 1, 0, 0, 0, 0, 2, 0], detached: false,
              body: 0.81, aero: 0.92, susp: 1, lapsLeft: 141.6, fuel: { now: 62.4, pct: 62.4, avg: 3.12, last: 3.08, live: 3.1, laps: 20, add: 380.1 }, ve: { now: 64, pct: 64, avg: 3.4, last: 3.38, live: 3.4, laps: 18.8, add: 418 } };
  function at(f) { var a = f * 2 * Math.PI; return [Math.round(900 * Math.cos(a) + 250 * Math.cos(3 * a)), Math.round(500 * Math.sin(a))]; }
  var lap = [], pit = [];
  for (var i = 0; i < 400; i++) lap.push(at(i / 400));
  for (i = 0; i < 30; i++) pit.push([lap[i][0] - 60, lap[i][1] - 40]);
  var map = { track: 'Demo', complete: true, source: 'demo', paths: [lap, pit] };
  var track = { name: 'Circuit de Demo', air: 22.4, road: 31.8, raining: 0, wetness: 0, timeOfDay: 14.5, sessionLength: 21600, elapsed: 5868, mapVersion: 1,
                cars: [0.12, 0.31, 0.33, 0.52, 0.71, 0.9].map(function (f, k) { var p = at(f); return { f: f, x: p[0], z: p[1], pos: k + 1, me: k === 2, pit: false, cls: k === 0 || k === 4 ? 'Hyper' : 'GT3' }; }) };
  var forecast = { nodes: [{ sky: 1, temp: 22, rain: 0 }, { sky: 2, temp: 23, rain: 10 }, { sky: 4, temp: 21, rain: 35 }, { sky: 7, temp: 18, rain: 80 }, { sky: 5, temp: 19, rain: 40 }], status: 'demo data' };
  // demo relative (hand-made): ahead on the road first, you, then behind
  var rel = [['M. Rossi', 'Hypercar', 4, 6.8, 1], ['J. Smith', 'GT3', 18, 3.2, 0], ['A. Novak', 'LMP2', 7, 1.4, 1], ['Demo Driver', 'GT3', 20, 0, 0], ['K. Weber', 'GT3', 21, -0.9, 0],
             ['L. Dubois', 'Hypercar', 2, -2.6, 2], ['R. Silva', 'GT3', 25, -5.1, -1], ['T. Berg', 'LMP2', 11, -8.4, 1]]
    .map(function (a) { return { driver: a[0], cls: a[1], classPos: a[2], gap: a[3], hasGap: true, laps: a[4], me: a[3] === 0, pit: false }; });
  // demo prediction (hand-made): predicted order around you, places won / lost, stops, gap at the finish
  var pred = { has: true, why: '', remaining: 15732, lapsLeft: -1, pitLoss: 54, pitLossLearned: true, myPos: 20, myPred: 18, myStops: 4, rows: [
    [16, 17, 'J. Smith', 4, 0, 21.4, true], [17, 15, 'A. Novak', 5, 0, 8.2, true], [18, 20, 'Demo Driver', 4, 0, 0, true], [19, 18, 'K. Weber', 5, 0, -12.7, true],
    [20, 19, 'R. Silva', 5, 0, -30.1, false], [21, 22, 'T. Berg', 4, -1, 0, true]].map(function (a) { return { predPos: a[0], classPos: a[1], driver: a[2], stops: a[3], laps: a[4], gap: a[5], sure: a[6], me: a[2] === 'Demo Driver', pit: false }; }) };
  function set(store, name) {
    cur = copy(P.mockStates[name]);
    store.set({ standings: cur, top: name === 'no_focus' ? { has: false, session: 10, timeLeft: 15732, sectors: [] } : top, car: name === 'no_focus' ? { has: false } : car,
                track: track, map: map, forecast: forecast, pb: { has: true, lap: 238.912, s1: 37.402, s2: 107.85, s3: 93.66, time: 1792766756, type: 'Race', new: false, session: 239.874, last: 240.327 },
                rel: name === 'no_focus' ? [] : rel, pred: name === 'no_focus' ? { has: false, why: 'car' } : pred, status: 'demo', scenario: name });
  }
  P.mock = {
    names: names,
    start: function (store, first) {
      set(store, first || names[0]);
      if (root.addEventListener) root.addEventListener('keydown', function (ev) { var i = parseInt(ev.key, 10); if (i >= 1 && i <= names.length) set(store, names[i - 1]); });
      timer = setInterval(function () {
        if (!cur) return;
        cur.rows.forEach(function (r) { jitter(r.gap); }); if (cur.ahead) jitter(cur.ahead.gap); if (cur.behind) jitter(cur.behind.gap);
        top.timeLeft = Math.max(0, top.timeLeft - 1); top.cur = top.cur > 110 ? 1 : top.cur + 1; top.delta = Math.round((top.delta + (Math.random() - 0.5) * 0.1) * 1000) / 1000;
        track.cars.forEach(function (c) { c.f = (c.f + 0.009) % 1; var p = at(c.f); c.x = p[0]; c.z = p[1]; }); track.elapsed += 1;
        store.set({ standings: cur, track: track });
      }, 1000);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
