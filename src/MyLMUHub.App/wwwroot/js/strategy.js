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
  function startMs() { return following() ? liveS.greenMs : plannedMs(); }          // live: clock times follow the real green flag
  function at(raceSec) { var g = startMs(); return F.clock(raceSec) + (isFinite(g) ? '<span class="two">' + F.wallClock(SM.clockAt(g, raceSec)) + '</span>' : ''); }
  function color(name) { for (var i = 0; i < plan.drivers.length; i++) if (plan.drivers[i].name === name) return DRIVER_COLORS[i % DRIVER_COLORS.length]; return 'var(--muted)'; }
  function tile(k, v, n, cls) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="n">' + (n || '') + '</div></div>'; }
  function render() {
    if (!plan) return;
    var fol = following(), pure = SM.build(plan), r = fol ? SM.build(plan, liveS) : pure, g = startMs(), cls = (CLASSES.filter(function (c) { return c[0] === plan.cls; })[0] || [0, plan.cls])[1];
    $('planSub').textContent = [plan.track || 'no track yet', cls, plan.car, plan.length.kind === 'laps' ? plan.length.laps + ' laps' : F.hm(plan.length.time) + ' h race',
      isFinite(g) ? 'green flag ' + F.wallClock(g) + (fol ? (liveS.greenEstimated ? ' (live, estimated)' : ' (live)') : '') : 'no start time: clock times hidden'].filter(Boolean).join(' · ');
    liveBar(r, pure);
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
        '<td class="num">' + (real ? (s.state === 'now' ? (liveS.current ? liveS.current.laps : 0) + ' / ' + s.laps : s.laps) : '<input class="input cell mono' + (s.changed.laps ? ' on' : '') + '" data-o="laps" value="' + (ov.laps || '') + '" placeholder="' + s.laps + '">') +
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

  // ---------- live: api/race-live every 3 s while this page is open (the app records the race either way) ----------
  var liveR = null, liveS = { status: 'off' }, liveErr = false, lastOk = 0, liveKey = '', lastR = null, lastPure = null;
  function trackMatches() {
    if (!plan.track || !liveS.track) return true;
    var n = R.trackName(liveS.track, '') || liveS.track;
    return n === plan.track || plan.track.indexOf(n) === 0 || n.indexOf(plan.track) === 0;
  }
  function following() { return !!plan && (liveS.status === 'live' || liveS.status === 'over') && trackMatches(); }
  function session(id) { var n = F.sessionName(id); return n ? n.charAt(0) + n.slice(1).toLowerCase() : 'Session'; }
  function liveBar(r, pure) {
    lastR = r; lastPure = pure;
    var st = liveS.status, label = 'PLAN', cls = '', main = '', sub = '', line = '';
    if (!H.inApp) { main = 'Plan only'; sub = 'Open this page in the app to follow a race live.'; }
    else if (liveErr) { label = 'NO LIVE DATA'; cls = 'bad'; main = 'The app does not answer.'; }
    else if (st === 'off') { main = 'Not live'; sub = 'Start Le Mans Ultimate: when the race starts, this plan follows it by itself.'; }
    else if (st === 'waiting') {
      label = 'WAITING'; cls = 'wait'; main = session(liveS.session) + (liveS.endsIn >= 0 ? ' ends in ' + F.clock(liveS.endsIn) : '') + (liveS.track ? ' · ' + liveS.track : '');
      sub = (liveS.endsIn >= 0 ? 'at ' + F.wallClock(Date.now() + liveS.endsIn * 1000) + '. ' : '') + 'Following starts at the green flag.';
    } else if (st === 'grid') {
      var p = plannedMs(); label = 'WAITING FOR THE GREEN FLAG'; cls = 'wait'; main = liveS.track || '';
      sub = isFinite(p) ? 'Planned start ' + F.wallClock(p) + (Date.now() > p + 30000 ? ' · already ' + F.clock((Date.now() - p) / 1000) + ' later' : '') : '';
    } else if (!trackMatches()) { label = 'OTHER TRACK'; cls = 'wait'; main = 'The live race is at ' + liveS.track + '.'; sub = 'This plan is for ' + plan.track + ': not following it.'; }
    else {
      label = st === 'over' ? 'FINISHED' : 'LIVE'; cls = 'live';
      main = 'Following ' + (liveS.driver || '?') + (liveS.entry ? ' · ' + liveS.entry : '') + ' · lap ' + ((liveR.car ? liveR.car.laps : 0) + 1) + ' · race time ' + F.clock(liveS.time) + (liveS.inPit ? ' · in the pit' : '');
      sub = 'adjusting the plan to the live data · updated ' + Math.round((Date.now() - lastOk) / 1000) + ' s ago';
      var pm = plannedMs(), parts = ['Green flag ' + F.wallClock(liveS.greenMs) + (liveS.greenEstimated ? ' (estimated: the app started during the race)' : '')];
      if (isFinite(pm) && !liveS.greenEstimated) { var d = (liveS.greenMs - pm) / 1000; if (Math.abs(d) >= 30) parts.push(F.clock(Math.abs(d)) + (d > 0 ? ' later' : ' earlier') + ' than planned: all clock times moved'); }
      if (r && pure) { var dl = r.laps - pure.laps; parts.push(dl === 0 ? 'On plan: ' + r.laps + ' laps expected' : (dl > 0 ? 'Ahead of plan by ' : 'Behind plan by ') + Math.abs(dl) + (Math.abs(dl) === 1 ? ' lap' : ' laps') + ' (' + r.laps + ' expected, plan ' + pure.laps + ')'); }
      line = parts.join(' · ');
    }
    $('lbChip').textContent = label; $('lbChip').className = 'lb-chip ' + cls; $('lbMain').textContent = main; $('lbSub').textContent = sub; $('lbLine').textContent = line;
  }
  function editing() { var a = document.activeElement; return !!(a && a.closest && (a.closest('#stintTbl') || a.closest('#drvTbl')) && /INPUT|SELECT/.test(a.tagName)); }
  function poll() {
    H.json('api/race-live').then(function (x) {
      liveR = x; liveErr = false; lastOk = Date.now(); liveS = SM.fromLive(x, plan ? plan.length : null);
      var key = JSON.stringify([liveS.status, liveS.track, x.log && x.log.stints, x.log && x.log.greenEt, x.car && [x.car.laps, x.car.inPits, x.car.driver]]);
      if (plan && key !== liveKey && !editing()) { liveKey = key; render(); } else if (plan) liveBar(lastR, lastPure);
    }, function () { liveErr = true; if (plan) liveBar(lastR, lastPure); });
  }
  if (H.inApp) { poll(); setInterval(poll, 3000); }

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

  // ---------- start from a race you drove (Race Pace sessions): pace, stints, the stop, VE use -> the plan ----------
  // plan.from = { file, veLeft (% you came in with, typed when the file has no VE), veStart } is kept with the plan
  var races = null, raceAsked = false;
  function raceSession() { var f = plan.from && plan.from.file; return (races || []).filter(function (s) { return s.file === f; })[0] || null; }
  function raceList() {
    if (!H.inApp || raceAsked) return; raceAsked = true;
    $('raceSel').innerHTML = '<option value="">Reading your races...</option>';
    H.loadPace(function () {}, function (data) {
      races = (data.sessions || []).filter(function (s) { return (s.type === 'Race' || s.type === 'Practice') && !s.live && s.laps.length >= 5; }).sort(function (a, b) { return b.time - a.time; });
      fromRace();
    });
  }
  function fromRace() {
    if (!plan) return;
    if (!H.inApp) { $('fromBody').innerHTML = '<div class="faint">Open this page in the app: it reads your races from the result files.</div>'; return; }
    if (!races) { raceList(); return; }
    if (!races.length) { $('raceSel').innerHTML = '<option value="">No races found</option>'; $('fromBody').innerHTML = ''; return; }
    if (!raceSession()) {                                                              // first time: your latest race on this plan's track, else your latest race
      var same = races.filter(function (s) { return R.trackName(s.track, s.layout) === plan.track; })[0];
      plan.from = { file: (same || races[0]).file, veLeft: null, veStart: plan.ve.max || 100 };
    }
    var s = raceSession(), fr = plan.from;
    $('raceSel').innerHTML = races.map(function (r) {
      return '<option value="' + esc(r.file) + '"' + (r === s ? ' selected' : '') + '>' + esc(F.day(r.time) + ' · ' + r.type + ' · ' + (R.trackName(r.track, r.layout) || r.track) + ' · ' + r.car + ' · ' + r.laps[r.laps.length - 1][0] + ' laps') + '</option>';
    }).join('');
    var x = SM.fromRace(s, { veStart: fr.veStart, veLeft: fr.veLeft, reserve: plan.ve.reserve }), prac = s.type === 'Practice', full = prac ? null : x.full, stop = prac ? null : normalStop(x);
    var mins = Math.round(s.laps.reduce(function (a, l) { return a + (l[1] > 0 ? l[1] : x.pace || 0); }, 0) / 60);
    var h = '<div class="faint" style="margin-bottom:10px">' + esc(s.type + ' · ' + (R.trackName(s.track, s.layout) || s.track) + ' · ' + s.car + ' · ' + x.laps + ' laps in about ' + mins + ' min' +
      (s.classPos && !prac ? ' · P' + s.classPos + ' of ' + s.classCars + ' in class' : '')) +
      (prac ? '<br>A practice session: its VE and tyre wear per lap are used, not its stops. Your lap times in the plan stay (empty ones get this pace).' : '') + '</div>';
    h += '<div class="tiles">' +
      tile(prac ? 'Pace' : 'Race pace', x.pace ? F.lap(x.pace) : '--', x.best ? 'best ' + F.lap(x.best) + ' · median of the clean laps' : '') +
      tile('Stints', x.stints.map(function (t) { return t.laps; }).join(' + ') + ' laps', x.stops.length ? x.stops.length + (x.stops.length === 1 ? ' stop' : ' stops') + ', after lap ' + x.stops.map(function (p) { return p.after; }).join(', ') : 'no stop') +
      tile('Pit stop', stop && stop.loss !== null ? Math.round(stop.loss) + ' s' : '--', prac ? 'not used from a practice session' : stop ? 'lost vs your pace (in lap + out lap)' : x.stops.length ? 'only an early stop: not a normal stop time' : 'no stop in this race') +
      tile('Tyre wear per lap', x.wearPerLap ? F.pct(x.wearPerLap, 2) : '--', x.wearPerLap ? 'average of ' + x.wearLaps + ' normal laps' + (x.wearOut ? ', ' + x.wearOut + ' left out' : '') +
        (x.stops.some(function (p) { return p.tyres === true; }) ? ' · tyres changed' : x.stops.length && x.stops.every(function (p) { return p.tyres === false; }) ? ' · tyres not changed' : '') : 'not recorded in that race') +
      tile('VE per lap', x.vePerLap ? F.pct(x.vePerLap, 2) : '--', x.veFrom === 'file' ? 'average of ' + x.veLaps + ' normal laps' + (x.veOut ? ' (' + x.veOut + ' left out: pit, out, incident laps)' : '') :
        x.veFrom === 'typed' ? 'from the VE you came in with' : 'not in the file: type the VE you came in with') + '</div>';
    // the stints, lap by lap groups
    h += '<div class="scroll" style="margin-top:12px"><table class="tbl"><thead><tr><th class="num">Stint</th><th class="num">Laps</th><th class="num">Lap</th><th class="num">Average clean lap</th><th>Ended</th></tr></thead><tbody>' +
      x.stints.map(function (t, k) {
        var p = x.stops.filter(function (q) { return q.after === t.to; })[0];
        return '<tr><td class="num">' + (k + 1) + '</td><td class="num">' + t.laps + '</td><td class="num">' + t.from + '-' + t.to + '</td><td class="num">' + (t.avg ? F.lap(t.avg) : '--') + '</td><td>' +
          (p && prac ? 'Pit / garage' : p ? (p.early ? 'Early stop (' + F.pct(p.veLeft, 0) + ' VE left: damage?)' : 'Pit stop') + (p.loss !== null ? ', ' + Math.round(p.loss) + ' s lost' : '') +
            (p.tyres === true ? ', new tyres' : p.tyres === false ? ', same tyres' : '') : 'Finish') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    // VE: your average per lap, how you drove that session (pushing / saving VE / mixed), the VE a stint starts with (VE left typed only when the file has no VE)
    var kd = fr.kind || 'push';
    h += '<div class="form" style="margin-top:14px;max-width:820px">' +
      (x.veFrom === 'file' || !full ? '' : '<label class="field">VE left when you came in after lap ' + full.to + ' (%)<input class="input" id="veLeftIn" data-num value="' + (fr.veLeft !== null && fr.veLeft !== undefined ? fr.veLeft : '') + '" placeholder="e.g. 4"></label>') +
      '<label class="field">How you drove that session<select class="sel" id="kindSel">' + [['push', 'Normal: no saving'], ['lift', 'Saving VE (lift and coast)'], ['mixed', 'Mixed: some laps saving']].map(function (o) {
        return '<option value="' + o[0] + '"' + (kd === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field">VE a stint starts with (%)<input class="input" id="veStartIn" data-num value="' + (fr.veStart || 100) + '"></label></div>';
    var rsv = plan.ve.reserve > 0 ? ' (with your reserve of ' + plan.ve.reserve + (plan.ve.reserve === 1 ? ' lap' : ' laps') + ')' : '';
    if (x.vePerLap) {
      h += '<div class="sub" style="margin:10px 0 0 0;color:var(--text)">At <b>' + F.pct(x.vePerLap, 2) + '</b> per lap ' + (kd === 'lift' ? '(saving) ' : '') + 'a stint of ' + F.pct(fr.veStart || 100, 0) + ' lasts <b>' + x.fit + ' laps</b>' + rsv + '.' +
        (full && x.spareLaps !== null ? ' Your stop after lap ' + full.to + ' had ' + F.pct(x.veLeft, 1) + ' left' + (x.spareLaps >= 1 ? ': ' + Math.floor(x.spareLaps) + ' more ' + (Math.floor(x.spareLaps) === 1 ? 'lap' : 'laps') + ' were there.' : '.') : '') +
        x.stops.filter(function (p) { return p.early && !prac; }).map(function (p) { return ' The stop after lap ' + p.after + ' came early (' + F.pct(p.veLeft, 0) + ' VE left): not used for the stint length or the pit time.'; }).join('') + '</div>';
    }
    // the app's suggestion: all your sessions on this track with this car (races and practice with VE per lap)
    var tk = R.trackName(s.track, s.layout) || s.track, sg = SM.suggest({ sessions: races.filter(function (r) { return (R.trackName(r.track, r.layout) || r.track) === tk && r.car === s.car; }),
      max: fr.veStart || 100, reserve: plan.ve.reserve, pitLoss: plan.pit.base, length: plan.length, rate: x.vePerLap, cost: fr.cost, kind: kd, ownPace: x.pace });
    if (sg.rate && sg.options.length) {
      h += '<h3 style="margin:18px 0 4px 0">Suggested strategy</h3><div class="sub" style="margin:0 0 8px 0">From ' + sg.sessions + (sg.sessions === 1 ? ' session' : ' sessions') + ' on ' + esc(tk) + ' with the ' + esc(s.car) + ' (' + sg.laps + ' normal laps): pace ' + F.lap(sg.pace) +
        (kd === 'lift' ? ' (the session above, saving VE)' : ' (races first)') + ', VE ' + F.pct(sg.rate, 2) + ' per lap (the session above' + (kd === 'lift' ? ', saving' : '') + '). ' + (sg.measured ? 'Saving VE costs you about <b>' + sg.cost.toFixed(2) + ' s per lap for every 1 % less per lap</b> (measured from your laps).' :
        'What saving VE costs in lap time is not measured yet: your VE use hardly varies from lap to lap. Type it below, or drive a few laps in practice saving VE (lift and coast) and the app measures it.' +
        '<div class="form" style="margin-top:8px;max-width:420px"><label class="field">Saving 1 % VE per lap costs (s per lap)<input class="input" id="costIn" data-num value="' + (fr.cost !== null && fr.cost !== undefined ? fr.cost : '') + '" placeholder="e.g. 0.8"></label></div>' +
        (sg.cost === null ? 'Without it no stint length is picked.' : '')) +
        ' Stops at ' + Math.round(plan.pit.base) + ' s each (the pit stop time in the plan).</div>';
      h += '<div class="scroll" style="max-width:900px"><table class="tbl"><thead><tr><th class="num">Stint</th><th class="num">VE per lap allowed</th><th class="num">' + (kd === 'lift' ? 'Save more than you did' : 'Save per lap') + '</th><th class="num">Lap time</th><th class="num">Stops</th><th class="num">' + (plan.length.kind === 'laps' ? 'Finish' : 'Laps in ' + esc(lenText())) + '</th><th></th></tr></thead><tbody>' +
        sg.options.map(function (o) {
          var best = sg.best === o;
          return '<tr' + (best ? ' class="now"' : '') + '><td class="num"><b>' + o.laps + ' laps</b>' + (best ? ' <span class="chip lime">BEST</span>' : '') + '</td><td class="num">' + F.pct(o.perLap, 2) + '</td><td class="num">' + (o.save > 0 ? F.pct(o.save, 2) : '<span class="faint">none</span>') +
            '</td><td class="num">' + F.lap(o.lap) + '</td><td class="num">' + o.stops + '</td><td class="num">' + (plan.length.kind === 'laps' ? F.hms(o.end) : o.raceLaps) + '</td><td><button class="btn' + (best ? ' lime' : '') + '" data-use="' + o.laps + '" data-pace="' + o.lap.toFixed(3) + '">Plan this</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (sg.rate) h += '<div class="sub" style="margin:14px 0 0 0">Set the race length (Event) to see the stint options.</div>';
    h += '<div class="go" style="margin-top:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +
      (x.fit ? '' : '<button class="btn lime" data-use="0">Use this race</button>') +
      '<span class="faint" id="fromInfo"></span></div>';
    $('fromBody').innerHTML = h;
  }
  function normalStop(x) { return x.stops.filter(function (p) { return !p.early; })[0] || null; }      // an early stop (damage) is not a pit stop time
  $('raceSel').onchange = function () { plan.from = { file: this.value, veLeft: null, veStart: plan.ve.max || 100, cost: plan.from ? plan.from.cost : null, kind: 'push' }; fromRace(); saveSoon(); };
  $('fromBody').oninput = function (e) {
    if (e.target.id === 'kindSel') { plan.from.kind = e.target.value; fromRace(); saveSoon(); return; }
    if (e.target.id !== 'veLeftIn' && e.target.id !== 'veStartIn' && e.target.id !== 'costIn') return;
    var v = e.target.value.trim() === '' ? null : Number(e.target.value.replace(',', '.'));
    if (e.target.id === 'veLeftIn') plan.from.veLeft = isFinite(v) ? v : null; else if (e.target.id === 'costIn') plan.from.cost = isFinite(v) && v !== null && v >= 0 ? v : null; else plan.from.veStart = v > 0 ? v : 100;
    var id = e.target.id, pos = e.target.selectionStart; fromRace(); var el = $(id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (er) {} }
    saveSoon();
  };
  // fill the plan: track, class, car, your lap time, the pit stop, the VE a stint starts with and the stint length (VE per lap allowed follows from it)
  $('fromBody').onclick = function (e) {
    var b = e.target.closest('[data-use]'); if (!b) return;
    var s = raceSession(); if (!s) return;
    var fr = plan.from, x = SM.fromRace(s, { veStart: fr.veStart, veLeft: fr.veLeft, reserve: plan.ve.reserve }), laps = Number(b.getAttribute('data-use')), done = [];
    var sp = Number(b.getAttribute('data-pace')); if (sp > 0) x.pace = sp;                    // a suggested row: its lap time (with the saving)
    var tr = R.trackName(s.track, s.layout); if (tr) { plan.track = tr; done.push('track'); }
    var c = R.className(s['class']); if (c) plan.cls = c;
    plan.car = s.car; done.push('car');
    var prac = s.type === 'Practice';
    if (x.pace && prac && !(sp > 0)) {                                                              // practice: VE and wear; lap times only where none is set
      var none = plan.drivers.filter(function (d) { return !(d.lap > 0); });
      none.forEach(function (d) { d.lap = Math.round(x.pace * 1000) / 1000; }); if (none.length) done.push('empty lap times ' + F.lap(x.pace));
    } else if (x.pace) {
      var mine = plan.drivers.filter(function (d) { return myNames.indexOf(d.name) >= 0; });
      (mine.length ? mine : plan.drivers.slice(0, 1)).forEach(function (d) { d.lap = Math.round(x.pace * 1000) / 1000; });
      plan.drivers.forEach(function (d) { if (!(d.lap > 0)) d.lap = Math.round(x.pace * 1000) / 1000; });
      done.push('your lap time ' + F.lap(x.pace));
    }
    var st = prac ? null : normalStop(x); if (st && st.loss !== null) { plan.pit.base = Math.round(st.loss); done.push('pit stop ' + plan.pit.base + ' s'); }
    plan.ve.max = fr.veStart || 100;
    if (x.vePerLap) plan.ve.perLap = Math.round(x.vePerLap * 100) / 100;
    if (x.wearPerLap) { plan.tyres.wearPerLap = Math.round(x.wearPerLap * 100) / 100; done.push('tyre wear ' + F.pct(plan.tyres.wearPerLap, 2) + ' per lap'); }
    if (laps > 0) { plan.ve.mode = 'laps'; plan.ve.laps = laps; done.push(laps + ' laps a stint (' + F.pct(SM.veNeeded(plan.ve, laps), 2) + ' VE per lap allowed)'); }
    var had = (plan.stints || []).length > 0; plan.stints = [];
    fillForm(); drivers(); render(); fromRace(); saveSoon();
    $('fromInfo').textContent = 'Filled: ' + done.join(', ') + '.' + (had ? ' Your stint changes were cleared.' : '') + (x.wearPerLap ? ' Tyre change time and driver swaps: set them below.' : ' Tyres and driver swaps: set them below.');
  };

  // ---------- start ----------
  var refP = H.inApp ? H.json('api/reference') : fetch('data/alien-times.csv').then(function (r) { return r.text(); }).then(function (csv) { return { csv: csv }; });
  refP.then(function (r) { ref = R.parse(r.csv); if (plan) options(); }, function () {});
  if (H.inApp) H.json('api/pace?light=1').then(function (i) { myNames = i.names || []; H.setWho(myNames[0]); if (plan && plan.drivers.length === 1 && !plan.drivers[0].name && myNames[0]) { plan.drivers[0].name = myNames[0]; drivers(); render(); } }, function () {}).then(load);
  else load();
})(typeof window !== 'undefined' ? window : globalThis);
