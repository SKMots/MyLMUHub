// Race alerts widget (owner 2026-11-13): one big, short message you can read on a straight. It floats over the other widgets and is empty when there is
// nothing to say. The checks run in the page (P.alertBus, once per page, while an alert widget is on it): every 3 s the race (api/race-live), every 15 s
// the plan (api/strategy + api/strategy-live: the plan picked on the Live tab, the stint length you accepted) and the settings (api/alerts, hub Race Control
// page). alerts-math decide(): BOX THIS LAP (the lap before the planned stop), PUSH / LIFT (another stint length is now best for the rest of the race),
// MEASURE (what lifting costs, in practice). Answer with a key / wheel button (hotkeys '!accept' / '!ignore' / '!later', app.js) or a click:
// Accept = the live plan follows it (strategy-live.json accepted; the fuel widget's VE goal follows: P.alertBus.target), Ignore = not again, Later = in a
// lap. Sound: Windows' voice, a chime, your own file, or none. Every alert and its answer go to api/alert-history (the Live tab shows them).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, F = P.format, D = P.dom;
  var DEF = { enabled: true, strategy: true, box: true, sound: 'voice', volume: 80, showSec: 20 };

  // ---------- the checks (one per page) ----------
  var bus = P.alertBus = P.alertBus || { widgets: [], cur: null, target: null, dismissed: {}, answered: {}, lastChangeLap: null, settings: DEF };
  var timer = null, slowAt = 0, st = null, lv = null, live = null;
  function canFetch() { return typeof root.fetch === 'function' && !!root.location && /^https?:/.test(root.location.protocol || ''); }   // in the app (not from disk, not in tests)
  function get(u) { return root.fetch(u).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; }); }
  function put(u, o) { return root.fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).catch(function () {}); }
  function start() {
    if (timer || !canFetch()) return;
    timer = setInterval(tick, 3000); tick();
  }
  function stop() { if (timer && !bus.widgets.length) { clearInterval(timer); timer = null; } }
  function tick() {
    var now = Date.now(), slow = now - slowAt > 15000;
    if (slow) slowAt = now;
    Promise.all([get('/api/race-live'), slow ? get('/api/strategy') : Promise.resolve(st), slow ? get('/api/strategy-live') : Promise.resolve(lv), slow ? get('/api/alerts') : Promise.resolve(bus.settings)])
      .then(function (r) { live = r[0]; st = r[1]; lv = r[2] || {}; bus.settings = Object.assign({}, DEF, r[3] || {}); run(); });
  }
  function plan() {
    var ps = (st && st.plans) || [], id = lv && lv.plan && ps.some(function (p) { return p.id === lv.plan; }) ? lv.plan : st && st.current;
    return ps.filter(function (p) { return p.id === id; })[0] || null;
  }
  function run() {
    var A = P.alertsMath, SM = P.strategyMath, set = bus.settings, p = plan(), track = live && live.session ? live.session.track : '';
    var onTrack = p && P.planTrackMatches ? P.planTrackMatches({ current: p.id, plans: [p] }, track) : !!p;
    var L = SM.fromLive(live, p ? p.length : null), lapNow = live && live.car ? live.car.laps : 0;
    var acc = lv && lv.accepted && p && lv.accepted.plan === p.id ? lv.accepted.laps : 0;
    var q = p && onTrack ? A.livePlan(p, live, { pace: lv && lv.pace, accepted: acc }) : null;
    var cost = p && p.from ? (p.from.measured > 0 ? p.from.measured : (p.from.cost !== null && p.from.cost !== undefined && p.from.cost !== '' ? Number(p.from.cost) : null)) : null;
    var meas = set.measure && set.measure.track && track && (set.measure.track === track || (P.paceRef && P.paceRef.trackName(track, '') === set.measure.track)) ? set.measure : null;
    if (meas && !(meas.from >= 0) && live && live.car) { meas.from = live.car.laps; set.measure = meas; put('/api/alerts', set); }
    var d = A.decide({ plan: q, live: L, raceLive: live, natural: (lv && lv.natural) || (p && p.ve && p.ve.perLap), cost: cost, lastChangeLap: bus.lastChangeLap, dismissed: bus.dismissed, measure: meas });
    bus.target = d.target && q ? { perLap: d.target, track: track, at: Date.now() } : null;
    if (set.enabled === false) { show(null); return; }
    var spect = live && live.car && bus.state && bus.state.standings && !bus.state.standings.driving ? live.car.driver : '';
    // a box call wins; it stays until the car is in the pit lane (or the lap is over)
    if (d.box && set.box !== false) {
      var bk = 'box:' + d.box.lap; if (!bus.answered[bk]) { show({ id: bk, kind: 'box', big: 'BOX THIS LAP', mid: 'Fill ' + F.pct(d.box.fill, 0) + (d.box.next ? ' · next: ' + d.box.next : ''), small: (spect ? 'For ' + spect + ' · ' : '') + d.box.laps + ' laps in the next stint', say: 'Box this lap', sticky: true }); return; }
    }
    if (bus.cur && bus.cur.kind === 'box' && (!d.box || L.inPit)) show(null);
    if (d.change && set.strategy !== false && !(bus.cur && bus.cur.id === 'chg:' + d.change.to)) {
      var c = d.change; bus.lastChangeLap = lapNow;
      show({ id: 'chg:' + c.to, kind: c.kind, big: c.kind === 'push' ? 'PUSH' : 'LIFT', mid: F.pct(c.perLapTo, 2) + ' a lap (was ' + F.pct(c.perLapFrom, 2) + ')',
        small: (spect ? 'For ' + spect + ' · ' : '') + c.to + ' laps a stint instead of ' + c.from + ': ' + c.why, say: (c.kind === 'push' ? 'Push. ' : 'Lift. ') + c.perLapTo.toFixed(1) + ' percent a lap', change: c, plan: p.id });
      return;
    }
    if (d.measure && set.strategy !== false) {
      var m = d.measure, mk = 'm:' + m.phase;
      if (!(bus.cur && bus.cur.id === mk) && !bus.answered[mk]) show({ id: mk, kind: 'measure', big: m.phase === 'normal' ? 'DRIVE NORMAL' : m.phase === 'lift' ? 'LIFT AND COAST' : 'MEASURED',
        mid: m.phase === 'done' ? 'Mark this session "Mixed" in Strategy' : 'Lap ' + m.lap + ' of ' + m.of, small: 'Measuring what lifting costs you', say: m.phase === 'normal' ? 'Drive normal for three laps' : m.phase === 'lift' ? 'Now lift and coast for three laps' : 'Done measuring' });
      if (m.phase === 'done' && set.measure) { set.measure = null; put('/api/alerts', set); }
    }
    if (bus.cur && !bus.cur.sticky && Date.now() - bus.cur.at > Math.max(5, Number(set.showSec) || 20) * 1000) show(null);
  }
  // put an alert on screen (null = none): sound and history the first time
  function show(a) {
    if (a && bus.cur && bus.cur.id === a.id) return;
    if (!a && !bus.cur) return;
    if (a) { a.at = Date.now(); sound(a.say); history({ at: a.at, id: a.id, kind: a.kind, text: a.big + ' · ' + a.mid, why: a.small, answer: null }); }
    bus.cur = a; bus.widgets.forEach(function (w) { w(); });
  }
  bus.act = function (what) {
    var a = bus.cur; if (!a) return;
    bus.answered[a.id] = true;
    if (a.change) {
      if (what === 'accept') { var acc = { plan: a.plan, laps: a.change.to, at: Date.now() }; get('/api/strategy-live').then(function (o) { o = o || {}; o.accepted = acc; lv = o; put('/api/strategy-live', o); }); }
      if (what === 'ignore') bus.dismissed['laps:' + a.change.to] = true;
      if (what === 'later') { delete bus.answered[a.id]; bus.lastChangeLap = (live && live.car ? live.car.laps : 0) - 2; }   // again in a lap
    }
    history({ id: a.id, answer: what }, true);
    bus.cur = null; bus.widgets.forEach(function (w) { w(); });
  };
  // the history (last 200): a new alert, or the answer to the newest one with that id
  function history(e, answer) {
    if (!canFetch()) return;
    get('/api/alert-history').then(function (h) {
      h = Array.isArray(h) ? h : [];
      if (answer) { for (var i = h.length - 1; i >= 0; i--) if (h[i].id === e.id && !h[i].answer) { h[i].answer = e.answer; break; } }
      else h.push(e);
      put('/api/alert-history', h.slice(-200));
    });
  }
  // the sound: Windows' own voice (says the alert), a chime (two tones), your own file, or none
  var ctx = null;
  function sound(text) {
    var s = bus.settings, vol = Math.max(0, Math.min(100, Number(s.volume) || 0)) / 100;
    if (!text || s.sound === 'none' || !vol) return;
    try {
      if (s.sound === 'voice' && root.speechSynthesis) {
        var u = new root.SpeechSynthesisUtterance(text); u.volume = vol; u.rate = (Number(s.rate) || 105) / 100; u.pitch = (s.pitch === 0 ? 0 : Number(s.pitch) || 100) / 100;
        var v = s.voice && root.speechSynthesis.getVoices().filter(function (x) { return x.name === s.voice; })[0]; if (v) u.voice = v;   // the voice picked on the hub's Race Control page
        root.speechSynthesis.cancel(); root.speechSynthesis.speak(u); return;
      }
      if (s.sound === 'file') { var au = new root.Audio('/api/alert-sound?t=' + (s.fileAt || 0)); au.volume = vol; au.play().catch(function () {}); return; }
      var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; ctx = ctx || new AC();
      [880, 1320].forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + i * 0.18;
        o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35 * vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
        o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.17);
      });
    } catch (e) {}
  }
  bus.test = function (kind) { sound(kind === 'box' ? 'Box this lap' : 'Push. 4.5 percent a lap'); };

  // ---------- the widget ----------
  var SL = P.colorSlots('alert', [['bg', 'Background', 'panel'], ['push', 'PUSH', 'green'], ['lift', 'LIFT', 'yellow'], ['box', 'BOX THIS LAP', 'red'], ['measure', 'Measuring', 'blue'],
    ['text', 'Text', 'white'], ['small', 'Small text', 'muted']]), K = SL.K;
  var COL = { push: K.push, lift: K.lift, box: K.box, measure: K.measure };
  P.registerWidget({ type: 'alert', title: 'Race alerts', base: { w: 1100, h: 250 }, defaults: { show: { float: true } }, colors: SL.list,
    create: function (host, ctx2) {
      var el = D.el('div', 'pw-alert', host), s = el.style; s.position = 'absolute'; s.left = '0'; s.top = '0'; s.width = '1100px'; s.height = '250px'; s.transformOrigin = '0 0';
      var big = D.el('div', 'pw-alert-big', el), mid = D.el('div', 'pw-alert-mid', el), small = D.el('div', 'pw-alert-small', el), bar = D.el('div', 'pw-alert-btns', el);
      [['accept', 'Accept'], ['ignore', 'Ignore'], ['later', 'Later']].forEach(function (b) { var x = D.el('button', '', bar); x.textContent = b[1]; x.addEventListener('click', function (ev) { ev.stopPropagation(); bus.act(b[0]); }); });
      function draw() {
        var a = bus.cur, edit = root.pitwall && root.pitwall.edit;
        var v = a || (edit ? { kind: 'push', big: 'PUSH', mid: '4.55% a lap (was 4.00%)', small: 'Race alerts show here (example)' } : null);
        D.show(el, !!v); if (!v) return;
        el.style.borderColor = COL[v.kind] || K.text; big.style.color = COL[v.kind] || K.text; el.style.backgroundColor = K.bg; mid.style.color = K.text; small.style.color = K.small;
        D.text(big, v.big); D.text(mid, v.mid); D.text(small, v.small || ''); D.show(bar, !!a);
      }
      bus.widgets.push(draw); start(); draw();
      return {
        update: function (state) { bus.state = state; draw(); },
        resize: function (w, h) { var k = Math.min(w / 1100, h / 250); s.transform = 'scale(' + k + ')'; },
        destroy: function () { var i = bus.widgets.indexOf(draw); if (i >= 0) bus.widgets.splice(i, 1); stop(); if (el.parentNode) el.parentNode.removeChild(el); }
      };
    } });
})(typeof window !== 'undefined' ? window : globalThis);
