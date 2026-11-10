// Quick race page: one race, no plan file. The inputs are kept in this browser / the app's WebView (pw-quick); maths in strategy-math.js (quickPlan, parseEvent).
// In the app it fills itself from the game (api/race-live: track, class, race length, tank / VE limit, best lap, use per lap) and follows it until you edit a field.
(function (root) {
  'use strict';
  var P = root.MyLMUHub, F = P.format, R = P.paceRef, SM = P.strategyMath, H = P.hub, esc = H.esc;
  function $(id) { return document.getElementById(id); }
  var CLASSES = [['LMH', 'Hypercar'], ['LMP2wec', 'LMP2'], ['LMP2elms', 'LMP2 ELMS'], ['LMP3', 'LMP3'], ['LMGT3', 'GT3'], ['GTE', 'GTE']];
  var FUEL = { LMP2wec: 1, LMP2elms: 1, LMP3: 1, GTE: 1 };                            // classes that race on fuel; the others on virtual energy
  var q = load(), ref = {}, myNames = [];
  H.header('strategy');

  function load() {
    var d = { track: '', cls: 'LMGT3', length: { kind: 'time', time: 3600, laps: 0 }, unit: 've', lap: 0, perLap: 0, max: 100, reserve: 1, pitLoss: 30, limits: {}, event: '' };
    try { var s = JSON.parse(localStorage.getItem('pw-quick')); if (s) for (var k in s) d[k] = s[k]; } catch (e) {}
    return d;
  }
  function save() { try { localStorage.setItem('pw-quick', JSON.stringify(q)); } catch (e) {} }

  // ---------- form ----------
  function parseDur(s) { var m = /^\s*(\d+)(?::(\d{1,2}))?\s*$/.exec(s || ''); return m ? Number(m[1]) * 3600 + Number(m[2] || 0) * 60 : 0; }
  function segOn(id, v) { [].forEach.call($(id).children, function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); }); }
  function fill() {
    var tracks = Object.keys(ref).sort(); if (q.track && tracks.indexOf(q.track) < 0) tracks.unshift(q.track);
    $('trackSel').innerHTML = '<option value="">Choose a track</option>' + tracks.map(function (t) { return '<option' + (t === q.track ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
    $('clsSel').innerHTML = CLASSES.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === q.cls ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('');
    [].forEach.call(document.querySelectorAll('[data-k]'), function (e) { var v = q[e.getAttribute('data-k')]; if (e.tagName !== 'SELECT') e.value = v ? v : (v === 0 && e.getAttribute('data-k') === 'reserve' ? 0 : ''); });
    segOn('segLen', q.length.kind); segOn('segUnit', q.unit);
    $('lenInput').value = q.length.kind === 'laps' ? (q.length.laps || '') : F.hm(q.length.time); $('lenInput').placeholder = q.length.kind === 'laps' ? 'laps' : 'h:mm';
    $('lapInput').value = q.lap > 0 ? F.lap(q.lap) : '';
    $('evText').value = q.event || '';
    unitLabels();
  }
  function unitLabels() {
    var fuel = q.unit === 'fuel', lim = (q.limits || {})[q.cls];
    $('fPer').firstChild.textContent = fuel ? 'Fuel per lap (L)' : 'VE per lap (%)';
    $('fMax').firstChild.textContent = fuel ? 'Tank / most fuel allowed (L)' : 'Most VE allowed (%)';
    $('evInfo').textContent = lim ? 'Event limit for this class: ' + (lim.ve ? lim.ve + ' % VE' : '') + (lim.ve && lim.fuel ? ', ' : '') + (lim.fuel ? lim.fuel + ' L fuel' : '') : $('evInfo').textContent;
  }
  [].forEach.call(document.querySelectorAll('[data-k]'), function (e) {
    e.addEventListener(e.tagName === 'SELECT' ? 'change' : 'input', function () {
      var k = e.getAttribute('data-k'); q[k] = e.hasAttribute('data-num') ? Number(e.value) || 0 : e.value; q.manual = true;
      if (k === 'cls') classChanged();
      render(); save();
    });
  });
  // another class: its unit (fuel / VE) and the event's limit for it
  function classChanged() {
    q.unit = FUEL[q.cls] ? 'fuel' : 've'; segOn('segUnit', q.unit);
    var lim = (q.limits || {})[q.cls]; if (lim) q.max = q.unit === 'fuel' ? (lim.fuel || q.max) : (lim.ve || q.max);
    else if (q.unit === 've' && !(q.max > 0)) q.max = 100;
    fill();
  }
  function seg(id, fn) { $(id).onclick = function (e) { var b = e.target.closest('button'); if (!b) return; segOn(id, b.getAttribute('data-v')); fn(b.getAttribute('data-v')); render(); save(); }; }
  seg('segLen', function (v) { q.length.kind = v; $('lenInput').value = v === 'laps' ? (q.length.laps || '') : F.hm(q.length.time); $('lenInput').placeholder = v === 'laps' ? 'laps' : 'h:mm'; });
  seg('segUnit', function (v) { q.unit = v; unitLabels(); });
  $('lenInput').oninput = function () { q.manual = true; if (q.length.kind === 'laps') q.length.laps = Math.round(Number(this.value) || 0); else q.length.time = parseDur(this.value); render(); save(); };
  $('lapInput').oninput = function () { q.manual = true; q.lap = R.secs(this.value) || 0; render(); save(); };

  // ---------- the event text ----------
  $('evBtn').onclick = function () {
    q.event = $('evText').value; var e = SM.parseEvent(q.event), got = [];
    if (e.track) { var n = R.trackName(e.track, '') || e.track; q.track = n; got.push(n); }
    if (e.length) { q.length = { kind: e.length.kind, time: e.length.time || 0, laps: e.length.laps || 0 }; got.push(e.length.kind === 'laps' ? e.length.laps + ' laps' : F.hm(e.length.time) + ' h'); }
    q.limits = e.classes; var names = Object.keys(e.classes);
    if (names.length && !e.classes[q.cls]) q.cls = names[names.length - 1];
    names.forEach(function (c) { var l = e.classes[c]; got.push((CLASSES.filter(function (x) { return x[0] === c; })[0] || [0, c])[1] + ' ' + (l.ve ? l.ve + ' % VE' : '') + (l.fuel ? l.fuel + ' L' : '')); });
    classChanged(); render(); save();
    $('evInfo').textContent = got.length ? 'Read: ' + got.join(' · ') : 'Nothing found in that text.';
  };

  // ---------- from the game (live) ----------
  // In the app the page fills ITSELF from the game (api/race-live: session, followed car, event) and keeps following it (use per lap gets better every lap)
  // until you type in a field; "Take from the game" (or another session) makes it follow again. Event = the game's own race length, tank and laps-per-tank.
  var live = null;
  function poll() {
    H.json('api/race-live').then(function (x) {
      live = x; var s = x.session, c = x.car, ev = x.event;
      $('lbChip').textContent = 'GAME'; $('lbChip').className = 'lb-chip ' + (s ? 'live' : '');
      $('lbMain').textContent = s ? [F.sessionName(s.id), s.track, c && c.driver, c && c.cls].filter(Boolean).join(' · ') : 'Not running';
      if (!s || !c) { $('lbSub').textContent = 'Join a session: the app reads track, class, race length, tank, lap time and use per lap.'; return; }
      var key = [s.track, c.cls, s.id, ev ? ev.raceMinutes + '/' + ev.raceLaps : ''].join('|');
      if (key !== q.autoKey) { q.autoKey = key; q.manual = false; }
      var got = q.manual ? null : applyGame();
      var off = ev && /^off$/i.test(ev.fuelUse || '');
      $('lbSub').textContent = (off ? 'Fuel use is OFF in this lobby. ' : '') + (q.manual ? 'You changed a value: not following the game (press "Take from the game" to follow again).'
        : 'Following the game' + (got && got.length ? ': ' + got.join(', ') : '') + '.');
    }, function () { live = null; $('lbMain').textContent = 'Not running'; });
  }
  // fills the form from the game; returns what it took
  function applyGame() {
    var s = live && live.session, c = live && live.car, ev = (live && live.event) || {}, got = [], before = JSON.stringify(q);
    if (!s || !c) return got;
    var t = R.trackName(s.track, ''); if (t) { q.track = t; got.push('track'); }
    var cl = R.className(c.cls); if (cl && cl !== q.cls) { q.cls = cl; classChanged(); } if (cl) got.push('class');
    if (c.best > 0) { q.lap = Math.round(c.best * 1000) / 1000; got.push('best lap'); }
    else if (c.est > 0) { q.lap = Math.round(c.est * 1000) / 1000; got.push('lap time (game estimate)'); }
    var fuel = q.unit === 'fuel', lim = (q.limits || {})[q.cls] || {};
    var max = fuel ? (lim.fuel || (ev.tank > 0 ? ev.tank : (c.fuelCap > 0 ? c.fuelCap : 0))) : (lim.ve || (ev.veMax > 0 ? Math.min(100, ev.veMax) : 0));
    if (max > 0) { q.max = Math.round(max * 10) / 10; got.push(fuel ? 'tank' : 'VE allowed'); }
    var use = fuel ? c.fuelUse : c.veUse;
    if (use > 0) { q.perLap = Math.round(use * 100) / 100; got.push('use per lap'); }
    else {                                                                                  // no lap of yours yet: the game's own laps-per-tank estimate
      var full = fuel ? ev.fuelLapsFull : ev.veLapsFull, amt = fuel ? ev.tank : ev.veMax;
      if (full > 0 && amt > 0) { q.perLap = Math.round(amt / full * 100) / 100; got.push('use per lap (game estimate)'); }
    }
    if (ev.raceLaps > 0 && /lap/i.test(ev.finishBy || '') && !/time/i.test(ev.finishBy || '')) { q.length = { kind: 'laps', time: 0, laps: ev.raceLaps }; got.push('race laps'); }
    else if (ev.raceMinutes > 0) { q.length = { kind: 'time', time: Math.round(ev.raceMinutes) * 60, laps: 0 }; got.push('race length'); }
    else if (s.id >= 10 && s.id <= 13 && s.endEt > 0 && !s.maxLaps) { q.length = { kind: 'time', time: Math.round(s.endEt / 60) * 60, laps: 0 }; got.push('race length'); }
    else if (s.maxLaps > 0 && s.id >= 10) { q.length = { kind: 'laps', time: 0, laps: s.maxLaps }; got.push('race laps'); }
    if (JSON.stringify(q) !== before) { fill(); render(); save(); }
    return got;
  }
  $('gameBtn').onclick = function () {
    if (!live || !live.session || !live.car) { $('lbSub').textContent = 'No game data yet: join a session.'; return; }
    q.manual = false; applyGame(); poll();
  };
  // ---------- from the result files ----------
  $('fileBtn').onclick = function () {
    if (!q.track) { $('fillInfo').textContent = 'Choose a track first.'; return; }
    $('fillInfo').textContent = 'Reading your result files...';
    H.loadPace(function (i) { $('fillInfo').textContent = 'Reading result files: ' + i.done + ' / ' + i.total; }, function (data) {
      if (data.error) { $('fillInfo').textContent = data.error; return; }
      var current = 0; data.sessions.forEach(function (s) { var m = R.major(s.version); if (m > current) current = m; });
      var mine = data.sessions.filter(function (s) {
        var rf = ref[R.trackName(s.track, s.layout)], c = rf && rf[R.className(s['class'])];
        return R.trackName(s.track, s.layout) === q.track && R.className(s['class']) === q.cls && !R.isOld(s.version, c && c.patch, current);
      });
      if (!mine.length) { $('fillInfo').textContent = 'No sessions of yours on ' + q.track + ' in this class on the current game version.'; return; }
      var races = mine.filter(function (s) { return s.type === 'Race'; }), src = SM.fromSessions(races, 0.05);
      if (src.laps < 5) { races = mine; src = SM.fromSessions(mine, 0.05); }
      var got = [];
      if (src.lap) { q.lap = Math.round(src.lap * 1000) / 1000; got.push('lap time'); }
      if (q.unit === 've' && src.vePerLap) { q.perLap = Math.round(src.vePerLap * 100) / 100; got.push('VE per lap'); }
      if (src.pitLoss) { q.pitLoss = Math.round(src.pitLoss); got.push('pit stop time'); }
      fill(); render(); save();
      $('fillInfo').textContent = (got.length ? 'Filled ' + got.join(', ') : 'Nothing to fill') + ' from ' + src.laps + ' laps in ' + races.length + ' sessions.' + (q.unit === 'fuel' ? ' Fuel per lap: take it from the game.' : '');
    });
  };

  // ---------- the result ----------
  function tile(k, v, n, cls) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="n">' + (n || '') + '</div></div>'; }
  function amount(v) { return v === null || v === undefined ? '--' : (q.unit === 'fuel' ? v + ' L' : v + ' %'); }
  function render() {
    var r = SM.quickPlan(q), unit = q.unit === 'fuel' ? 'fuel' : 'VE', first = r.stints[0];
    $('advice').textContent = !first ? '--' : r.stops === 0 ? 'No stop: start with ' + amount(first.fill) + ' ' + unit + (q.max > 0 ? ' (' + amount(q.max) + ' allowed)' : '')
      : r.stops + (r.stops === 1 ? ' stop' : ' stops') + ': start full (' + amount(first.fill) + '), stop ' + r.stints.slice(1).map(function (s) { return 'around lap ' + (s.fromLap - 1) + ' and fill to ' + amount(s.fill); }).join(', then ');
    $('qTiles').innerHTML = tile('Laps', r.laps || '--', 'expected at the finish') + tile('Pit stops', r.stints.length ? r.stops : '--', isFinite(r.lapsPerFill) ? 'up to ' + r.lapsPerFill + ' laps a fill' : '') +
      tile('Start with', first ? amount(first.fill) : '--', unit + (r.stops === 0 && first && q.max > 0 && first.fill < q.max ? ', ' + amount(Math.round((q.max - first.fill) * 10) / 10) + ' less than allowed' : '')) +
      tile('Used in the race', q.perLap > 0 && r.laps ? amount(Math.round(r.laps * q.perLap * 10) / 10) : '--', q.reserve > 0 ? '+ ' + q.reserve + ' spare lap' + (q.reserve === 1 ? '' : 's') + ' a stint' : '');
    $('qWarn').innerHTML = r.warnings.map(function (w) { return '<div class="warnbox">' + esc(w) + '</div>'; }).join('');
    var t = '<thead><tr><th class="num">Stint</th><th class="num">Laps</th><th class="num">Fill to</th><th class="num">Add at the stop</th><th class="num">Pit window</th></tr></thead><tbody>';
    r.stints.forEach(function (s) {
      t += '<tr><td class="num">' + s.n + '</td><td class="num">' + s.laps + '<span class="two">' + s.fromLap + '-' + s.toLap + '</span></td><td class="num"><b>' + amount(s.fill) + '</b></td>' +
        '<td class="num">' + (s.add !== null ? amount(Math.round(s.add * 10) / 10) : (s.n === 1 ? 'start' : '--')) + '</td><td class="num">' + (s.window ? 'laps ' + s.window[0] + '-' + s.window[1] : '--') + '</td></tr>';
    });
    $('qTbl').innerHTML = t + '</tbody>';
  }

  // ---------- start ----------
  var refP = H.inApp ? H.json('api/reference') : fetch('data/alien-times.csv').then(function (r) { return r.text(); }).then(function (csv) { return { csv: csv }; });
  refP.then(function (r) { ref = R.parse(r.csv); fill(); }, function () { fill(); });
  fill(); render();
  if (H.inApp) { H.json('api/pace?light=1').then(function (i) { myNames = i.names || []; H.setWho(myNames[0]); }, function () {}); poll(); setInterval(poll, 3000); }
})(typeof window !== 'undefined' ? window : globalThis);
