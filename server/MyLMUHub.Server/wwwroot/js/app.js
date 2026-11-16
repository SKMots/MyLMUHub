// My LMU Hub on the phone (2026-11-16): log in (pairing code from the desktop app, or Discord), then your teams: race results (tap one for its review, the
// same maths as the desktop app's Review: review-math.js), everyone's race pace per track (the same as the Team tab), the members; your account.
// Read-only: a phone login can only look. Everything the server sends is shown as text (esc), never as HTML.
(function () {
  'use strict';
  var P = window.MyLMUHub, F = P.format, R = P.paceRef, RM = P.reviewMath;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function get(path) { return fetch(path, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) { var e = new Error(r.status); e.status = r.status; throw e; } return r.json(); }); }
  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function tile(k, v, n, cls) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="n">' + (n || '') + '</div></div>'; }
  function day(t) { return new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  function trackName(t) { return (R && R.trackName(t, '')) || t || ''; }
  function lap(v) { return v > 0 ? F.lap(v) : '--'; }
  function roleWords(r) { return (r || []).map(function (x) { return x === 'owner' ? 'Owner' : x === 'engineer' ? 'Engineer' : 'Driver'; }).join(' + '); }

  var me = null, tab = 'teams', team = null, sub = 'results', results = [], pace = [], members = [], race = null, raceSum = null, rvOpen = {}, cls = '', car = '', track = null;
  var view = $('view');

  // ---------- start: logged in? ----------
  function start() {
    get('/api/v1/me').then(function (m) { me = m; $('who').textContent = me.name; $('tabbar').hidden = false; team = (me.teams || [])[0] || null; show(); },
      function (e) { if (e.status === 401) login(); else view.innerHTML = '<div class="card">The server cannot be reached right now.</div>'; });
  }

  // ---------- log in ----------
  function login() {
    $('tabbar').hidden = true; $('who').textContent = '';
    get('/api/v1/web/config').catch(function () { return {}; }).then(function (cfg) {
      view.innerHTML = '<div class="card"><h2>Log in</h2>' +
        (cfg.discord ? '<div class="sub">With the Discord account you linked in the desktop app (Team tab, Account).</div><a class="btn discord wide" href="/auth/discord/login">Log in with Discord</a>' +
          '<div class="sub" style="text-align:center;margin:14px 0">or</div>' : '') +
        '<div class="sub">With a pairing code: in the desktop app, Team tab, Account: <b>Log in on my phone</b>. The code works once, for 2 minutes.</div>' +
        '<input class="input" id="code" placeholder="ABCD-EFGH" autocomplete="one-time-code" autocapitalize="characters" maxlength="12">' +
        '<button class="btn acc wide" id="go" style="margin-top:10px">Log in</button><div class="err" id="err"></div></div>' +
        '<div class="sub" style="text-align:center">Not in a team yet? The desktop app is where you join one. <a href="/">About My LMU Hub</a></div>';
      $('go').onclick = function () {
        $('err').textContent = '';
        post('/api/v1/web/pair/redeem', { code: $('code').value }).then(start, function (e) { $('err').textContent = e.message === 'unknown or expired code' ? 'Unknown or expired code: make a new one in the desktop app.' : String(e.message); });
      };
      $('code').onkeydown = function (e) { if (e.key === 'Enter') $('go').click(); };
    });
  }

  // ---------- tabs ----------
  $('tabbar').onclick = function (e) { var b = e.target.closest('[data-tab]'); if (!b) return; tab = b.getAttribute('data-tab'); show(); window.scrollTo(0, 0); };
  function show() {
    [].forEach.call(document.querySelectorAll('#tabbar [data-tab]'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
    if (tab === 'account') return account();
    teams();
  }

  // ---------- teams ----------
  function teams() {
    var ts = me.teams || [];
    if (!ts.length) { view.innerHTML = '<div class="card">You are in no team yet. Join one in the desktop app (Team tab).</div>'; return; }
    view.innerHTML = '<div class="chips" id="chips"></div><div class="seg" id="subs" style="margin-top:10px"><button data-s="results">Races</button><button data-s="pace">Race pace</button><button data-s="members">Members</button></div><div id="body"></div>';
    $('chips').innerHTML = ts.map(function (t) { return '<button class="chip' + (team && t.id === team.id ? ' on' : '') + '" data-t="' + t.id + '">' + esc(t.name) + '</button>'; }).join('');
    $('chips').onclick = function (e) { var c = e.target.closest('[data-t]'); if (!c) return; team = ts.filter(function (t) { return t.id === +c.getAttribute('data-t'); })[0]; race = null; track = null; teams(); };
    $('subs').onclick = function (e) { var b = e.target.closest('[data-s]'); if (!b) return; sub = b.getAttribute('data-s'); race = null; track = null; teamBody(); };
    loadTeam();
  }
  function loadTeam() {
    var id = team.id; $('body').innerHTML = '<div class="faint" style="margin-top:14px">Loading...</div>';
    Promise.all([get('/api/v1/teams/' + id + '/results'), get('/api/v1/teams/' + id + '/pace').catch(function () { return []; }), get('/api/v1/teams/' + id + '/members')]).then(function (a) {
      if (!team || team.id !== id) return; results = a[0] || []; pace = a[1] || []; members = a[2] || []; teamBody();
    }, function (e) { if (e.status === 401) login(); else $('body').innerHTML = '<div class="card">Could not load the team.</div>'; });
  }
  function teamBody() {
    [].forEach.call(document.querySelectorAll('#subs [data-s]'), function (b) { b.classList.toggle('on', b.getAttribute('data-s') === sub); });
    if (sub === 'pace') return paceView();
    if (sub === 'members') return memberView();
    if (race) return raceView();
    resultsView();
  }

  // races
  function resultsView() {
    if (!results.length) { $('body').innerHTML = '<div class="card">No team races yet. They are added by themselves from the members\' result files.</div>'; return; }
    $('body').innerHTML = results.map(function (x) {
      var r = x.result, len = r.lengthKind === 'time' ? F.hm(r.length) : r.length + ' laps';
      return '<div class="rcard" data-r="' + x.id + '"><span class="pos">' + (r.classPos ? 'P' + r.classPos : '--') + '</span><div class="t">' + esc(trackName(r.track)) + '</div>' +
        '<div class="d">' + day(r.date) + ' · ' + esc(len) + ' · ' + esc(r.cls || '') + (r.classCars ? ' (' + r.classCars + ')' : '') + '</div>' +
        '<div class="d">' + esc([r.car, r.teamName || r.entry].filter(Boolean).join(' · ')) + '</div>' +
        (r.drivers || []).map(function (d) { return '<div class="drv">' + esc(d.name) + ' <span>' + d.laps + ' laps' + (d.avg ? ' · ' + F.lap(d.avg) : '') + '</span></div>'; }).join('') + '</div>';
    }).join('');
    $('body').onclick = function (e) { var c = e.target.closest('[data-r]'); if (c) openRace(+c.getAttribute('data-r')); };
  }
  function openRace(id) {
    $('body').innerHTML = '<div class="faint" style="margin-top:14px">Loading...</div>'; window.scrollTo(0, 0);
    get('/api/v1/teams/' + team.id + '/results/' + id).then(function (x) {
      var r = x.result || {}, names = (r.drivers || []).map(function (d) { return d.name; });
      var laps = (x.lapRows || []).map(function (l) {
        var v = function (k) { return l[k] >= 0 ? l[k] : null; };
        return [l[0], v(1), l[2] ? 1 : 0, v(6), l[3] >= 0 ? names[l[3]] || '' : '', v(4), v(5), l.length >= 12 ? [l[8], l[9], l[10], l[11]] : null, v(7)];
      });
      raceSum = r; race = { track: r.track, time: r.date, laps: laps, car: { team: r.teamName, vehicle: r.entry, carType: r.car, cls: r.cls, pos: r.pos, classPos: r.classPos, finishTime: r.finishTime || 0, best: r.best, finish: r.finish } };
      rvOpen = {}; raceView();
    }, function () { race = null; resultsView(); });
  }
  function raceView() {
    var r = raceSum, len = r.lengthKind === 'time' ? F.hm(r.length) : r.length + ' laps';
    var rv = race.laps.length ? RM.review(race, { length: r.lengthKind === 'time' && r.length > 0 ? { kind: 'time', time: r.length } : null }) : null;
    var h = '<div class="card"><span class="back" id="back">&larr; All races</span><div class="big">' + esc(trackName(r.track)) + (r.classPos ? ' · P' + r.classPos : '') + '</div>' +
      '<div class="sub">' + esc([day(r.date), len + ' race', r.cls + (r.classCars ? ' (' + r.classCars + ' cars)' : ''), r.car, r.teamName || r.entry, r.finish].filter(Boolean).join(' · ')) + '</div>';
    if (!rv) {
      h += '<div class="tiles">' + tile('Result', r.classPos ? 'P' + r.classPos : '--', '') + tile('Laps', r.laps, '') + tile('Best lap', lap(r.best), '', 'purple') + '</div>' +
        '<div class="warn">This race was sent without its laps (an older app version): no full review.</div></div>';
      $('body').innerHTML = h; $('back').onclick = function () { race = null; resultsView(); }; return;
    }
    var c = rv.car || {}, stops = rv.stints.filter(function (s) { return s.pitted; }).length;
    h += '<div class="tiles">' + tile('Result', c.classPos ? 'P' + c.classPos : '--', c.pos ? 'P' + c.pos + ' overall' : '') + tile('Laps', rv.laps, '') +
      tile('Stops', stops, rv.pitLoss ? Math.round(rv.pitLoss) + ' s each' : '') + tile('Best lap', lap(c.best), '', 'purple') +
      rv.drivers.map(function (d) { return tile(d.name || '?', lap(d.avg), d.stints + ' stints · best ' + lap(d.best)); }).join('') + '</div></div>';
    h += '<div class="card"><h2>What we see</h2>' + (rv.findings.map(function (f) { return '<div class="finding ' + f.kind + '"><b>' + esc(f.title) + '</b><span class="muted">' + esc(f.text) + '</span></div>'; }).join('') || '<div class="faint">Nothing to point out.</div>') + '</div>';
    h += '<div class="card"><h2>Stints</h2><div class="sub">Tap a stint for its laps.</div><div class="scroll"><table class="tbl" id="st"><thead><tr><th class="num">#</th><th>Driver</th><th class="num">Laps</th><th class="num">Average</th><th class="num">Fastest</th><th class="num">VE/lap</th><th>Stop after</th></tr></thead><tbody>' +
      rv.stints.map(function (s, i) {
        var nx = rv.stints[i + 1];
        var stop = s.pitted ? (s.stopLoss > 0 ? Math.round(s.stopLoss) + ' s' : 'stop') + (nx ? (nx.tyres ? ' · ' + RM.tyreWord(nx.tyres) : '') + (nx.driver && nx.driver !== s.driver ? ' · ' + esc(nx.driver) : '') : '') : '<span class="faint">finish</span>';
        return '<tr class="click" data-i="' + i + '"><td class="num">' + s.n + '</td><td>' + esc(s.driver || '?') + '</td><td class="num">' + s.laps + '</td><td class="num">' + lap(s.avg) + '</td><td class="num purple">' + lap(s.best) + '</td>' +
          '<td class="num">' + (s.ve ? F.pct(s.ve, 2) : '--') + '</td><td>' + stop + '</td></tr>' + (rvOpen[i] ? lapsRow(s) : '');
      }).join('') + '</tbody></table></div></div>';
    var w = rv.whatIf;
    if (w && w.options.length) h += '<div class="card"><h2>What if</h2><div class="sub">The race again with its own numbers: ' + F.lap(w.pace) + ' a lap, ' + Math.round(rv.pitLoss) + ' s a stop.</div><div class="scroll"><table class="tbl"><thead><tr><th class="num">Laps a stint</th><th class="num">VE/lap</th><th class="num">Stops</th><th class="num">Laps</th><th></th></tr></thead><tbody>' +
      w.options.map(function (o) { return '<tr' + (o === w.best ? ' class="me"' : '') + '><td class="num">' + o.laps + '</td><td class="num">' + F.pct(o.perLap, 2) + '</td><td class="num">' + o.stops + '</td><td class="num">' + o.raceLaps + '</td><td>' + (o.laps === w.did ? '<span class="chiplabel">DID</span> ' : '') + (o === w.best ? '<span class="chiplabel">BEST</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    $('body').innerHTML = h;
    $('back').onclick = function () { race = null; resultsView(); };
    $('st').onclick = function (e) { var tr = e.target.closest('tr[data-i]'); if (!tr) return; var i = +tr.getAttribute('data-i'); rvOpen[i] = !rvOpen[i]; raceView(); };
  }
  function lapsRow(s) {
    return '<tr class="laps"><td colspan="7"><table class="tbl"><tbody>' + s.lapList.map(function (l) {
      var d = l.t && s.avg ? l.t - s.avg : null, note = l.pit ? 'in' : (s.n > 1 && l === s.lapList[0]) ? 'out' : '';
      return '<tr><td class="num">' + l.n + '</td><td class="num"' + (l.t && l.t === s.best ? ' style="color:var(--purple)"' : '') + '>' + (l.t ? F.lap(l.t) : '--') + '</td>' +
        '<td class="num"' + (d !== null && !note ? ' style="color:var(' + (d <= 0 ? '--green' : '--red') + ')"' : '') + '>' + (d !== null && !note ? (d > 0 ? '+' : '−') + Math.abs(d).toFixed(3) : '') + '</td><td class="faint">' + note + '</td></tr>';
    }).join('') + '</tbody></table></td></tr>';
  }

  // race pace: class + car, the tracks, a track's drivers (each averaged over their cars)
  var CLASSES = [['LMH', 'Hypercar'], ['LMP2wec', 'LMP2'], ['LMP2elms', 'LMP2 ELMS'], ['LMP3', 'LMP3'], ['LMGT3', 'GT3'], ['GTE', 'GTE']];
  function clsOf(p) { return (R && R.className(p.cls)) || p.cls || '?'; }
  function clsLabel(c) { var x = CLASSES.filter(function (k) { return k[0] === c; })[0]; return x ? x[1] : c; }
  function perDriver(rows) {
    var by = {}; rows.forEach(function (p) { (by[p.user] = by[p.user] || []).push(p); });
    return Object.keys(by).map(function (u) {
      var rs = by[u], wp = rs.filter(function (p) { return p.pace > 0 && p.clean > 0; }), n = wp.reduce(function (t, p) { return t + p.clean; }, 0);
      var bl = rs.filter(function (p) { return p.best > 0; }).sort(function (a, b) { return a.best - b.best; })[0], bp = wp.slice().sort(function (a, b) { return a.pace - b.pace; })[0];
      var cs = wp.filter(function (p) { return p.sd > 0 && p.clean >= 5; }).sort(function (a, b) { return a.sd - b.sd; })[0];
      return { user: +u, name: rs[0].name, me: rs[0].me, cars: rs.length, pace: n ? wp.reduce(function (t, p) { return t + p.pace * p.clean; }, 0) / n : 0, best: bl ? bl.best : 0, bestCar: bl ? bl.car : '',
        paceCar: bp ? bp.car : '', consCar: cs ? cs.car : '', clean: rs.reduce(function (t, p) { return t + (p.clean || 0); }, 0), last: Math.max.apply(null, rs.map(function (p) { return p.last; })) };
    });
  }
  function segOf(items, on, attr) { return '<div class="seg" style="margin-top:8px">' + items.map(function (it) { return '<button ' + attr + '="' + esc(it[0]) + '"' + (it[0] === on ? ' class="on"' : '') + '>' + esc(it[1]) + '</button>'; }).join('') + '</div>'; }
  function paceView() {
    if (!pace.length) { $('body').innerHTML = '<div class="card">No race pace shared yet: each member shares theirs from the desktop app.</div>'; return; }
    var count = {}; pace.forEach(function (p) { var c = clsOf(p); count[c] = (count[c] || 0) + 1; });
    var classes = Object.keys(count); if (!cls || !count[cls]) cls = classes.sort(function (a, b) { return count[b] - count[a]; })[0];
    var inCls = pace.filter(function (p) { return clsOf(p) === cls; }), cars = {}; inCls.forEach(function (p) { cars[p.car] = 1; }); if (car && !cars[car]) car = '';
    var rows = inCls.filter(function (p) { return !car || p.car === car; }), by = {};
    rows.forEach(function (p) { var k = trackName(p.track); if (!by[k]) by[k] = { name: k, rows: [], last: 0 }; by[k].rows.push(p); by[k].last = Math.max(by[k].last, p.last); });
    var h = '<div class="card">' + segOf(classes.map(function (c) { return [c, clsLabel(c)]; }), cls, 'data-c') + segOf([['', 'All cars']].concat(Object.keys(cars).sort().map(function (c) { return [c, c]; })), car, 'data-car') + '</div>';
    if (track && by[track]) {
      var ds = perDriver(by[track].rows).sort(function (a, b) { return (a.pace || 1e9) - (b.pace || 1e9); }), wp = ds.filter(function (d) { return d.pace > 0; }), top = wp[0];
      var avg = wp.length ? wp.reduce(function (t, d) { return t + d.pace; }, 0) / wp.length : 0, tl = ds.filter(function (d) { return d.best > 0; }).sort(function (a, b) { return a.best - b.best; })[0], mine = wp.filter(function (d) { return d.me; })[0];
      h += '<div class="card"><span class="back" id="back">&larr; All tracks</span><div class="big">' + esc(track) + '</div><div class="tiles">' +
        tile('Best pace', lap(top && top.pace), top ? esc(top.name) : '') + tile('Average team pace', lap(avg), wp.length + ' drivers') + tile('Best quali', lap(tl && tl.best), tl ? esc(tl.name) : '', 'purple') +
        tile('Your pace', lap(mine && mine.pace), mine && top ? (mine === top ? 'the best' : '+' + (mine.pace - top.pace).toFixed(3)) : '') + '</div>' +
        '<div class="scroll" style="margin-top:10px"><table class="tbl"><thead><tr><th>Driver</th><th class="num">Pace</th><th class="num">Gap</th><th class="num">Best</th><th>Cars</th></tr></thead><tbody>' +
        ds.map(function (d) { return '<tr' + (d.me ? ' class="me"' : '') + '><td>' + esc(d.name) + '</td><td class="num">' + lap(d.pace) + '</td><td class="num">' + (top && d.pace > 0 ? (d === top ? 'best' : '+' + (d.pace - top.pace).toFixed(3)) : '--') + '</td><td class="num purple">' + lap(d.best) + '</td>' +
          '<td>' + esc(d.paceCar || d.bestCar) + (d.cars > 1 ? '<span class="two">' + d.cars + ' cars · fastest lap ' + esc(d.bestCar) + (d.consCar ? ' · steadiest ' + esc(d.consCar) : '') + '</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    } else {
      track = null;
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.last - a.last; });
      h += '<div class="card"><h2>Tracks</h2><div class="scroll"><table class="tbl" id="trk"><thead><tr><th>Track</th><th class="num">Best pace</th><th class="num">Team avg</th><th class="num">Yours</th></tr></thead><tbody>' + list.map(function (g) {
        var ds = perDriver(g.rows), wp = ds.filter(function (d) { return d.pace > 0; }).sort(function (a, b) { return a.pace - b.pace; }), top = wp[0], mine = wp.filter(function (d) { return d.me; })[0];
        var avg = wp.length ? wp.reduce(function (t, d) { return t + d.pace; }, 0) / wp.length : 0;
        return '<tr class="click" data-k="' + esc(g.name) + '"><td><b>' + esc(g.name) + '</b><span class="two">' + ds.length + ' drivers</span></td><td class="num">' + lap(top && top.pace) + '<span class="two">' + (top ? esc(top.name) : '') + '</span></td>' +
          '<td class="num">' + lap(avg) + '</td><td class="num">' + lap(mine && mine.pace) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    }
    $('body').innerHTML = h;
    $('body').onclick = function (e) {
      var c = e.target.closest('[data-c]'); if (c) { cls = c.getAttribute('data-c'); car = ''; track = null; return paceView(); }
      var k = e.target.closest('[data-car]'); if (k) { car = k.getAttribute('data-car'); return paceView(); }
      var t = e.target.closest('[data-k]'); if (t) { track = t.getAttribute('data-k'); window.scrollTo(0, 0); return paceView(); }
      if (e.target.id === 'back') { track = null; paceView(); }
    };
  }

  // members
  function memberView() {
    $('body').innerHTML = '<div class="card"><h2>' + esc(team.name) + '</h2><div class="scroll"><table class="tbl"><tbody>' + members.map(function (m) {
      return '<tr' + (m.me ? ' class="me"' : '') + '><td>' + esc(m.name) + '</td><td class="faint">' + esc(roleWords(m.roles)) + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
  }

  // ---------- account ----------
  function account() {
    view.innerHTML = '<div class="card"><h2>Account</h2><div class="tiles">' + tile('Name', esc(me.name), 'in your teams') + tile('Discord', me.discord ? esc(me.discord) : '--', me.discord ? 'linked' : 'link it in the desktop app') +
      tile('Teams', (me.teams || []).length, esc((me.teams || []).map(function (t) { return t.name; }).join(', '))) + '</div>' +
      '<div class="sub" style="margin-top:14px">This phone can only look; changes are made in the desktop app. Coming next: live races and your own stats.</div>' +
      '<button class="btn wide" id="out" style="margin-top:6px">Log out on this phone</button></div>';
    $('out').onclick = function () { post('/api/v1/web/logout').then(login, login); };
  }

  start();
})();
