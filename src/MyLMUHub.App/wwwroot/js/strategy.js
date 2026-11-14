// Strategy page: your plans (api/strategy, one JSON file; outside the app: this browser), the form, and the stint plan
// from strategy-math.js. "Fill from my result files" takes pace, VE per lap, tyre wear per lap and the pit stop loss from your Race Pace sessions on that track + class.
(function (root) {
  'use strict';
  var P = root.MyLMUHub, F = P.format, R = P.paceRef, SM = P.strategyMath, H = P.hub, esc = H.esc;
  function $(id) { return document.getElementById(id); }
  var CLASSES = [['LMH', 'Hypercar'], ['LMP2wec', 'LMP2'], ['LMP2elms', 'LMP2 ELMS'], ['LMP3', 'LMP3'], ['LMGT3', 'GT3'], ['GTE', 'GTE']];
  var DRIVER_COLORS = ['var(--lime)', 'var(--blue)', 'var(--purple)', 'var(--yellow)', 'var(--cyan)', 'var(--red)'];
  var store = { current: '', plans: [] }, plan = null, ref = {}, myNames = [];
  H.header('strategy');

  // ---------- plans: load / save ----------
  function blank() {
    return { id: 'p' + Date.now().toString(36), name: 'New plan', track: '', cls: 'LMGT3', car: '', length: { kind: 'time', time: 6 * 3600, laps: 0 }, start: '',
      ve: { mode: 'laps', laps: 0, perLap: 0, max: 100, reserve: 1 }, pit: { base: 30, tyres: 0, swap: 0 },
      tyres: { mode: 'stints', every: 2, wearPerLap: 0, minLeft: 30, compound: 'Medium', sets: 0 },
      drivers: [{ name: myNames[0] || '', lap: 0, maxStints: 0, maxTime: 0, minTime: 0 }], stints: [] };
  }
  function load() {
    var p = H.inApp ? H.json('api/strategy').catch(function () { return null; })
      : Promise.resolve((function () { try { return JSON.parse(localStorage.getItem('pw-strategy')); } catch (e) { return null; } })());
    p.then(function (s) {
      if (s && Array.isArray(s.plans)) store = s;
      if (!store.plans.length) store.plans.push(blank());
      choose(store.current);
    });
  }
  var timer = null;
  function saveSoon() {
    $('saved').textContent = '';
    clearTimeout(timer); timer = setTimeout(function () {
      store.current = plan.id; var body = JSON.stringify(store);
      if (H.inApp) fetch('api/strategy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body }).then(function (r) { $('saved').textContent = r.ok ? 'Saved' : 'Not saved'; }, function () { $('saved').textContent = 'Not saved'; });
      else { try { localStorage.setItem('pw-strategy', body); $('saved').textContent = 'Saved in this browser'; } catch (e) { $('saved').textContent = 'Not saved'; } }
    }, 400);
  }
  function choose(id) {
    plan = store.plans.filter(function (p) { return p.id === id; })[0] || store.plans[0];
    if (plan.length && plan.length.time >= 100 * 3600) plan.length.time = parseDur(String(Math.round(plan.length.time / 3600)));   // "800" was read as 800 h: it meant 8:00
    $('planSel').innerHTML = store.plans.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p === plan ? ' selected' : '') + '>' + esc(p.name || 'Unnamed') + '</option>'; }).join('');
    fillForm(); drivers(); render(); fromRace();
  }
  $('planSel').onchange = function () { choose(this.value); saveSoon(); };
  $('newBtn').onclick = function () { var p = blank(); store.plans.push(p); choose(p.id); saveSoon(); };
  $('copyBtn').onclick = function () { var p = JSON.parse(JSON.stringify(plan)); p.id = 'p' + Date.now().toString(36); p.name = plan.name + ' (copy)'; store.plans.push(p); choose(p.id); saveSoon(); };
  $('delBtn').onclick = function () {
    if (!confirm('Delete the plan "' + plan.name + '"?')) return;
    store.plans = store.plans.filter(function (p) { return p !== plan; }); if (!store.plans.length) store.plans.push(blank());
    choose(store.plans[0].id); saveSoon();
  };

  // ---------- the form (data-k = the plan field: "ve.perLap") ----------
  function get(path) { return path.split('.').reduce(function (o, k) { return o ? o[k] : undefined; }, plan); }
  function set(path, v) { var ks = path.split('.'), o = plan; for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || {}; o[ks[ks.length - 1]] = v; }
  var parseDur = SM.parseDur;                                                        // "8:00" / "8" / "800" -> s
  function fillForm() {
    [].forEach.call(document.querySelectorAll('[data-k]'), function (e) { var v = get(e.getAttribute('data-k')); e.value = v === undefined || v === null ? '' : v; });
    if (!plan.ve.mode) plan.ve.mode = 'perLap';                                       // plans made before the choice existed
    segOn('segLen', plan.length.kind); segOn('segTyre', plan.tyres.mode); segOn('segVe', plan.ve.mode); veFields();
    $('lenInput').value = plan.length.kind === 'laps' ? (plan.length.laps || '') : F.hm(plan.length.time);
    $('lenInput').placeholder = plan.length.kind === 'laps' ? 'laps' : 'h:mm'; lenHint();
    tyreFields(); options(); $('fillInfo').textContent = '';
  }
  [].forEach.call(document.querySelectorAll('[data-k]'), function (e) {
    e.addEventListener(e.tagName === 'SELECT' ? 'change' : 'input', function () {
      var k = e.getAttribute('data-k'), v = e.hasAttribute('data-num') ? (k === 've.push' && e.value.trim() === '' ? null : Number(e.value) || 0) : e.value; set(k, v);   // push empty = the default 15 %
      if (k === 'name') $('planSel').options[$('planSel').selectedIndex].textContent = v || 'Unnamed';
      render(); saveSoon();
    });
  });
  function segOn(id, v) { [].forEach.call($(id).children, function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); }); }
  function seg(id, fn) { $(id).onclick = function (e) { var b = e.target.closest('button'); if (!b) return; segOn(id, b.getAttribute('data-v')); fn(b.getAttribute('data-v')); render(); saveSoon(); }; }
  seg('segLen', function (v) { plan.length.kind = v; $('lenInput').value = v === 'laps' ? (plan.length.laps || '') : F.hm(plan.length.time); $('lenInput').placeholder = v === 'laps' ? 'laps' : 'h:mm'; lenHint(); fromRace(); });
  seg('segTyre', function (v) { plan.tyres.mode = v; tyreFields(); });
  seg('segVe', function (v) { plan.ve.mode = v; veFields(); });
  function veFields() { var l = plan.ve.mode === 'laps'; $('fVeLaps').hidden = !l; $('fVePer').hidden = l; }
  $('lenInput').oninput = function () { if (plan.length.kind === 'laps') plan.length.laps = Math.round(Number(this.value) || 0); else plan.length.time = parseDur(this.value); lenHint(); render(); fromRace(); saveSoon(); };
  // what the race length box was read as: "= 8 h" ("800" = 8:00)
  function lenText() { var m = Math.round(plan.length.time / 60); return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : ''); }
  function lenHint() {
    $('lenHint').textContent = plan.length.kind === 'laps' ? '' : plan.length.time > 0 ? '= ' + lenText() : 'type hours:minutes, e.g. 8:00';
  }
  function tyreFields() { var w = plan.tyres.mode === 'wear'; $('fEvery').hidden = w; $('fMin').hidden = !w; }
  // track (the sheet's tracks) and class lists
  function options() {
    var tracks = Object.keys(ref).sort(); if (plan.track && tracks.indexOf(plan.track) < 0) tracks.unshift(plan.track);
    $('trackSel').innerHTML = '<option value="">Choose a track</option>' + tracks.map(function (t) { return '<option' + (t === plan.track ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
    $('clsSel').innerHTML = CLASSES.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === plan.cls ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('');
  }

  // drivers table: inputs edit the plan in place (no redraw while typing)
  function drivers() {
    var h = '<thead><tr><th></th><th>Full name (as in the game)</th><th>Lap time</th><th>Most stints in a row</th><th>Most drive time (h:mm)</th><th>Least drive time (h:mm)</th><th></th></tr></thead><tbody>';
    plan.drivers.forEach(function (d, i) {
      h += '<tr data-i="' + i + '"><td><span class="dot" style="background:' + DRIVER_COLORS[i % DRIVER_COLORS.length] + '"></span></td>' +
        '<td><input class="input" data-f="name" value="' + esc(d.name) + '" style="min-width:220px"></td>' +
        '<td><input class="input short mono" data-f="lap" value="' + (d.lap > 0 ? F.lap(d.lap) : '') + '" placeholder="1:52.400"></td>' +
        '<td><input class="input short" data-f="maxStints" value="' + (d.maxStints || '') + '" placeholder="no limit"></td>' +
        '<td><input class="input short" data-f="maxTime" value="' + (d.maxTime ? F.hm(d.maxTime) : '') + '" placeholder="none"></td>' +
        '<td><input class="input short" data-f="minTime" value="' + (d.minTime ? F.hm(d.minTime) : '') + '" placeholder="none"></td>' +
        '<td>' + (plan.drivers.length > 1 ? '<button class="xbtn" data-del="' + i + '" title="Remove">&times;</button>' : '') + '</td></tr>';
    });
    $('drvTbl').innerHTML = h + '</tbody>';
  }
  $('drvTbl').oninput = function (e) {
    var f = e.target.getAttribute('data-f'), tr = e.target.closest('tr[data-i]'); if (!f || !tr) return;
    var d = plan.drivers[Number(tr.getAttribute('data-i'))], v = e.target.value;
    if (f === 'name') d.name = v.trim();
    else if (f === 'lap') d.lap = R.secs(v) || 0;
    else if (f === 'maxStints') d.maxStints = Math.round(Number(v) || 0);
    else d[f] = parseDur(v);
    render(); saveSoon();
  };
  $('drvTbl').onclick = function (e) { var i = e.target.getAttribute('data-del'); if (i === null) return; plan.drivers.splice(Number(i), 1); drivers(); render(); saveSoon(); };
  $('addDrv').onclick = function () { var last = plan.drivers[plan.drivers.length - 1]; plan.drivers.push({ name: '', lap: last ? last.lap : 0, maxStints: 0, maxTime: 0, minTime: 0 }); drivers(); render(); saveSoon(); };

  // ---------- the stint plan ----------
  function plannedMs() { var t = plan.start ? Date.parse(plan.start) : NaN; return isFinite(t) ? t : NaN; }
  function startMs() { return plannedMs(); }
  function at(raceSec) { var g = startMs(); return F.clock(raceSec) + (isFinite(g) ? '<span class="two">' + F.wallClock(SM.clockAt(g, raceSec)) + '</span>' : ''); }
  function color(name) { for (var i = 0; i < plan.drivers.length; i++) if (plan.drivers[i].name === name) return DRIVER_COLORS[i % DRIVER_COLORS.length]; return 'var(--muted)'; }
  function tile(k, v, n, cls) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="n">' + (n || '') + '</div></div>'; }
  function render() {
    if (!plan) return;
    var fol = false, pure = SM.build(plan), r = pure, g = startMs(), cls = (CLASSES.filter(function (c) { return c[0] === plan.cls; })[0] || [0, plan.cls])[1];
    $('planSub').textContent = [plan.track || 'no track yet', cls, plan.car, plan.length.kind === 'laps' ? plan.length.laps + ' laps' : F.hm(plan.length.time) + ' h race',
      isFinite(g) ? 'green flag ' + F.wallClock(g) : 'no start time: clock times hidden'].filter(Boolean).join(' · ');
    var maxL = SM.stintLaps(plan.ve);
    var h = tile('Stints', r.stints.length, isFinite(maxL) ? 'up to ' + maxL + ' laps each' : 'set the VE per lap') + tile('Pit stops', r.stops, r.stints.filter(function (s) { return s.newSet; }).length - 1 + ' tyre changes') +
      tile('Laps', r.laps || '--', 'expected at the finish') + tile('Finish', F.clock(r.end), isFinite(g) ? F.wallClock(SM.clockAt(g, r.end)) : 'race time');
    plan.drivers.forEach(function (d) { var x = r.drivers[d.name]; if (x) h += tile(d.name || 'Driver', F.hm(x.time), x.stints + ' stints · ' + x.laps + ' laps'); });
    $('sumTiles').innerHTML = h;
    $('warn').innerHTML = r.warnings.map(function (w) { return '<div class="warnbox">' + esc(w) + '</div>'; }).join('');
    // timeline: one block per stint (its share of the race), driver colour; a white edge = new tyres
    $('timeline').innerHTML = r.stints.map(function (s) {
      var w = (s.end - s.start + (s.stop ? s.stop.loss : 0)) / r.end * 100;
      return '<div class="' + (s.newSet ? 'tyre' : '') + '" style="width:' + w.toFixed(3) + '%;background:' + color(s.driver) + '" title="Stint ' + s.n + ': ' + esc(s.driver) + ', ' + s.laps + ' laps">' + (w > 3 ? s.n : '') + '</div>';
    }).join('');
    $('tlLegend').innerHTML = plan.drivers.map(function (d, i) { return '<span><i style="background:' + DRIVER_COLORS[i % DRIVER_COLORS.length] + '"></i>' + esc(d.name || 'Driver ' + (i + 1)) + '</span>'; }).join('') +
      '<span class="faint">White edge = new tyres</span>';
    // stint table: driver / laps / tyres are editable (your change = lime edge); VE: what a lap may use (and what is left, when your VE use is known)
    var t = '<thead><tr><th class="num">#</th><th>Driver</th><th class="num">Laps</th><th class="num">Start</th><th class="num">End</th><th class="num">Lap time</th><th class="num">VE / lap allowed</th><th class="num">VE left</th><th>Tyres</th><th>Stop after</th><th></th></tr></thead><tbody>';
    r.stints.forEach(function (s) {
      var k = s.n - 1, ov = (plan.stints || [])[k] || {}, any = s.changed.driver || s.changed.laps || s.changed.tyres, real = s.state === 'done' || s.state === 'now';
      var p0 = pure.stints[k], adjusted = fol && s.state === 'plan' && (!p0 || p0.laps !== s.laps || Math.abs(p0.start - s.start) > 60);   // differs from your plan
      var tag = s.state === 'done' ? ' <span class="chip dim">DONE</span>' : (s.state === 'now' ? ' <span class="chip lime">NOW</span>' : (adjusted ? ' <span class="chip pit">ADJUSTED</span>' : ''));
      t += '<tr data-k="' + k + '" class="' + (s.state || '') + (any && !real ? ' edited' : '') + '"><td class="num">' + s.n + '</td>' +
        '<td><span class="dot" style="background:' + color(s.driver) + '"></span>' + (real ? esc(s.driver) + tag : '<select class="sel cell' + (s.changed.driver ? ' on' : '') + '" data-o="driver"><option value="">' + esc(ov.driver ? 'Automatic' : s.driver) + '</option>' +
          plan.drivers.filter(function (d) { return d.name; }).map(function (d) { return '<option' + (ov.driver === d.name ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select>' + tag) + '</td>' +
        '<td class="num">' + (real ? s.laps : '<input class="input cell mono' + (s.changed.laps ? ' on' : '') + '" data-o="laps" value="' + (ov.laps || '') + '" placeholder="' + s.laps + '">') +
          '<span class="two">' + s.fromLap + '-' + s.toLap + '</span></td>' +
        '<td class="num">' + at(s.start) + (adjusted && p0 ? '<span class="two">' + F.diff((s.start - p0.start) / 60, 0) + ' min vs plan</span>' : '') + '</td><td class="num">' + at(s.end) + '</td><td class="num">' + F.lap(s.lap) + '</td>' +
        '<td class="num">' + (s.fill ? '<select class="sel cell" data-o="fill"><option value="">Save: fill ' + F.pct(s.fill.save, 0) + '</option><option value="push"' + (s.fill.mode === 'push' ? ' selected' : '') + '>Push: fill ' + F.pct(s.fill.push, 0) + '</option></select>' +
          '<span class="two">' + (s.fill.mode === 'push' ? F.pct(s.veNeed, 2) + ' per lap (' + '+' + Math.round(s.fill.room * 100) + ' %' + ') · save: fill ' + F.pct(s.fill.save, 0) : F.pct(s.fill.rate, 2) + ' per lap, as the rest · push: fill ' + F.pct(s.fill.push, 0) + ', ' + F.pct(s.fill.pushPerLap, 2) + ' per lap') + '</span>' :
          (s.veNeed ? F.pct(s.veNeed, 2) : '--')) + '</td><td class="num">' + (s.veLeft !== null ? F.pct(s.veLeft, 1) : '--') + '</td>' +
        '<td>' + (k === 0 ? '<span class="chip lime">NEW</span>' : real ? (s.newSet ? 'New' : 'Used') : '<select class="sel cell' + (s.changed.tyres ? ' on' : '') + '" data-o="tyres"><option value="">' + (ov.tyres ? 'Automatic' : (s.newSet ? 'New' : 'Used')) + '</option>' +
          '<option value="new"' + (ov.tyres === 'new' ? ' selected' : '') + '>New</option><option value="used"' + (ov.tyres === 'used' ? ' selected' : '') + '>Used</option></select>') +
          '<span class="two">' + esc(plan.tyres.compound) + ' · set ' + s.set + (s.wearEnd !== null && !real ? ' · ' + F.pct(Math.max(0, s.wearEnd)) + ' left at the end' : '') + '</span></td>' +
        '<td>' + (s.stop ? Math.round(s.stop.loss) + ' s' + (s.stop.real ? ' (real)' : '') + (s.stop.tyres ? ' · tyres' : '') + (s.stop.swap ? ' · swap to ' + esc(s.stop.next) : '') : '<span class="faint">finish</span>') + '</td>' +
        '<td>' + (any && !real ? '<button class="xbtn" data-undo="' + k + '" title="Back to automatic">&#8634;</button>' : '') + '</td></tr>';
    });
    if (!r.stints.length) t += '<tr><td colspan="11" class="empty">' + esc(r.warnings[0] || '') + '</td></tr>';
    $('stintTbl').innerHTML = t + '</tbody>';
    $('resetBtn').hidden = !(plan.stints || []).some(function (o) { return o && (o.driver || o.laps || o.tyres); });
  }
  // a change in the stint table: stored by stint position; the plan is built again (the stints after it follow on)
  function setOverride(k, key, v) {
    plan.stints = plan.stints || []; while (plan.stints.length <= k) plan.stints.push({});
    if (v) plan.stints[k][key] = v; else delete plan.stints[k][key];
    while (plan.stints.length && !Object.keys(plan.stints[plan.stints.length - 1]).length) plan.stints.pop();
    render(); saveSoon();
  }
  $('stintTbl').onchange = function (e) {
    var o = e.target.getAttribute('data-o'), tr = e.target.closest('tr[data-k]'); if (!o || !tr) return;
    setOverride(Number(tr.getAttribute('data-k')), o, o === 'laps' ? Math.max(0, Math.round(Number(e.target.value) || 0)) : e.target.value);
  };
  $('stintTbl').onclick = function (e) { var k = e.target.getAttribute('data-undo'); if (k === null) return; plan.stints[Number(k)] = {}; setOverride(Number(k), 'x', ''); };
  $('resetBtn').onclick = function () { plan.stints = []; render(); saveSoon(); };

  // the race live: the Live tab (live.html, live.js) follows it with a plan you pick there; this page is the plan only (owner 2026-11-12: the plan must not change
  // while you drive other races)

  // ---------- copy the stint pattern of a past race (your car, every driver: api/stints) ----------
  var pastList = null;
  $('pastBtn').onclick = function () {
    if (!H.inApp) { $('pastInfo').textContent = 'Open this page in the app to read your result files.'; return; }
    if (!pastList) {
      $('pastInfo').textContent = 'Reading your result files...';
      H.loadPace(function () {}, function (data) {
        var seen = {}; pastList = data.sessions.filter(function (s) { var last = s.laps.length ? s.laps[s.laps.length - 1][0] : 0; if (s.type !== 'Race' || s.live || last < 20 || seen[s.file]) return false; s.last = last; return (seen[s.file] = true); })
          .sort(function (a, b) { return b.time - a.time; });
        $('pastSel').innerHTML = '<option value="">Choose a race</option>' + pastList.map(function (s) { return '<option value="' + esc(s.file) + '">' + esc(F.day(s.time) + ' · ' + (R.trackName(s.track, s.layout) || s.track) + ' · ' + s.car + ' · ' + s.last + ' laps') + '</option>'; }).join('');
        $('pastSel').hidden = false; $('pastBtn').textContent = 'Copy';
        $('pastInfo').textContent = pastList.length ? 'Choose a race, then Copy: its drivers, stint lengths and tyre changes become your stint changes.' : 'No races of 20+ laps found.';
      });
      return;
    }
    var file = $('pastSel').value; if (!file) return;
    var s0 = pastList.filter(function (s) { return s.file === file; })[0];
    $('pastInfo').textContent = 'Reading ' + file + '...';
    H.json('api/stints?file=' + encodeURIComponent(file)).then(function (race) {
      var past = SM.pastStints(race.laps), sameTrack = R.trackName(race.track, race.layout) === plan.track, tyreInfo = past.filter(function (p) { return p.newTyres !== null; }).length;
      past.forEach(function (p) {
        if (p.driver && !plan.drivers.some(function (d) { return d.name === p.driver; })) {
          var first = plan.drivers[0]; if (first && !first.name) first.name = p.driver; else plan.drivers.push({ name: p.driver, lap: first ? first.lap : 0, maxStints: 0, maxTime: 0, minTime: 0 });
        }
      });
      // the last stint of a race is cut short by the finish: its laps are not copied
      plan.stints = past.map(function (p, i) { return { driver: p.driver || '', laps: sameTrack && i < past.length - 1 ? p.laps : 0, tyres: i === 0 || p.newTyres === null ? '' : (p.newTyres ? 'new' : 'used') }; });
      drivers(); render(); saveSoon();
      $('pastInfo').textContent = 'Copied ' + past.length + ' stints from ' + F.day(s0.time) + ' (' + (R.trackName(s0.track, s0.layout) || s0.track) + '): drivers' + (sameTrack ? ', stint lengths' : '') +
        (tyreInfo ? ', tyre changes (' + tyreInfo + ' stops with tyre data)' : '') + '.' + (sameTrack ? '' : ' Another track: stint lengths not copied.') +
        (tyreInfo < past.length - 1 ? ' The file has tyre wear only for the hours your game was connected; the other stops stay automatic.' : '') + ' Check the driver names and lap times above.';
    }, function () { $('pastInfo').textContent = 'Your car was not found in that race.'; });
  };

  // ---------- fill from the result files ----------
  $('fillBtn').onclick = function () {
    if (!plan.track) { $('fillInfo').textContent = 'Choose a track first.'; return; }
    $('fillInfo').textContent = 'Reading your result files...';
    H.loadPace(function (i) { $('fillInfo').textContent = 'Reading result files: ' + i.done + ' / ' + i.total; }, function (data) {
      if (data.error) { $('fillInfo').textContent = data.error; return; }
      var current = 0; data.sessions.forEach(function (s) { var m = R.major(s.version); if (m > current) current = m; });
      var mine = data.sessions.filter(function (s) {
        var rf = ref[R.trackName(s.track, s.layout)], c = rf && rf[R.className(s['class'])];
        return R.trackName(s.track, s.layout) === plan.track && R.className(s['class']) === plan.cls && !R.isOld(s.version, c && c.patch, current);
      });
      $('carList').innerHTML = mine.map(function (s) { return s.car; }).filter(function (c, i, a) { return a.indexOf(c) === i; }).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
      if (plan.car) { var byCar = mine.filter(function (s) { return s.car === plan.car; }); if (byCar.length) mine = byCar; }
      var races = mine.filter(function (s) { return s.type === 'Race'; }), src = SM.fromSessions(races, 0.05);
      if (src.laps < 5) { races = mine; src = SM.fromSessions(mine, 0.05); }
      if (!mine.length) { $('fillInfo').textContent = 'No sessions of yours on ' + plan.track + ' in this class on the current game version.'; return; }
      var done = [];
      if (src.lap) { plan.drivers.forEach(function (d) { if (myNames.indexOf(d.name) >= 0 || !(d.lap > 0)) d.lap = Math.round(src.lap * 1000) / 1000; }); done.push('lap time'); }
      if (src.vePerLap) {
        plan.ve.perLap = Math.round(src.vePerLap * 100) / 100; done.push('VE per lap');
        if (!(plan.ve.laps > 0)) { plan.ve.laps = SM.stintLaps({ perLap: plan.ve.perLap, max: plan.ve.max, reserve: plan.ve.reserve }); done.push('laps per stint'); }
      }
      if (src.wearPerLap) { plan.tyres.wearPerLap = Math.round(src.wearPerLap * 100) / 100; done.push('tyre wear'); }
      if (src.pitLoss) { plan.pit.base = Math.round(src.pitLoss); done.push('pit stop loss'); }
      fillForm(); drivers(); render(); saveSoon();
      $('fillInfo').textContent = (done.length ? 'Filled ' + done.join(', ') : 'Nothing to fill') + ' from ' + src.laps + ' counted laps in ' + races.length + ' sessions' +
        (src.veLaps ? ', VE from ' + src.veLaps + ' laps' : '') + (src.stops ? ', ' + src.stops + ' pit stops' : '') + '. Pit loss includes what was done in those stops.';
    });
  };

  // ---------- start from sessions you drove (Race Pace sessions, races and practice): the ticked ones together (strategy-math combine) -> the suggested
  // stint lengths (stintOptions) -> the plan. plan.from = { files: { file: 'push' | 'lift' | 'mixed' }, veStart, cost (typed, used while not measured) }
  var races = null, raceAsked = false, allTracks = false, showMore = false;
  function raceList() {
    if (!H.inApp || raceAsked) return; raceAsked = true;
    $('fromBody').innerHTML = '<div class="faint">Reading your sessions...</div>';
    H.loadPace(function () {}, function (data) {
      races = (data.sessions || []).filter(function (s) { return (s.type === 'Race' || s.type === 'Practice') && !s.live && s.laps.length >= 5; }).sort(function (a, b) { return b.time - a.time; });
      fromRace();
    });
  }
  function trackOf(s) { return R.trackName(s.track, s.layout) || s.track; }
  function fromState() {
    var fr = plan.from = plan.from || {};
    if (!fr.files) { fr.files = {}; if (fr.file) fr.files[fr.file] = fr.kind || 'push'; }                     // plans from before: their one session
    delete fr.file; delete fr.kind; delete fr.veLeft;
    if (!(fr.veStart > 0)) fr.veStart = plan.ve.max || 100;
    if (!Object.keys(fr.files).length && races) {                                                          // first time: your newest sessions here with VE (up to 3)
      races.filter(function (s) { return (!plan.track || trackOf(s) === plan.track) && s.laps.some(function (l) { return l[7] > 0; }); }).slice(0, 3).forEach(function (s) { fr.files[s.file] = 'push'; });
    }
    return fr;
  }
  var KINDS = [['push', 'Normal'], ['lift', 'Saving VE'], ['mixed', 'Mixed']];
  function fromRace() {
    if (!plan) return;
    if (!H.inApp) { $('fromBody').innerHTML = '<div class="faint">Open this page in the app: it reads your sessions from the result files.</div>'; return; }
    if (!races) { raceList(); return; }
    // the list: this plan's track and car (and any ticked session), newest first, 12 (Show more: 60); 'Other tracks and cars too': all
    var fr = fromState(), match = races.filter(function (s) { return allTracks || fr.files[s.file] || ((!plan.track || trackOf(s) === plan.track) && (!plan.car || s.car === plan.car)); });
    var here = match.slice(0, showMore ? 60 : 12), more = match.length - here.length;
    if (!here.length) { $('fromBody').innerHTML = '<div class="faint">No races or practice sessions' + (plan.track ? ' on ' + esc(plan.track) + (plan.car ? ' with the ' + esc(plan.car) : '') + ' yet: tick "Other tracks and cars too".' : ' found.') + '</div>'; return; }
    var picked = races.filter(function (s) { return fr.files[s.file]; }), c = SM.combine(picked.map(function (s) { return { s: s, kind: fr.files[s.file] }; }), { max: fr.veStart, reserve: plan.ve.reserve });
    var rowOf = {}; c.rows.forEach(function (r) { rowOf[r.s.file] = r; });
    // the sessions: tick, how you drove it, and its own numbers (so one that does not fit, e.g. other VE settings, stands out)
    var h = '<div class="scroll"><table class="tbl" id="sesTbl"><thead><tr><th></th><th>Session</th><th>Car</th><th class="num">Laps</th><th class="num">Pace</th><th class="num">VE / lap</th><th class="num">Tyre wear / lap</th><th>How you drove it</th></tr></thead><tbody>' +
      here.map(function (s) {
        var on = !!fr.files[s.file], x = on ? rowOf[s.file].x : SM.fromRace(s, { veStart: fr.veStart, reserve: plan.ve.reserve }), early = x.stops.some(function (p) { return p.early; });
        return '<tr data-f="' + esc(s.file) + '"' + (on ? '' : ' class="off"') + '><td><input type="checkbox" data-pick' + (on ? ' checked' : '') + ' style="accent-color:var(--lime);width:16px;height:16px"></td>' +
          '<td>' + esc(F.day(s.time) + ' · ' + s.type) + '<span class="two">' + esc(trackOf(s)) + (early ? ' · early stop left out' : '') + '</span></td><td>' + esc(s.car) + '</td><td class="num">' + s.laps[s.laps.length - 1][0] + '</td>' +
          '<td class="num">' + (x.pace ? F.lap(x.pace) : '--') + '</td><td class="num">' + (x.vePerLap && x.veFrom === 'file' ? F.pct(x.vePerLap, 2) : '<span class="faint">not recorded</span>') + '</td>' +
          '<td class="num">' + (x.wearPerLap ? F.pct(x.wearPerLap, 2) : '--') + '</td>' +
          '<td><select class="sel cell" data-kind' + (on ? '' : ' disabled') + '>' + KINDS.map(function (k) { return '<option value="' + k[0] + '"' + ((fr.files[s.file] || 'push') === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></td></tr>';
      }).join('') + '</tbody></table></div>' + (more > 0 || showMore ? '<div style="margin-top:6px"><button class="btn" id="moreBtn">' + (showMore ? 'Show fewer' : 'Show ' + Math.min(more, 48) + ' more') + '</button></div>' : '');
    if (!picked.length) { $('fromBody').innerHTML = h + '<div class="faint" style="margin-top:10px">Tick one or more sessions.</div>'; $('fromBody')._c = null; return; }
    // together
    var costTxt = c.costFrom === 'laps' ? 'measured from your laps' : c.costFrom === 'pair' ? 'from your normal vs saving sessions' :
      c.costNote === 'faster' ? 'not measured: your saving session was faster (other conditions or VE settings?)' : 'not measured yet';
    h += '<div class="tiles" style="margin-top:12px">' +
      tile('Pace', c.pace ? F.lap(c.pace) : '--', c.kind === 'lift' ? 'your saving sessions (no normal one ticked)' : 'median of your normal sessions (races first)') +
      tile('VE per lap, normal', c.vePush ? F.pct(c.vePush, 2) : '--', c.vePush ? 'no saving' : 'tick a session driven normally') +
      tile('VE per lap, saving', c.veLift ? F.pct(c.veLift, 2) : '--', c.veLift ? (c.paceLift ? 'at ' + F.lap(c.paceLift) : '') : 'tick a session where you lifted') +
      tile('Lifting costs', c.cost !== null ? F.plusSec(c.cost) + ' s' : '--', c.cost !== null ? 'per lap for 1 % less VE per lap · ' + costTxt : costTxt) +
      tile('Tyre wear per lap', c.wear ? F.pct(c.wear, 2) : '--', c.wear ? 'average of the ticked sessions' : 'not recorded') +
      tile('Pit stop', c.pitLoss ? Math.round(c.pitLoss) + ' s' : '--', c.pitLoss ? 'median of the normal stops in the ticked races' : 'no normal stop in the ticked races') + '</div>';
    var useCost = c.cost !== null ? c.cost : (fr.cost !== null && fr.cost !== undefined && fr.cost !== '' ? Number(fr.cost) : null);
    h += '<div class="form" style="margin-top:12px;max-width:620px"><label class="field">VE a stint starts with (%)<input class="input" id="veStartIn" data-num value="' + (fr.veStart || 100) + '"></label>' +
      (c.cost === null ? '<label class="field">Lifting 1 % VE per lap costs (s per lap, until measured)<input class="input" id="costIn" data-num value="' + (fr.cost !== null && fr.cost !== undefined ? fr.cost : '') + '" placeholder="e.g. 0.8"></label>' : '') + '</div>';
    if (c.cost === null) h += '<div class="faint" style="margin-top:4px">To measure it: tick a session you drove normally and one where you lifted (same track, car and VE settings).</div>';
    var meas = c.cost !== null ? Math.round(c.cost * 1000) / 1000 : null;                                  // kept with the plan: the race alerts use it
    if ((fr.measured || null) !== meas) { if (meas === null) delete fr.measured; else fr.measured = meas; saveSoon(); }
    // the suggestion
    // warnings: a pit stop that looks like a repair, a 'saving' session that used as much VE as a normal one
    var stopLoss = c.pitLoss || plan.pit.base, warn = '';
    if (!c.pitLoss && stopLoss > 100) warn += '<div class="warnbox">No normal pit stop in the ticked races, so the plan\'s pit stop time is used: <b>' + Math.round(stopLoss) + ' s</b>. That looks like a repair stop; a normal one is often 40-70 s. Set it under Energy &amp; stops, or tick a race with a normal stop.</div>';
    if (c.vePush && c.veLift && c.veLift >= c.vePush - 0.05) warn += '<div class="warnbox">Your "Saving VE" session used ' + F.pct(c.veLift, 2) + ' a lap, your "Normal" one ' + F.pct(c.vePush, 2) + ': no saving to learn from. Check how you marked them.</div>';
    var sg = SM.stintOptions({ pace: c.pace, rate: c.rate, cost: useCost }, { max: fr.veStart || 100, reserve: plan.ve.reserve, pitLoss: stopLoss, length: plan.length });
    if (sg.options.length) {
      var kd = c.kind;
      h += '<h3 style="margin:18px 0 4px 0">Suggested strategy</h3><div class="sub" style="margin:0 0 8px 0">Pace ' + F.lap(c.pace) + ', VE ' + F.pct(c.rate, 2) + ' per lap (' + (kd === 'lift' ? 'saving' : 'no saving') + '), stops at ' + Math.round(stopLoss) + ' s. ' +
        (sg.cost !== null ? 'Lifting costs ' + sg.cost.toFixed(2) + ' s per lap for 1 % less: BEST = the most laps, then the earliest finish.' :
          'What lifting costs is not known yet, so BEST is the best without extra lifting. A lifting option is only worth it if 1 % less VE per lap costs you less than the time in its last column.') + '</div>' + warn;
      h += '<div class="scroll" style="max-width:1200px"><table class="tbl"><thead><tr><th class="num">Stint</th><th class="num">VE per lap allowed</th><th class="num">' + (kd === 'lift' ? 'Save more than you did' : 'Save per lap') + '</th><th class="num">Lap time</th><th class="num">Stops</th><th class="num">' + (plan.length.kind === 'laps' ? 'Finish' : 'Laps in ' + esc(lenText())) + '</th>' + (sg.cost === null ? '<th class="num">Worth it if lifting costs under</th>' : '') + '<th></th></tr></thead><tbody>' +
        sg.options.map(function (o) {
          var best = sg.best === o, be = sg.cost !== null ? '' : '<td class="num">' + (o.breakEven === undefined ? '<span class="faint">--</span>' : o.breakEven === null ? '<span class="faint">never: saves nothing</span>' : o.breakEven.toFixed(2) + ' s / lap') + '</td>';
          return '<tr' + (best ? ' class="now"' : '') + '><td class="num"><b>' + o.laps + ' laps</b>' + (best ? ' <span class="chip lime">BEST</span>' : '') + '</td><td class="num">' + F.pct(o.perLap, 2) + '</td><td class="num">' + (o.save > 0 ? F.pct(o.save, 2) : '<span class="faint">none</span>') +
            '</td><td class="num">' + F.lap(o.lap) + '</td><td class="num">' + o.stops + '</td><td class="num">' + (plan.length.kind === 'laps' ? F.hms(o.end) : o.raceLaps) + '</td>' + be + '<td><button class="btn' + (best ? ' lime' : '') + '" data-use="' + o.laps + '" data-pace="' + o.lap.toFixed(3) + '">Plan this</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (c.rate) h += '<div class="sub" style="margin:14px 0 0 0">Set the race length (Event) to see the stint options.</div>';
    else h += '<div class="sub" style="margin:14px 0 0 0">None of the ticked sessions has VE per lap recorded: drive one with the app open.</div>';
    h += '<div class="go" style="margin-top:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center"><span class="faint" id="fromInfo"></span></div>';
    $('fromBody').innerHTML = h; $('fromBody')._c = c;
  }
  $('allTracks').onchange = function () { allTracks = this.checked; fromRace(); };
  $('fromBody').onchange = function (e) {
    var tr = e.target.closest('tr[data-f]'); if (!tr) return;
    var f = tr.getAttribute('data-f'), files = plan.from.files;
    if (e.target.hasAttribute('data-pick')) { if (e.target.checked) files[f] = files[f] || 'push'; else delete files[f]; }
    else if (e.target.hasAttribute('data-kind')) files[f] = e.target.value;
    fromRace(); saveSoon();
  };
  $('fromBody').oninput = function (e) {
    if (e.target.id !== 'veStartIn' && e.target.id !== 'costIn') return;
    var v = e.target.value.trim() === '' ? null : Number(e.target.value.replace(',', '.'));
    if (e.target.id === 'costIn') plan.from.cost = isFinite(v) && v !== null && v >= 0 ? v : null; else plan.from.veStart = v > 0 ? v : 100;
    var id = e.target.id, pos = e.target.selectionStart; fromRace(); var el = $(id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (er) {} }
    saveSoon();
  };
  // fill the plan from a suggested row: track, class, car (the newest ticked session), your lap time (with that row's saving), the pit stop, the VE a stint
  // starts with, your VE per lap, tyre wear and the stint length (VE per lap allowed follows from it)
  $('fromBody').onclick = function (e) {
    if (e.target.id === 'moreBtn') { showMore = !showMore; fromRace(); return; }
    var b = e.target.closest('[data-use]'), c = $('fromBody')._c; if (!b || !c || !c.rows.length) return;
    var s = c.rows.map(function (r) { return r.s; }).sort(function (a, b2) { return b2.time - a.time; })[0], fr = plan.from, laps = Number(b.getAttribute('data-use')), pace = Number(b.getAttribute('data-pace')), done = [];
    var tr = R.trackName(s.track, s.layout); if (tr) { plan.track = tr; done.push('track'); }
    var cl = R.className(s['class']); if (cl) plan.cls = cl;
    plan.car = s.car; done.push('car');
    if (pace > 0) {
      var mine = plan.drivers.filter(function (d) { return myNames.indexOf(d.name) >= 0; });
      (mine.length ? mine : plan.drivers.slice(0, 1)).forEach(function (d) { d.lap = Math.round(pace * 1000) / 1000; });
      plan.drivers.forEach(function (d) { if (!(d.lap > 0)) d.lap = Math.round(pace * 1000) / 1000; });
      done.push('your lap time ' + F.lap(pace));
    }
    if (c.pitLoss) { plan.pit.base = Math.round(c.pitLoss); done.push('pit stop ' + plan.pit.base + ' s'); }
    plan.ve.max = fr.veStart || 100;
    if (c.rate) plan.ve.perLap = Math.round(c.rate * 100) / 100;
    if (c.wear) { plan.tyres.wearPerLap = Math.round(c.wear * 100) / 100; done.push('tyre wear ' + F.pct(plan.tyres.wearPerLap, 2) + ' per lap'); }
    if (laps > 0) { plan.ve.mode = 'laps'; plan.ve.laps = laps; done.push(laps + ' laps a stint (' + F.pct(SM.veNeeded(plan.ve, laps), 2) + ' VE per lap allowed)'); }
    var had = (plan.stints || []).length > 0; plan.stints = [];
    fillForm(); drivers(); render(); fromRace(); saveSoon();
    $('fromInfo').textContent = 'Filled: ' + done.join(', ') + '.' + (had ? ' Your stint changes were cleared.' : '') + ' Tyre change time and driver swaps: set them below.';
  };

  // ---------- start ----------
  var refP = H.inApp ? H.json('api/reference') : fetch('data/alien-times.csv').then(function (r) { return r.text(); }).then(function (csv) { return { csv: csv }; });
  refP.then(function (r) { ref = R.parse(r.csv); if (plan) options(); }, function () {});
  if (H.inApp) H.json('api/pace?light=1').then(function (i) { myNames = i.names || []; H.setWho(myNames[0]); if (plan && plan.drivers.length === 1 && !plan.drivers[0].name && myNames[0]) { plan.drivers[0].name = myNames[0]; drivers(); render(); } }, function () {}).then(load);
  else load();
})(typeof window !== 'undefined' ? window : globalThis);
