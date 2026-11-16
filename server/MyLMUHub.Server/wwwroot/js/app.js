// My LMU Hub on the web (phone and desktop browser, 2026-11-16): log in (pairing code from the desktop app, or Discord), then your teams:
// Home (the latest race, your pace against the team), Races (tap one for its review: the same maths as the desktop app's Review, review-math.js),
// Race pace (the same as the Team tab), Team (members, your teams), Me (your account). Pages are links (#/races/12): the back button works.
// Read-only: a web login can only look. Everything the server sends is shown as text (esc), never as HTML. No style="" anywhere: the site's
// Content-Security-Policy (style-src 'self') ignores inline styles, so all looks come from site.css classes.
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
  function ago(t) { var d = Math.floor((Date.now() / 1000 - t) / 86400); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? d + ' days ago' : day(t); }
  function trackName(t) { return (R && R.trackName(t, '')) || t || ''; }
  function lap(v) { return v > 0 ? F.lap(v) : '--'; }
  function gap(d) { return (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(3); }
  function roleWords(r) { return (r || []).map(function (x) { return x === 'owner' ? 'Owner' : x === 'engineer' ? 'Engineer' : 'Driver'; }).join(' + '); }
  function initial(n) { return esc((String(n || '?').trim()[0] || '?').toUpperCase()); }
  function card(title, body, extra) { return '<section class="card' + (extra ? ' ' + extra : '') + '">' + (title ? '<h2>' + title + '</h2>' : '') + body + '</section>'; }
  var view = $('view');

  // ---------- icons (the tab bar) ----------
  var ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    races: '<path d="M5 21V4"/><path d="M5 4h13l-2 4 2 4H5"/>',
    pace: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4"/><path d="M10 2h4"/>',
    team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.9.2 5 2.6 5 5.8"/>',
    me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'
  };
  function icon(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>'; }
  var TABS = [['home', 'Home', '#/'], ['races', 'Races', '#/races'], ['pace', 'Race pace', '#/pace'], ['team', 'Team', '#/team'], ['me', 'Me', '#/me']];
  $('tabbar').innerHTML = TABS.map(function (t) { return '<a data-tab="' + t[0] + '" href="' + t[2] + '">' + icon(t[0]) + '<span>' + t[1] + '</span></a>'; }).join('');
  $('topnav').innerHTML = TABS.slice(0, 4).map(function (t) { return '<a data-tab="' + t[0] + '" href="' + t[2] + '">' + t[1] + '</a>'; }).join('');

  // ---------- state ----------
  var me = null, team = null, cache = {}, cls = '', car = '', rvOpen = {}, lastRace = null;
  function teamData(t) {                                                                  // a team's races, race pace and members: loaded once a visit
    if (!cache[t.id]) cache[t.id] = Promise.all([get('/api/v1/teams/' + t.id + '/results'), get('/api/v1/teams/' + t.id + '/pace').catch(function () { return []; }), get('/api/v1/teams/' + t.id + '/members')])
      .then(function (a) { return { results: a[0] || [], pace: a[1] || [], members: a[2] || [] }; }, function (e) { delete cache[t.id]; throw e; });
    return cache[t.id];
  }

  // ---------- start: logged in? ----------
  function start() {
    get('/api/v1/me').then(function (m) {
      me = m; var ts = me.teams || [], keep = +localStorage.getItem('mlh-team');
      team = ts.filter(function (t) { return t.id === keep; })[0] || ts[0] || null;
      $('who').innerHTML = '<i>' + initial(me.name) + '</i><span>' + esc(me.name) + '</span>'; $('who').hidden = false;
      $('tabbar').hidden = false; $('topnav').hidden = false; liveLoad(); livePoll();
      $('tpick').hidden = ts.length < 2;
      $('tsel').innerHTML = ts.map(function (t) { return '<option value="' + t.id + '"' + (team && t.id === team.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
      route();
    }, function (e) { if (e.status === 401) login(); else view.innerHTML = card('', 'The server cannot be reached right now.'); });
  }
  $('tsel').onchange = function () {
    var id = +this.value; team = (me.teams || []).filter(function (t) { return t.id === id; })[0] || team; localStorage.setItem('mlh-team', String(team.id)); cls = ''; car = '';
    var h = location.hash; if (/^#\/(races|pace)\/./.test(h)) location.hash = h.replace(/^(#\/(races|pace)).*$/, '$1'); else route();
  };

  // ---------- log in ----------
  function login() {
    me = null; clearInterval(liveTimer); $('livebar').hidden = true; $('tabbar').hidden = true; $('topnav').hidden = true; $('who').hidden = true; $('tpick').hidden = true;
    get('/api/v1/web/config').catch(function () { return {}; }).then(function (cfg) {
      view.innerHTML = '<div class="login">' + card('Log in',
        (cfg.discord ? '<div class="sub">With the Discord account you linked in the desktop app (Settings, Your phone).</div><a class="btn discord wide" href="/auth/discord/login">Log in with Discord</a>' +
          '<div class="or">or</div>' : '') +
        '<div class="sub">With a pairing code: in the desktop app, Settings, Your phone: <b>Log in on my phone</b>. The code works once, for 2 minutes.</div>' +
        '<input class="input" id="code" placeholder="ABCD-EFGH" autocomplete="one-time-code" autocapitalize="characters" maxlength="12">' +
        '<button class="btn acc wide mt10" id="go">Log in</button><div class="err" id="err"></div>') +
        '<div class="sub center">Not in a team yet? The desktop app is where you join one. <a href="/">About My LMU Hub</a></div></div>';
      $('go').onclick = function () {
        $('err').textContent = '';
        post('/api/v1/web/pair/redeem', { code: $('code').value }).then(start, function (e) { $('err').textContent = e.message === 'unknown or expired code' ? 'Unknown or expired code: make a new one in the desktop app.' : String(e.message); });
      };
      $('code').onkeydown = function (e) { if (e.key === 'Enter') $('go').click(); };
    });
  }

  // ---------- pages (#/..., the back button works) ----------
  window.addEventListener('hashchange', function () { if (me) route(); });
  function route() {
    var parts = (location.hash.replace(/^#\/?/, '') || '').split('/'), page = parts[0] || 'home', arg = parts.slice(1).join('/');
    var wasLive = livePage !== null; livePage = page === 'live' && arg ? +arg : null; if (wasLive !== (livePage !== null)) { lvOpenStint = {}; livePoll(); } liveBanner();
    if (livePage !== null) { [].forEach.call(document.querySelectorAll('[data-tab]'), function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === 'home'); }); window.scrollTo(0, 0); view.onclick = null; return liveView(); }
    if (!TABS.some(function (t) { return t[0] === page; })) page = 'home';
    [].forEach.call(document.querySelectorAll('[data-tab]'), function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === page); });
    window.scrollTo(0, 0); view.onclick = null;
    if (page === 'me') { mine = null; return account(); }
    if (!team) { view.innerHTML = card('No team yet', '<div class="sub">You are in no team yet. Join one in the desktop app: Settings, Team server, with the invite code your team owner gives you.</div>'); return; }
    var t = team; view.innerHTML = '<div class="faint mt20">Loading...</div>';
    teamData(t).then(function (d) {
      if (team !== t) return;
      if (page === 'races') return arg ? openRace(+arg) : racesView(d);
      if (page === 'pace') return paceView(d, arg ? decodeURIComponent(arg) : null);
      if (page === 'team') return teamView(d);
      homeView(d);
    }, function (e) { if (e.status === 401) login(); else view.innerHTML = card('', 'Could not load the team.'); });
  }

  // ---------- home ----------
  function perTrack(d) {                                                                  // every track: the team's best pace + yours (all classes)
    var by = {}; d.pace.forEach(function (p) { var k = trackName(p.track) + '|' + clsOf(p); (by[k] = by[k] || { track: trackName(p.track), cls: clsOf(p), rows: [], last: 0 }).rows.push(p); by[k].last = Math.max(by[k].last, p.last || 0); });
    return Object.keys(by).map(function (k) {
      var g = by[k], ds = perDriver(g.rows).filter(function (x) { return x.pace > 0; }).sort(function (a, b) { return a.pace - b.pace; });
      return { track: g.track, cls: g.cls, last: g.last, top: ds[0], mine: ds.filter(function (x) { return x.me; })[0], n: ds.length };
    });
  }
  function homeView(d) {
    var rs = d.results, best = rs.filter(function (x) { return x.result.classPos > 0; }).sort(function (a, b) { return a.result.classPos - b.result.classPos; })[0];
    var tr = perTrack(d), mineT = tr.filter(function (x) { return x.mine; }), fastest = mineT.filter(function (x) { return x.mine === x.top; });
    var h = '<div class="hello"><span class="faint">' + esc(greet()) + ', ' + esc(me.name) + '</span><h1>' + esc(team.name) + '</h1></div>';
    h += '<div class="tiles tiles4">' + tile('Team races', rs.length, rs.length ? 'last ' + ago(rs[0].result.date) : '') +
      tile('Best result', best ? 'P' + best.result.classPos : '--', best ? esc(trackName(best.result.track)) : '', 'acc') +
      tile('Members', d.members.length, esc(roleWords(team.roles)) ? 'you: ' + esc(roleWords(team.roles)) : '') +
      tile('Tracks with pace', tr.length, mineT.length ? 'you are fastest on ' + fastest.length : '') + '</div>';
    var cols = '';
    cols += card('Latest race', rs.length ? raceCard(rs[0]) + '<a class="more" href="#/races">All ' + rs.length + ' races &rarr;</a>' : '<div class="sub">No team races yet. They are added by themselves from the members\' result files.</div>');
    var list = mineT.sort(function (a, b) { return b.last - a.last; }).slice(0, 6);
    cols += card('Your pace against the team', list.length ? '<div class="sub">The last tracks you drove: your race pace and the team\'s best.</div><div class="plist">' + list.map(function (x) {
      var d2 = x.mine.pace - x.top.pace, w = x.mine === x.top;
      return '<a class="prow" href="#/pace/' + encodeURIComponent(x.track) + '"><span><b>' + esc(x.track) + '</b><small>' + esc(clsLabel(x.cls)) + ' · ' + x.n + ' drivers</small></span>' +
        '<span class="num">' + lap(x.mine.pace) + '<small class="' + (w ? 'green' : 'muted') + '">' + (w ? 'team best' : gap(d2) + ' to ' + esc(x.top.name)) + '</small></span></a>';
    }).join('') + '</div><a class="more" href="#/pace">All tracks &rarr;</a>' : '<div class="sub">No race pace of yours in this team yet: share it in the desktop app (Team tab, Settings).</div>');
    view.innerHTML = h + '<div class="cols">' + cols + '</div>';
  }
  function greet() { var hr = new Date().getHours(); return hr < 6 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; }

  // ---------- races ----------
  function raceCard(x) {
    var r = x.result, len = r.lengthKind === 'time' ? F.hm(r.length) : r.length + ' laps';
    return '<a class="rcard" href="#/races/' + x.id + '"><span class="pos">' + (r.classPos ? 'P' + r.classPos : '--') + '<small>' + (r.classCars ? 'of ' + r.classCars : '') + '</small></span>' +
      '<div class="t">' + esc(trackName(r.track)) + '</div>' +
      '<div class="d">' + day(r.date) + ' · ' + esc(len) + ' · ' + esc(r.cls || '') + '</div>' +
      '<div class="d">' + esc([r.car, r.teamName || r.entry].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="drvs">' + (r.drivers || []).map(function (d) { return '<span><b>' + esc(d.name) + '</b> ' + d.laps + ' laps' + (d.avg ? ' · ' + F.lap(d.avg) : '') + '</span>'; }).join('') + '</div></a>';
  }
  function racesView(d) {
    if (!d.results.length) { view.innerHTML = card('Races', '<div class="sub">No team races yet. They are added by themselves from the members\' result files.</div>'); return; }
    view.innerHTML = '<div class="pagehead"><h1>Races</h1><span class="faint">' + d.results.length + ' team races</span></div><div class="rgrid">' + d.results.map(raceCard).join('') + '</div>';
  }
  function openRace(id) {
    if (lastRace && lastRace.id === id && lastRace.team === team.id) return raceView(lastRace);
    view.innerHTML = '<div class="faint mt20">Loading...</div>'; rvOpen = {};
    var t = team;
    get('/api/v1/teams/' + t.id + '/results/' + id).then(function (x) {
      if (team !== t) return;
      var r = x.result || {}, names = (r.drivers || []).map(function (d) { return d.name; });
      var laps = (x.lapRows || []).map(function (l) {
        var v = function (k) { return l[k] >= 0 ? l[k] : null; };
        return [l[0], v(1), l[2] ? 1 : 0, v(6), l[3] >= 0 ? names[l[3]] || '' : '', v(4), v(5), l.length >= 12 ? [l[8], l[9], l[10], l[11]] : null, v(7)];
      });
      lastRace = { id: id, team: t.id, sum: r, race: { track: r.track, time: r.date, laps: laps, car: { team: r.teamName, vehicle: r.entry, carType: r.car, cls: r.cls, pos: r.pos, classPos: r.classPos, finishTime: r.finishTime || 0, best: r.best, finish: r.finish } } };
      raceView(lastRace);
    }, function () { location.hash = '#/races'; });
  }
  function raceView(L) {
    var r = L.sum, race = L.race, len = r.lengthKind === 'time' ? F.hm(r.length) : r.length + ' laps';
    var rv = race.laps.length ? RM.review(race, { length: r.lengthKind === 'time' && r.length > 0 ? { kind: 'time', time: r.length } : null }) : null;
    var h = '<a class="back" href="#/races">&larr; All races</a><div class="pagehead"><h1>' + esc(trackName(r.track)) + (r.classPos ? ' <span class="acc">P' + r.classPos + '</span>' : '') + '</h1></div>' +
      '<div class="sub">' + esc([day(r.date), len + ' race', r.cls + (r.classCars ? ' (' + r.classCars + ' cars)' : ''), r.car, r.teamName || r.entry, r.finish].filter(Boolean).join(' · ')) + '</div>';
    if (!rv) {
      view.innerHTML = h + '<div class="tiles">' + tile('Result', r.classPos ? 'P' + r.classPos : '--', '') + tile('Laps', r.laps, '') + tile('Best lap', lap(r.best), '', 'purple') + '</div>' +
        '<div class="warn">This race was sent without its laps (an older app version): no full review.</div>';
      return;
    }
    var c = rv.car || {}, stops = rv.stints.filter(function (s) { return s.pitted; }).length;
    h += '<div class="tiles">' + tile('Result', c.classPos ? 'P' + c.classPos : '--', c.pos ? 'P' + c.pos + ' overall' : '', 'acc') + tile('Laps', rv.laps, '') +
      tile('Stops', stops, rv.pitLoss ? Math.round(rv.pitLoss) + ' s each' : '') + tile('Best lap', lap(c.best), '', 'purple') +
      rv.drivers.map(function (d) { return tile(d.name || '?', lap(d.avg), d.stints + ' stints · best ' + lap(d.best)); }).join('') + '</div>';
    var left = card('Stints', '<div class="sub">Tap a stint for its laps.</div><div class="scroll"><table class="tbl" id="st"><thead><tr><th class="num">#</th><th>Driver</th><th class="num">Laps</th><th class="num">Average</th><th class="num">Fastest</th><th class="num">VE/lap</th><th>Stop after</th></tr></thead><tbody>' +
      rv.stints.map(function (s, i) {
        var nx = rv.stints[i + 1];
        var stop = s.pitted ? (s.stopLoss > 0 ? Math.round(s.stopLoss) + ' s' : 'stop') + (nx ? (nx.tyres ? ' · ' + RM.tyreWord(nx.tyres) : '') + (nx.driver && nx.driver !== s.driver ? ' · ' + esc(nx.driver) : '') : '') : '<span class="faint">finish</span>';
        return '<tr class="click' + (rvOpen[i] ? ' open' : '') + '" data-i="' + i + '"><td class="num">' + s.n + '</td><td>' + esc(s.driver || '?') + '</td><td class="num">' + s.laps + '</td><td class="num">' + lap(s.avg) + '</td><td class="num purple">' + lap(s.best) + '</td>' +
          '<td class="num">' + (s.ve ? F.pct(s.ve, 2) : '--') + '</td><td>' + stop + '</td></tr>' + (rvOpen[i] ? lapsRow(s) : '');
      }).join('') + '</tbody></table></div>', 'wide');
    var right = card('What we see', rv.findings.map(function (f) { return '<div class="finding ' + f.kind + '"><b>' + esc(f.title) + '</b><span class="muted">' + esc(f.text) + '</span></div>'; }).join('') || '<div class="faint">Nothing to point out.</div>');
    var w = rv.whatIf;
    if (w && w.options.length) right += card('What if', '<div class="sub">The race again with its own numbers: ' + F.lap(w.pace) + ' a lap, ' + Math.round(rv.pitLoss) + ' s a stop.</div><div class="scroll"><table class="tbl"><thead><tr><th class="num">Laps a stint</th><th class="num">VE/lap</th><th class="num">Stops</th><th class="num">Laps</th><th></th></tr></thead><tbody>' +
      w.options.map(function (o) { return '<tr' + (o === w.best ? ' class="me"' : '') + '><td class="num">' + o.laps + '</td><td class="num">' + F.pct(o.perLap, 2) + '</td><td class="num">' + o.stops + '</td><td class="num">' + o.raceLaps + '</td><td>' + (o.laps === w.did ? '<span class="chiplabel">DID</span> ' : '') + (o === w.best ? '<span class="chiplabel">BEST</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>');
    var y = window.scrollY;
    view.innerHTML = h + '<div class="split"><div>' + left + '</div><div>' + right + '</div></div>';
    window.scrollTo(0, y);
    $('st').onclick = function (e) { var tr = e.target.closest('tr[data-i]'); if (!tr) return; var i = +tr.getAttribute('data-i'); rvOpen[i] = !rvOpen[i]; raceView(L); };
  }
  function lapsRow(s) {
    return '<tr class="laps"><td colspan="7"><table class="tbl"><tbody>' + s.lapList.map(function (l) {
      var d = l.t && s.avg ? l.t - s.avg : null, note = l.pit ? 'in' : (s.n > 1 && l === s.lapList[0]) ? 'out' : '';
      return '<tr><td class="num">' + l.n + '</td><td class="num' + (l.t && l.t === s.best ? ' purple' : '') + '">' + (l.t ? F.lap(l.t) : '--') + '</td>' +
        '<td class="num ' + (d !== null && !note ? (d <= 0 ? 'green' : 'red') : '') + '">' + (d !== null && !note ? gap(d) : '') + '</td><td class="faint">' + note + '</td></tr>';
    }).join('') + '</tbody></table></td></tr>';
  }

  // ---------- race pace: class + car, the tracks, a track's drivers (each averaged over their cars) ----------
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
  function segOf(items, on, attr) { return '<div class="seg">' + items.map(function (it) { return '<button ' + attr + '="' + esc(it[0]) + '"' + (it[0] === on ? ' class="on"' : '') + '>' + esc(it[1]) + '</button>'; }).join('') + '</div>'; }
  function paceView(d, track) {
    var pace = d.pace;
    if (!pace.length) { view.innerHTML = card('Race pace', '<div class="sub">No race pace shared yet: each member shares theirs from the desktop app (Team tab, Settings).</div>'); return; }
    var count = {}; pace.forEach(function (p) { var c = clsOf(p); count[c] = (count[c] || 0) + 1; });
    var classes = Object.keys(count);
    if (track && !(cls && pace.some(function (p) { return clsOf(p) === cls && trackName(p.track) === track; }))) {        // a link to a track: its most driven class
      var tc = {}; pace.forEach(function (p) { if (trackName(p.track) === track) tc[clsOf(p)] = (tc[clsOf(p)] || 0) + 1; });
      var k = Object.keys(tc).sort(function (a, b) { return tc[b] - tc[a]; })[0]; if (k) { cls = k; car = ''; }
    }
    if (!cls || !count[cls]) cls = classes.sort(function (a, b) { return count[b] - count[a]; })[0];
    var inCls = pace.filter(function (p) { return clsOf(p) === cls; }), cars = {}; inCls.forEach(function (p) { cars[p.car] = 1; }); if (car && !cars[car]) car = '';
    var rows = inCls.filter(function (p) { return !car || p.car === car; }), by = {};
    rows.forEach(function (p) { var k2 = trackName(p.track); if (!by[k2]) by[k2] = { name: k2, rows: [], last: 0 }; by[k2].rows.push(p); by[k2].last = Math.max(by[k2].last, p.last); });
    var h = '<div class="pagehead"><h1>Race pace</h1></div><div class="filters">' + segOf(classes.map(function (c) { return [c, clsLabel(c)]; }), cls, 'data-c') +
      segOf([['', 'All cars']].concat(Object.keys(cars).sort().map(function (c) { return [c, c]; })), car, 'data-car') + '</div>';
    if (track && by[track]) {
      var ds = perDriver(by[track].rows).sort(function (a, b) { return (a.pace || 1e9) - (b.pace || 1e9); }), wp = ds.filter(function (x) { return x.pace > 0; }), top = wp[0];
      var avg = wp.length ? wp.reduce(function (t, x) { return t + x.pace; }, 0) / wp.length : 0, tl = ds.filter(function (x) { return x.best > 0; }).sort(function (a, b) { return a.best - b.best; })[0], mine = wp.filter(function (x) { return x.me; })[0];
      h += '<a class="back" href="#/pace">&larr; All tracks</a>' + card(esc(track), '<div class="tiles">' +
        tile('Best pace', lap(top && top.pace), top ? esc(top.name) : '', 'acc') + tile('Average team pace', lap(avg), wp.length + ' drivers') + tile('Best quali', lap(tl && tl.best), tl ? esc(tl.name) : '', 'purple') +
        tile('Your pace', lap(mine && mine.pace), mine && top ? (mine === top ? 'the best' : gap(mine.pace - top.pace)) : '') + '</div>' +
        '<div class="scroll mt10"><table class="tbl"><thead><tr><th>Driver</th><th class="num">Pace</th><th class="num">Gap</th><th class="num">Best</th><th>Cars</th></tr></thead><tbody>' +
        ds.map(function (x) { return '<tr' + (x.me ? ' class="me"' : '') + '><td>' + esc(x.name) + '</td><td class="num">' + lap(x.pace) + '</td><td class="num">' + (top && x.pace > 0 ? (x === top ? 'best' : gap(x.pace - top.pace)) : '--') + '</td><td class="num purple">' + lap(x.best) + '</td>' +
          '<td>' + esc(x.paceCar || x.bestCar) + (x.cars > 1 ? '<span class="two">' + x.cars + ' cars · fastest lap ' + esc(x.bestCar) + (x.consCar ? ' · steadiest ' + esc(x.consCar) : '') + '</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>');
    } else {
      var list = Object.keys(by).map(function (k3) { return by[k3]; }).sort(function (a, b) { return b.last - a.last; });
      h += card('Tracks', '<div class="scroll"><table class="tbl"><thead><tr><th>Track</th><th class="num">Best pace</th><th class="num">Team avg</th><th class="num">Yours</th></tr></thead><tbody>' + list.map(function (g) {
        var ds2 = perDriver(g.rows), wp2 = ds2.filter(function (x) { return x.pace > 0; }).sort(function (a, b) { return a.pace - b.pace; }), top2 = wp2[0], mine2 = wp2.filter(function (x) { return x.me; })[0];
        var avg2 = wp2.length ? wp2.reduce(function (t, x) { return t + x.pace; }, 0) / wp2.length : 0;
        return '<tr class="click" data-k="' + esc(g.name) + '"><td><b>' + esc(g.name) + '</b><span class="two">' + ds2.length + ' drivers</span></td><td class="num">' + lap(top2 && top2.pace) + '<span class="two">' + (top2 ? esc(top2.name) : '') + '</span></td>' +
          '<td class="num">' + lap(avg2) + '</td><td class="num' + (mine2 && mine2 === top2 ? ' green' : '') + '">' + lap(mine2 && mine2.pace) + '</td></tr>';
      }).join('') + '</tbody></table></div>');
    }
    view.innerHTML = h;
    view.onclick = function (e) {
      var c = e.target.closest('[data-c]'); if (c) { cls = c.getAttribute('data-c'); car = ''; location.hash = '#/pace'; return paceView(d, null); }
      var k4 = e.target.closest('[data-car]'); if (k4) { car = k4.getAttribute('data-car'); return paceView(d, track); }
      var t = e.target.closest('[data-k]'); if (t) location.hash = '#/pace/' + encodeURIComponent(t.getAttribute('data-k'));
    };
  }

  // ---------- team ----------
  function teamView(d) {
    view.onclick = null;
    var ts = me.teams || [];
    view.innerHTML = '<div class="pagehead"><h1>' + esc(team.name) + '</h1><span class="faint">' + d.members.length + ' members</span></div><div class="cols">' +
      card('Members', '<div class="people">' + d.members.map(function (m) {
        return '<div class="person' + (m.me ? ' me' : '') + '"><i>' + initial(m.name) + '</i><span><b>' + esc(m.name) + (m.me ? ' <small>you</small>' : '') + '</b><small>' + esc(roleWords(m.roles)) + '</small></span></div>';
      }).join('') + '</div>') +
      card('Your teams', '<div class="people">' + ts.map(function (t) {
        return '<button class="person pick' + (t.id === team.id ? ' on' : '') + '" data-team="' + t.id + '"><i>' + initial(t.name) + '</i><span><b>' + esc(t.name) + '</b><small>' + esc(roleWords(t.roles)) + '</small></span></button>';
      }).join('') + '</div><div class="sub mt10">Invites, roles and leaving a team: in the desktop app.</div>') + '</div>';
    view.onclick = function (e) { var b = e.target.closest('[data-team]'); if (!b) return; $('tsel').value = b.getAttribute('data-team'); $('tsel').onchange.call($('tsel')); };
  }

  // ---------- me ----------
  // your own stats (the desktop app sends your race pace sheet; only you see it) + your account
  var mine = null, myCls = '';
  function account() {
    view.onclick = null;
    if (!mine) { view.innerHTML = '<div class="faint mt20">Loading...</div>'; get('/api/v1/me/pace').then(function (l) { mine = l || []; account(); }, function (e) { if (e.status === 401) login(); else { mine = []; account(); } }); return; }
    var ratio = function (t, b) { return t > 0 && b > 0 ? t / b : 0; };
    var catChip = function (r) { var k = R.category(r); return k ? '<span class="cat" data-bgc="' + k.color + '">' + esc(k.name) + '</span>' : ''; };
    // as the desktop app's Race Pace page: one class at a time (the one you drove most first), a row per track; your level = the average % over its tracks
    var count = {}; mine.forEach(function (p) { var c = clsOf(p); count[c] = (count[c] || 0) + p.laps; });
    var classes = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
    if (!myCls || !count[myCls]) myCls = classes[0] || '';
    var rows = mine.filter(function (p) { return clsOf(p) === myCls; }).sort(function (a, b) { return b.last - a.last; });
    var h = '<div class="pagehead"><h1>' + esc(me.name) + '</h1><span class="faint">your race pace, only you see it</span></div>';
    if (!mine.length) h += card('My stats', '<div class="sub">No stats yet. The desktop app sends them by itself (Settings: <b>Keep my stats on the website</b>) the next time a hub page reads your results.</div>');
    else {
      var mean = function (l) { return l.length ? l.reduce(function (t, x) { return t + x; }, 0) / l.length : 0; };
      var pr = rows.map(function (p) { return p.clean >= 5 ? ratio(p.pace, p.refPace) : 0; }).filter(function (x) { return x > 0; }), hr = rows.map(function (p) { return ratio(p.best, p.refHot); }).filter(function (x) { return x > 0; });
      var avg = mean(pr), avgQ = mean(hr), k = R.category(avg), q = R.category(avgQ), laps = 0, ses = 0; rows.forEach(function (p) { laps += p.laps; ses += p.sessions || 0; });
      h += '<div class="filters">' + segOf(classes.map(function (c) { return [c, clsLabel(c)]; }), myCls, 'data-mc') + '</div>';
      h += '<div class="tiles tiles4">' + tile('Race pace level', avg ? F.pctOver(avg) : '--', k ? '<span data-col="' + k.color + '">' + esc(k.name) + '</span> · ' + pr.length + (pr.length === 1 ? ' track' : ' tracks') : 'needs a reference + 5 counted laps') +
        tile('Fastest lap level', avgQ ? F.pctOver(avgQ) : '--', q ? '<span data-col="' + q.color + '">' + esc(q.name) + '</span> · ' + hr.length + (hr.length === 1 ? ' track' : ' tracks') : '') +
        tile('Tracks', rows.length, F.count(laps) + ' laps · ' + ses + ' sessions') +
        tile('Last driven', rows.length ? ago(rows[0].last) : '--', rows.length ? esc(rows[0].track) : '') + '</div>';
      h += card('Tracks', '<div class="sub">' + esc(clsLabel(myCls)) + ': race pace compared with the alien times of the LMU laptimes sheet (race sessions; sessions on an older game version are left out).</div>' +
        '<div class="scroll"><table class="tbl"><thead><tr><th>Track</th><th class="num">Cars</th><th class="num">Sessions</th><th class="num">Laps</th><th class="num">Best lap</th><th class="num">Fastest lap %</th><th class="num">Race pace</th><th class="num">Race pace %</th><th>Category</th><th class="num">Last driven</th></tr></thead><tbody>' +
        rows.map(function (p) {
          var r1 = p.clean >= 5 ? ratio(p.pace, p.refPace) : 0, r2 = ratio(p.best, p.refHot);
          return '<tr><td><b>' + esc(p.track) + '</b>' + (p.refPace || p.refHot ? '' : '<span class="two">not in the sheet</span>') + '</td><td class="num">' + (p.cars || 1) + '</td><td class="num">' + (p.sessions || '--') + '</td><td class="num">' + F.count(p.laps) + '</td>' +
            '<td class="num purple">' + lap(p.best) + '<span class="two">' + esc(p.car) + '</span></td><td class="num">' + (r2 ? F.pctOver(r2) : '--') + '</td>' +
            '<td class="num">' + lap(p.pace) + '<span class="two">' + (p.clean ? p.clean + ' laps' : '') + '</span></td><td class="num"><b>' + (r1 ? F.pctOver(r1) : '--') + '</b></td>' +
            '<td>' + catChip(r1) + '</td><td class="num muted">' + esc(F.day(p.last)) + '</td></tr>';
        }).join('') + '</tbody></table></div>');
    }
    h += '<div class="cols">' + card('Account', '<div class="tiles">' + tile('Name', esc(me.name), 'in your teams') + tile('Discord', me.discord ? esc(me.discord) : '--', me.discord ? 'linked' : 'link it in the desktop app') +
        tile('Teams', (me.teams || []).length, esc((me.teams || []).map(function (t) { return t.name; }).join(', '))) + '</div>' +
        '<div class="sub mt14">The web can only look; changes are made in the desktop app.</div>' +
        '<button class="btn wide" id="out">Log out here</button>') + '</div>';
    view.innerHTML = h; paint(view);
    $('out').onclick = function () { mine = null; post('/api/v1/web/logout').then(login, login); };
    view.onclick = function (e) { var b = e.target.closest('[data-mc]'); if (b) { myCls = b.getAttribute('data-mc'); account(); } };
  }

  // ---------- team-mates racing now (live sessions: their desktop app sends its car's own numbers every 2 s while they drive) ----------
  // Asked every 10 s while this page is visible (every 3 s on a live page), never while it is in the background.
  var lives = [], liveSeen = {}, liveTimer = null, livePage = null, lvTab = 'car', lvOpenStint = {};
  function liveLoad() {
    if (!me || document.hidden) return;
    get('/api/v1/live').then(function (l) {
      lives = (l || []).filter(function (x) { return !x.me; }); lives.forEach(function (x) { liveSeen[x.user] = x; });
      liveBanner(); if (livePage !== null) liveView();
    }, function (e) { if (e.status === 401) login(); });
  }
  function livePoll() { clearInterval(liveTimer); liveTimer = setInterval(liveLoad, livePage !== null ? 3000 : 10000); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) liveLoad(); });
  function sesWord(n) { return { 'TEST DAY': 'Test day', PRACTICE: 'Practice', QUALIFY: 'Qualifying', WARMUP: 'Warm-up', RACE: 'Race' }[F.sessionName(n)] || 'Session'; }
  function liveBanner() {
    var b = $('livebar'), x = lives[0];
    b.hidden = !me || !x || livePage !== null;
    if (b.hidden) return;
    b.href = '#/live/' + x.user;
    b.innerHTML = '<i class="dot"></i><span><b>' + esc(x.name) + '</b> is in a ' + esc(sesWord(x.session).toLowerCase()) + ' at ' + esc(trackName(x.track)) + (x.top && x.top.classPos ? ' · P' + x.top.classPos : '') +
      (lives.length > 1 ? ' <small>+' + (lives.length - 1) + ' more</small>' : '') + '</span><em>View</em>';
  }
  // colours and widths that change with the numbers: set through the DOM (allowed by the site's CSP), not as style="" in the HTML
  function paint(root) {
    [].forEach.call(root.querySelectorAll('[data-col]'), function (e) { e.style.color = e.getAttribute('data-col'); });
    [].forEach.call(root.querySelectorAll('[data-w]'), function (e) { e.style.width = e.getAttribute('data-w') + '%'; e.style.background = e.getAttribute('data-bg'); });
    [].forEach.call(root.querySelectorAll('[data-bgc]'), function (e) { e.style.background = e.getAttribute('data-bgc'); });
  }
  function bar(frac, color) { return '<div class="lv-bar"><i data-w="' + Math.max(0, Math.min(100, (frac || 0) * 100)).toFixed(0) + '" data-bg="' + esc(color) + '"></i></div>'; }
  function liveView() {
    var x = lives.filter(function (l) { return l.user === livePage; })[0], gone = !x; x = x || liveSeen[livePage];
    if (!x) { view.innerHTML = '<a class="back" href="#/">&larr; Home</a>' + card('Live', '<div class="sub">Nobody is racing right now. When a team-mate drives with the desktop app, it shows here.</div>'); return; }
    var c = x.car || {}, t = x.top || {}, ve = c.ve || {}, fu = c.fuel || {};
    var lastC = F.lastColor(t.lastFlag, { classBest: '#B47CFF', ownBest: '#3DDC84', normal: '#E9EEEF' });
    var veC = F.veColor(ve.now, { none: '#5C686D', low: '#FF5A5F', mid: '#FFD21F', ok: '#35C8C0' });
    var cell = function (k, v, n, col) { return '<div class="lv-cell"><div class="k">' + k + '</div><div class="v"' + (col ? ' data-col="' + col + '"' : '') + '>' + v + '</div><div class="n">' + (n || '') + '</div></div>'; };
    var h = '<a class="back" href="#/">&larr; Home</a><section class="card lv">' +
      '<div class="lv-top"><span class="lv-live' + (gone ? ' off' : '') + '"><i></i>' + (gone ? 'ENDED' : 'LIVE') + '</span>' +
      '<div class="lv-who"><b>' + esc(c.driver || x.name) + '</b><span>' + esc([trackName(x.track), sesWord(x.session), c.model || x.entry, c.inPits ? 'in the pits' : ''].filter(Boolean).join(' · ')) + '</span></div>' +
      '<div class="lv-pos"><b>' + (t.classPos ? 'P' + t.classPos : '--') + '</b><span>' + (t.overall ? 'P' + t.overall + ' overall' : '') + '</span></div></div>' +
      '<div class="lv-strip">' + cell('Lap', t.lap || '--', t.timeLeft >= 0 ? F.clock(t.timeLeft) + ' left' : t.lapsLeft >= 0 ? Math.ceil(t.lapsLeft) + ' laps left' : '') +
      cell('Last lap', lap(t.last), t.lastDiff !== null && t.lastDiff !== undefined && t.last > 0 ? (t.lastDiff > 0 ? '+' : '') + t.lastDiff.toFixed(3) + ' to best' : '', lastC) +
      cell('Best', lap(t.best), '', '#B47CFF') +
      cell('Stint', c.stintLaps >= 0 ? c.stintLaps + (c.stintLaps === 1 ? ' lap' : ' laps') : '--', '') +
      '<div class="lv-cell"><div class="k">Virtual energy</div><div class="v" data-col="' + veC + '">' + (ve.now >= 0 ? F.pct(ve.now, 1) : '--') + '</div>' + bar((ve.now || 0) / 100, veC) +
        '<div class="n">' + (ve.avg > 0 ? F.pct(ve.avg, 2) + ' a lap' : '') + (ve.laps > 0 ? ' · ' + ve.laps.toFixed(1) + ' laps' : '') + '</div></div>' +
      (fu.now > 0 ? cell('Fuel', fu.now.toFixed(1) + ' L', fu.avg > 0 ? fu.avg.toFixed(2) + ' L a lap' : '') : '') + '</div>' +
      '<div class="lv-foot"><div class="seg" id="lvTabs"><button data-lv="car"' + (lvTab === 'car' ? ' class="on"' : '') + '>Car</button><button data-lv="laps"' + (lvTab === 'laps' ? ' class="on"' : '') + '>Laps</button></div>' +
      '<span class="faint">' + (gone ? 'not live any more' : 'updated ' + Math.max(0, Math.round((Date.now() - x.at) / 1000)) + ' s ago') + '</span></div>' +
      (lvTab === 'car' ? carHtml(c) : lapsHtml(x)) + '</section>';
    if (lives.length > 1) h += card('Also racing', '<div class="people">' + lives.filter(function (l) { return l !== x; }).map(function (l) {
      return '<a class="person" href="#/live/' + l.user + '"><i>' + initial(l.name) + '</i><span><b>' + esc(l.name) + '</b><small>' + esc(trackName(l.track)) + (l.top && l.top.classPos ? ' · P' + l.top.classPos : '') + '</small></span></a>';
    }).join('') + '</div>');
    view.innerHTML = h; paint(view); P.liveCar.paint(view);
    view.onclick = function (e) {
      var b = e.target.closest('[data-lv]'); if (b) { lvTab = b.getAttribute('data-lv'); return liveView(); }
      var tr = e.target.closest('tr[data-lst]'); if (tr) { var i = +tr.getAttribute('data-lst'); lvOpenStint[i] = !lvOpenStint[i]; liveView(); }
    };
  }
  // the car: live-car.js (shared with the desktop app's Team tab)
  function carHtml(c) { return P.liveCar.html(c); }
  // this session's stints (a pit lap ends one) with their laps: the review's maths, like a team race
  function lapsHtml(x) {
    var laps = (x.laps || []).map(function (l) { return [l[0], l[1] > 0 ? l[1] : null, l[2] ? 1 : 0, null, (x.car && x.car.driver) || x.name, l[3] > 0 ? l[3] : null, l[4] >= 0 ? l[4] : null, null, -1]; });
    if (!laps.length) return '<div class="sub mt14">No laps yet in this session.</div>';
    var st = RM.stints({ laps: laps });
    return '<div class="sub mt14">Stints of this session: tap one for its laps.</div><div class="scroll"><table class="tbl"><thead><tr><th class="num">#</th><th class="num">Laps</th><th class="num">Average</th><th class="num">Fastest</th><th class="num">VE/lap</th><th class="num">VE left</th><th></th></tr></thead><tbody>' +
      st.map(function (s, i) {
        return '<tr class="click' + (lvOpenStint[i] ? ' open' : '') + '" data-lst="' + i + '"><td class="num">' + s.n + '</td><td class="num">' + s.laps + '<span class="two">' + s.from + '-' + s.to + '</span></td><td class="num">' + lap(s.avg) + '<span class="two">' + s.clean + ' clean</span></td>' +
          '<td class="num purple">' + lap(s.best) + '</td><td class="num">' + (s.ve ? F.pct(s.ve, 2) : '--') + '</td><td class="num">' + (s.veLeft >= 0 && s.veLeft !== null ? F.pct(s.veLeft, 1) : '--') + '</td>' +
          '<td class="faint">' + (i === st.length - 1 && !s.pitted ? 'now' : s.pitted ? 'stop' : '') + '</td></tr>' + (lvOpenStint[i] ? lapsRow(s) : '');
      }).join('') + '</tbody></table></div>';
  }

  start();
})();
