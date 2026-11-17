// Hub page "Team" (owner 2026-11-16): the team server. Connect, set it up (server owner) or join with an invite code. Then:
//  - NEW RACES FOR YOUR TEAMS (all teams): your races of the last 60 days and which team each was for (TeamClient.Suggest: the car's team name in the
//    results file, the team's earlier races, team-mates in the car); send with one click or skip ("not a team race"); a team can send its races by itself.
//  - one tab per team: Overview (numbers + race results showcase), Race pace (every member's sheet per track + car), Members (+ invites), Settings.
//  - Account: your name, join another team, disconnect; the server owner makes teams.
// Every action goes through the app (api/team?op=..., TeamClient.cs): the member key stays in the app. Text from the server is shown as text (esc), never HTML.
(function (root) {
  'use strict';
  var P = root.MyLMUHub, H = P.hub, F = P.format, R = P.paceRef, PM = P.paceMath, esc = H.esc;
  var $ = function (id) { return document.getElementById(id); };
  H.header('team');
  if (H.inApp) H.json('api/pace?light=1').then(function (i) { H.setWho(i.names && i.names[0]); }, function () {});
  var st = null, team = null, tab = 'overview', members = [], results = [], pace = [], sug = { races: [], teams: [] }, mySessions = null, paceTrack = null, cls = '';
  try { tab = new URLSearchParams(location.search).get('tab') || localStorage.getItem('pw-team-tab') || 'overview'; } catch (e) {}
  if (tab === 'profile') tab = 'members';                                                // a profile is opened from Members, not kept

  function api(op, body) {
    return fetch('api/team?op=' + encodeURIComponent(op), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MLH': '1' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error((j && j.error) || ('error ' + r.status)); e.status = r.status; throw e; } return j; }); });
  }
  function info(t, bad) { $('info').textContent = t || ''; $('info').style.color = bad ? 'var(--red)' : ''; }
  function tile(k, v, n) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div><div class="n">' + (n || '') + '</div></div>'; }
  function day(t) { return new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  function trackName(t) { return (R && R.trackName(t, '')) || t || ''; }
  function roleWords(r) { return (r || []).map(function (x) { return x === 'owner' ? 'Owner' : x === 'engineer' ? 'Engineer' : 'Driver'; }).join(' + '); }
  function isOwner() { return !!team && (team.roles || []).indexOf('owner') >= 0; }
  function teams() { return (st && st.me && st.me.teams) || []; }
  function teamById(id) { return teams().filter(function (t) { return t.id === id; })[0]; }
  function show(id, on) { $(id).hidden = !on; }
  function lap(v) { return v > 0 ? F.lap(v) : '--'; }

  // ---------- load ----------
  function load() {
    if (!H.inApp) { info('Open this page in the app.'); return; }
    api('status').then(function (s) {
      st = s;
      var member = !!(s.connected && s.member && s.me);
      // not connected / no team yet: a pointer to Settings (where you connect, join or make a team)
      var noTeam = !member || !(s.me.teams || []).length;
      show('noTeamCard', noTeam); show('chips', member);
      $('noTeamText').textContent = !s.connected ? 'Not connected to a team server yet. Connect in Settings, then join your team with its invite code.'
        : !s.reachable ? 'The team server (' + s.url.replace(/^https:\/\//, '') + ') cannot be reached right now.'
        : !member ? (s.setup ? 'This server is not set up yet: do it in Settings.' : 'Join your team in Settings, with its invite code.')
        : s.me.admin ? 'You are in no team yet: make one in Settings.' : 'You are in no team yet: join one in Settings, with its invite code.';
      info('');
      if (!member) { show('teamArea', false); show('newCard', false); return; }
      var keep = team && teamById(team.id); team = keep || teams()[0] || null;
      renderChips(); loadTeam(); loadSuggest(); liveLoad();
    }, function (e) { info(e.message, true); });
  }
  function loadSuggest() {
    $('syncInfo') && ($('syncInfo').textContent = 'checking your files...');
    api('suggest').then(function (s) {
      sug = s || { races: [], teams: [] }; renderChips(); renderNew(); renderSettings(); sharePace();
      if (team && (sug.races || []).some(function (r) { return r.status === 'sent now' && r.sentTo.indexOf(team.id) >= 0; })) loadTeam();
    }, function () {});
  }
  function loadTeam() {
    show('teamArea', !!team); if (!team) return;
    $('teamName').textContent = team.name; $('teamInfo').textContent = 'You: ' + roleWords(team.roles) + ' · ' + teams().length + (teams().length === 1 ? ' team' : ' teams'); loadLogos(); paintLogo();
    show('inviteBox', isOwner()); setTab(tab);
    var id = team.id;
    Promise.all([api('members', { team: id }), api('results', { team: id }), api('pace', { team: id }).catch(function () { return []; })]).then(function (a) {
      if (!team || team.id !== id) return;
      members = a[0] || []; results = a[1] || []; pace = a[2] || [];
      if (!pace.some(function (p) { return p.me; })) { try { localStorage.removeItem('pw-team-pace-' + id); } catch (e) {} sharePace(); }   // none of yours there: send it again
      renderSummary(); renderResults(); renderMembers(); renderPace(); renderSettings(); renderTeamPace(); renderNews(); renderCards(); H.loaded();
    }, function (e) { info(e.message, true); });
  }

  // ---------- team chips + tabs ----------
  // ---------- team logos (the team server: a PNG rebuilt from its pixels; fetched once per version of it) ----------
  var logos = {};                                                                      // team id -> { at, src } (src '' = none / loading)
  function logoHtml(t, big) {
    var l = t && logos[t.id], first = esc(String((t && t.name) || '?').trim().charAt(0).toUpperCase() || '?');
    return l && l.src ? '<img src="' + l.src + '" alt="">' : first;
  }
  function loadLogos() {
    teams().forEach(function (t) {
      var at = t.logo || 0, l = logos[t.id];
      if (l && l.at === at) return;
      logos[t.id] = { at: at, src: '' };
      if (!at) { renderChips(); paintLogo(); return; }
      api('logo', { team: t.id }).then(function (r) {
        if (!r || !r.png || !/^[A-Za-z0-9+/=]+$/.test(r.png)) return;
        logos[t.id] = { at: at, src: 'data:image/png;base64,' + r.png }; renderChips(); paintLogo();
      }, function () {});
    });
  }
  function paintLogo() { if (!team) return; $('teamLogo').innerHTML = logoHtml(team, true); $('logoPrev').innerHTML = logoHtml(team, true); show('logoDel', !!(team.logo)); }
  function renderChips() {
    $('chips').innerHTML = teams().map(function (t) {
      return '<button class="tchip' + (team && t.id === team.id ? ' on' : '') + '" data-team="' + t.id + '"><span class="tlogo">' + logoHtml(t) + '</span><span><b>' + esc(t.name) + '</b><small>' + esc(roleWords(t.roles)) + '</small></span></button>';
    }).join('');
  }
  // the owner: a picture -> 256 x 256 PNG here (canvas: only its pixels leave this PC) -> the server (which checks and rebuilds it)
  $('logoPick').onclick = function () { $('logoFile').value = ''; $('logoFile').click(); };
  $('logoFile').onchange = function () {
    var f = this.files && this.files[0]; if (!f || !team) return;
    if (f.size > 15 * 1024 * 1024) { info('That picture is too big (15 MB at most).', true); return; }
    var url = URL.createObjectURL(f), img = new Image(), id = team.id;
    img.onload = function () {
      URL.revokeObjectURL(url);
      var send = function (side) {
        var c = document.createElement('canvas'); c.width = c.height = side; var g = c.getContext('2d'), k = Math.min(side / img.width, side / img.height);
        var w = Math.round(img.width * k), h = Math.round(img.height * k); g.drawImage(img, Math.round((side - w) / 2), Math.round((side - h) / 2), w, h);
        var png = c.toDataURL('image/png').split(',')[1];
        if (png.length > 230000 && side > 96) return send(Math.round(side * 0.75));                     // a busy photo: a little smaller
        api('setLogo', { team: id, png: png }).then(function () { info('Logo saved.'); load(); }, function (e) { info('The logo was not saved: ' + e.message, true); });
      };
      send(256);
    };
    img.onerror = function () { URL.revokeObjectURL(url); info('That file is not a picture this app can read.', true); };
    img.src = url;
  };
  $('logoDel').onclick = function () { if (team && confirm('Remove the logo of ' + team.name + '?')) api('removeLogo', { team: team.id }).then(function () { info('Logo removed.'); load(); }, function (e) { info(e.message, true); }); };
  $('chips').onclick = function (e) { var c = e.target.closest('[data-team]'); if (!c) return; team = teamById(+c.getAttribute('data-team')); paceTrack = null; show('rvArea', false); show('resCard', true); renderChips(); loadTeam(); };
  function setTab(t) {
    tab = t; try { localStorage.setItem('pw-team-tab', t); } catch (e) {}
    [].forEach.call(document.querySelectorAll('#tabs [data-tab]'), function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === t); });
    [].forEach.call(document.querySelectorAll('[data-pane]'), function (p) { p.hidden = p.getAttribute('data-pane') !== t; });
  }
  $('tabs').onclick = function (e) { var a = e.target.closest('[data-tab]'); if (a) setTab(a.getAttribute('data-tab')); };

  // ---------- team races from your files (sent by themselves, TeamClient.Suggest) ----------
  var STATUS = { 'sent': ['sent', 'var(--green)'], 'sent now': ['sent just now', 'var(--green)'], 'incomplete': ['not sent: incomplete (no finish or laps missing in your files)', 'var(--yellow)'],
    'unclear': ['not sent: fits more than one team', 'var(--yellow)'], 'unknown': ['not sent: no team recognised', 'var(--faint)'] };
  // folded by default; the choice is kept
  var newOpen = false; try { newOpen = localStorage.getItem('pw-team-races-open') === '1'; } catch (e) {}
  function foldNew() { $('newBody').hidden = !newOpen; $('newArrow').innerHTML = newOpen ? '&#9662;' : '&#9656;'; }
  $('newHead').onclick = function () { newOpen = !newOpen; try { localStorage.setItem('pw-team-races-open', newOpen ? '1' : '0'); } catch (e) {} foldNew(); };
  foldNew();
  function renderNew() {
    var list = sug.races || [];
    show('newCard', !!teams().length);
    var sent = list.filter(function (r) { return r.sentTo.length; }).length;
    $('syncInfo').textContent = list.length ? sent + ' of ' + list.length + ' with the team' : '';
    if (!list.length) { $('newTbl').innerHTML = '<tbody><tr><td class="faint">No special events of yours in the last 60 days (10 laps or more).</td></tr></tbody>'; return; }
    $('newTbl').innerHTML = '<thead><tr><th>When</th><th>Race</th><th class="num">Class</th><th>Team</th><th>Status</th></tr></thead><tbody>' + list.map(function (r) {
      var c = r.candidates[0], to = r.sentTo.map(function (id) { var t = teamById(id); return t ? t.name : '?'; });
      var st = STATUS[r.status] || ['', 'var(--faint)'];
      var teamCell = to.length ? '<span class="tag">' + esc(to.join(', ')) + '</span>' : c ? esc(r.candidates.map(function (x) { return x.name; }).join(' / ')) : '<span class="faint">--</span>';
      var why = c ? '<div class="why">' + esc(c.why.join(' · ')) + '</div>' : '';
      return '<tr><td>' + day(r.date) + '</td><td>' + esc(trackName(r.track)) + '<div class="why">' + esc([r.car, r.teamName].filter(Boolean).join(' · ')) + ' · ' + r.laps + ' laps</div></td>' +
        '<td class="num">' + (r.classPos ? 'P' + r.classPos : '--') + '</td><td>' + teamCell + why + '</td><td style="color:' + st[1] + '">' + esc(st[0]) + '</td></tr>';
    }).join('') + '</tbody>';
  }

  // ---------- overview ----------
  function renderSummary() {
    var rs = results.map(function (x) { return x.result; }), best = null, laps = 0;
    rs.forEach(function (r) { laps += r.laps || 0; if (r.classPos > 0 && (best === null || r.classPos < best.classPos)) best = r; });
    var tracks = {}; pace.forEach(function (p) { tracks[p.track] = 1; });
    $('sumTiles').innerHTML = tile('Members', members.length, members.filter(function (m) { return m.roles.indexOf('driver') >= 0; }).length + ' drivers') +
      tile('Races', rs.length, rs.length ? 'last ' + day(rs[0].date) : '') + tile('Laps raced', laps, 'in team races') +
      tile('Best finish', best ? 'P' + best.classPos : '--', best ? esc(best.cls + ' · ' + trackName(best.track)) : '') +
      tile('Tracks with pace', Object.keys(tracks).length, 'shared by the members');
  }
  // ---------- the website's team features (owner 2026-11-17): team news, the team's pace on the last race's track, driver cards and profiles ----------
  function agoText(t) { var d = Math.floor((Date.now() / 1000 - t) / 86400); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? d + ' days ago' : day(t); }
  function gapText(d) { return (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(3); }
  function initialOf(n) { return esc((String(n || '?').trim()[0] || '?').toUpperCase()); }
  function nameWords(n) { return String(n || '').toLowerCase().split(/[\s._-]+/).filter(Boolean); }
  function racesOf(m) { var my = nameWords(m.name); return results.filter(function (x) { return my.length && ((x.result && x.result.drivers) || []).some(function (q) { var w = nameWords(q.name); return my.every(function (y) { return w.indexOf(y) >= 0; }); }); }); }
  function renderTeamPace() {
    var last = results[0] && results[0].result, lt = last ? trackName(last.track) : null, lc = last ? (R.className(last.cls) || last.cls) : null;
    $('tpTitle').textContent = 'Team pace' + (lt ? ' · ' + lt : '');
    var here = lt ? perDriver(pace.filter(function (p) { return trackName(p.track) === lt && clsOf(p) === lc; })).filter(function (x) { return x.pace > 0; }).sort(function (a, b) { return a.pace - b.pace; }) : [];
    $('tpBox').innerHTML = here.length ? '<div class="plist">' + here.slice(0, 8).map(function (x, i) {
      return '<div class="prow" data-prof="' + x.user + '"><span><b><span class="faint">' + (i + 1) + '</span> ' + esc(x.name) + (x.me ? '<em class="you">you</em>' : '') + '</b><small>' + esc(x.paceCar || x.bestCar || '') + '</small></span>' +
        '<span class="num">' + lap(x.pace) + '<small class="' + (i === 0 ? 'green' : '') + '">' + (i === 0 ? 'fastest' : gapText(x.pace - here[0].pace)) + '</small></span></div>';
    }).join('') + '</div>' : '<div class="faint">No race pace shared for ' + (lt ? esc(lt) : 'the last race\'s track') + ' yet.</div>';
  }
  function renderNews() {
    var items = [];
    members.forEach(function (m) { if (m.joined > 0) items.push({ t: m.joined, i: initialOf(m.name), h: '<b>' + esc(m.name) + '</b> joined the team', attr: 'data-prof="' + m.id + '"' }); });
    results.forEach(function (x) { var r = x.result; items.push({ t: r.date, i: 'R', h: 'Team race: <b>' + esc(trackName(r.track)) + '</b>' + (r.classPos ? ', P' + r.classPos : '') + ' <span class="faint">(' + esc((r.drivers || []).map(function (q) { return q.name.split(' ')[0]; }).join(', ')) + ')</span>', attr: 'data-race="' + x.id + '"' }); });
    items.sort(function (a, b) { return b.t - a.t; });
    $('newsBox').innerHTML = items.length ? '<div class="news">' + items.slice(0, 7).map(function (n) { return '<div ' + n.attr + '><i>' + n.i + '</i><span><span>' + n.h + '</span><small>' + esc(agoText(n.t)) + '</small></span></div>'; }).join('') + '</div>' : '<div class="faint">Nothing yet.</div>';
  }
  function renderCards() {
    $('memCards').innerHTML = members.map(function (m) {
      var rows = pace.filter(function (p) { return p.user === m.id; }), tr = {}; rows.forEach(function (p) { tr[trackName(p.track)] = 1; });
      return '<button type="button" class="pcard" data-prof="' + m.id + '"><span class="ph"><span class="av">' + initialOf(m.name) + '</span><span><b>' + esc(m.name) + (m.me ? '<em class="you">you</em>' : '') + '</b><small>' + esc(roleWords(m.roles)) + '</small></span></span>' +
        '<span class="pl">' + Object.keys(tr).length + ' tracks with pace · ' + racesOf(m).length + ' team races</span><span class="go">View profile</span></button>';
    }).join('');
  }
  // a member's race pace: one row per track for the chosen class, the cars of that class folded in (owner rule: never per track + car)
  var profCls = '';
  function byTrack(rows, cls) {
    var g = {}; rows.forEach(function (p) { if (clsOf(p) !== cls) return; var k = trackName(p.track); (g[k] = g[k] || []).push(p); });
    return Object.keys(g).map(function (k) { var d = perDriver(g[k])[0]; d.track = k; return d; }).sort(function (a, b) { return b.last - a.last; });
  }
  function openProfile(id, cls) {
    var m = members.filter(function (x) { return x.id === id; })[0]; if (!m) return;
    var rows = pace.filter(function (p) { return p.user === id; }), tracks = {}, top = [];
    rows.forEach(function (p) { tracks[trackName(p.track) + '|' + clsOf(p)] = 1; });
    Object.keys(tracks).forEach(function (k) {
      var parts = k.split('|'), ds = perDriver(pace.filter(function (p) { return trackName(p.track) === parts[0] && clsOf(p) === parts[1]; })).filter(function (x) { return x.pace > 0; }).sort(function (a, b) { return a.pace - b.pace; });
      if (ds.length > 1 && ds[0].user === id) top.push(parts[0]);
    });
    var steady = rows.filter(function (p) { return p.sd > 0 && p.clean >= 5; }).sort(function (a, b) { return a.sd - b.sd; })[0], races = racesOf(m);
    var lapsBy = {}; rows.forEach(function (p) { var c = clsOf(p); lapsBy[c] = (lapsBy[c] || 0) + (p.laps || 0); });
    var classes = Object.keys(lapsBy).sort(function (a, b) { return lapsBy[b] - lapsBy[a]; });
    profCls = cls && lapsBy[cls] ? cls : classes[0] || '';
    var list = byTrack(rows, profCls), trackCount = {}; rows.forEach(function (p) { trackCount[trackName(p.track)] = 1; });
    var h = '<div class="prof-head"><span class="av">' + initialOf(m.name) + '</span><div><h3>' + esc(m.name) + (m.me ? '<em class="you">you</em>' : '') + '</h3><div class="faint">' + esc(roleWords(m.roles)) + (m.joined ? ' · in the team since ' + esc(day(m.joined)) : '') + '</div></div></div>';
    h += '<div class="tiles">' + tile('Tracks', Object.keys(trackCount).length, classes.length + (classes.length === 1 ? ' class' : ' classes')) +
      tile('Fastest in the team on', top.length, top.length ? esc(top.slice(0, 3).join(', ')) : '--') +
      tile('Steadiest car', steady ? esc(steady.car) : '--', steady ? '± ' + steady.sd.toFixed(3) + ' s at ' + esc(trackName(steady.track)) : '') +
      tile('Team races', races.length, races.length ? 'last ' + esc(agoText(races[0].result.date)) : '') + '</div>';
    h += '<div class="tgrid"><div><h2 style="margin-top:6px">Race pace</h2>' +
      (classes.length > 1 ? '<span class="seg" style="margin:8px 0 4px">' + classes.map(function (c) { return '<button type="button" data-pcls="' + esc(c) + '"' + (c === profCls ? ' class="on"' : '') + '>' + esc(clsLabel(c)) + '</button>'; }).join('') + '</span>' : '') +
      (list.length ? '<div class="plist">' + list.slice(0, 16).map(function (d) {
        return '<div class="prow"><span><b>' + esc(d.track) + '</b><small>' + esc(d.paceCar || d.bestCar) + (d.cars > 1 ? ' · ' + d.cars + ' cars' : '') + ' · ' + esc(agoText(d.last)) + '</small></span>' +
          '<span class="num">' + lap(d.pace) + '<small style="color:var(--purple)">' + lap(d.best) + (d.cars > 1 && d.bestCar && d.bestCar !== d.paceCar ? ' · ' + esc(d.bestCar) : '') + '</small></span></div>';
      }).join('') + '</div>' : '<div class="faint">No race pace shared with the team yet.</div>') + '</div>' +
      '<div><h2 style="margin-top:6px">Team races</h2>' + (races.length ? '<div class="news">' + races.slice(0, 8).map(function (x) { var r = x.result; return '<div data-race="' + x.id + '"><i>' + (r.classPos ? 'P' + r.classPos : 'R') + '</i><span><span><b>' + esc(trackName(r.track)) + '</b> · ' + esc(r.cls || '') + '</span><small>' + esc(day(r.date)) + '</small></span></div>'; }).join('') + '</div>' : '<div class="faint">No team races with ' + esc(m.name.split(' ')[0]) + ' yet.</div>') + '</div></div>';
    $('profBox').innerHTML = h; setTab('profile'); if (!cls) window.scrollTo(0, 0);
    $('profBox').onclick = function (e) { var b = e.target.closest('[data-pcls]'); if (b) openProfile(id, b.getAttribute('data-pcls')); };
  }
  // a click on a driver (team pace, news, cards) opens their profile; on a race (news, profile) its review
  document.addEventListener('click', function (e) {
    var p = e.target.closest('[data-prof]'); if (p) { openProfile(+p.getAttribute('data-prof')); return; }
    var r = e.target.closest('#newsBox [data-race], #profBox [data-race]'); if (r) { setTab('overview'); openRace(+r.getAttribute('data-race')); }
  });
  $('profBack').onclick = function () { setTab('members'); };
  function renderResults() {
    if (!results.length) { $('results').innerHTML = '<div class="faint">No races yet: send one from "New races for your teams".</div>'; return; }
    $('results').innerHTML = results.map(function (x) {
      var r = x.result, len = r.lengthKind === 'time' ? F.hm(r.length) : r.length + ' laps';
      var drv = (r.drivers || []).map(function (d) { return '<div class="drv">' + esc(d.name) + ' <span>' + d.laps + ' laps' + (d.avg ? ' · avg ' + F.lap(d.avg) : '') + (d.best ? ' · best ' + F.lap(d.best) : '') + '</span></div>'; }).join('');
      return '<div class="rcard open" data-race="' + x.id + '" title="Open the review"><span class="pos">' + (r.classPos ? 'P' + r.classPos : '--') + '</span><div class="t">' + esc(trackName(r.track)) + '</div>' +
        '<div class="d">' + day(r.date) + ' · ' + esc(len) + ' · ' + esc(r.cls || '') + (r.classCars ? ' (' + r.classCars + ' cars)' : '') + '</div>' +
        '<div class="d">' + esc([r.car, r.teamName || r.entry].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="d">' + r.laps + ' laps' + (r.best ? ' · best ' + F.lap(r.best) : '') + (r.finish ? ' · ' + esc(r.finish) : '') + '</div>' + drv +
        (isOwner() ? '<div style="margin-top:8px;text-align:right"><button class="btn sm" data-delres="' + x.id + '">Remove</button></div>' : '') + '</div>';
    }).join('');
  }
  $('results').onclick = function (e) {
    var b = e.target.closest('[data-delres]');
    if (!b) { var c = e.target.closest('[data-race]'); if (c) openRace(+c.getAttribute('data-race')); return; }
    if (!confirm('Remove this race from the team results?')) return;
    api('deleteResult', { team: team.id, id: +b.getAttribute('data-delres') }).then(function () { loadTeam(); loadSuggest(); }, function (er) { info(er.message, true); });
  };

  // ---------- one race: its review (owner 2026-11-16: "like the review in Strategy"), from the laps sent with it (review-math.js) ----------
  var RM = P.reviewMath, rvOpen = {}, rv = null, rvRace = null;
  function openRace(id) {
    $('rvTitle').textContent = 'Loading...'; show('resCard', false); show('rvArea', true); show('rvBody', false); $('rvTiles').innerHTML = ''; $('rvSub').textContent = ''; show('rvNoLaps', false);
    window.scrollTo(0, $('rvArea').offsetTop - 20);
    api('result', { team: team.id, id: id }).then(function (x) {
      var r = x.result || {}, names = (r.drivers || []).map(function (d) { return d.name; });
      // the laps as the Review tab reads them: [n, time, pit, tyre %, driver, VE used, VE left, wheels, race clock]
      var laps = (x.lapRows || []).map(function (l) {
        var v = function (k) { return l[k] >= 0 ? l[k] : null; };
        return [l[0], v(1), l[2] ? 1 : 0, v(6), l[3] >= 0 ? names[l[3]] || '' : '', v(4), v(5), l.length >= 12 ? [l[8], l[9], l[10], l[11]] : null, v(7)];
      });
      rvRace = { track: r.track, time: r.date, laps: laps, car: { team: r.teamName, vehicle: r.entry, carType: r.car, cls: r.cls, pos: r.pos, classPos: r.classPos, finishTime: r.finishTime || 0, best: r.best, finish: r.finish } };
      rvOpen = {}; lastRaceSummary = r; renderRace(r);
    }, function (e) { $('rvTitle').textContent = 'Not found'; info(e.message, true); });
  }
  function renderRace(r) {
    var len = r.lengthKind === 'time' ? F.hm(r.length) : r.length + ' laps';
    $('rvTitle').textContent = trackName(r.track) + (r.classPos ? '  ·  P' + r.classPos : '');
    $('rvSub').textContent = [day(r.date), len + ' race', r.cls + (r.classCars ? ' (' + r.classCars + ' cars)' : ''), r.car, r.teamName || r.entry, r.finish].filter(Boolean).join(' · ');
    rv = rvRace.laps.length ? RM.review(rvRace, { length: r.lengthKind === 'time' && r.length > 0 ? { kind: 'time', time: r.length } : null }) : null;
    if (!rv) {
      // sent without its laps (an older app): the summary only
      $('rvTiles').innerHTML = tile('Result', r.classPos ? 'P' + r.classPos : '--', r.pos ? 'class · P' + r.pos + ' overall' : '') + tile('Laps', r.laps, '') + tile('Best lap', r.best ? F.lap(r.best) : '--', '') +
        (r.drivers || []).map(function (d) { return tile(d.name, d.avg ? F.lap(d.avg) : '--', d.laps + ' laps · best ' + (d.best ? F.lap(d.best) : '--')); }).join('');
      $('rvNoLaps').textContent = 'This race was sent without its laps (an older app version), so there is no full review. Whoever drove it can send it again from "New races for your teams" (show all): the laps are then added.';
      show('rvNoLaps', true); show('rvBody', false); return;
    }
    show('rvBody', true);
    var c = rv.car || {}, stops = rv.stints.filter(function (s) { return s.pitted; }).length;
    $('rvTiles').innerHTML = tile('Result', c.classPos ? 'P' + c.classPos : '--', c.pos ? 'class · P' + c.pos + ' overall' : '') + tile('Laps', rv.laps, rv.length && rv.length.kind !== 'laps' ? F.hm(rv.length.time) + ' race' : '') +
      tile('Stops', stops, rv.pitLoss ? Math.round(rv.pitLoss) + ' s each (median)' : '') + tile('Finish', rv.finish > 0 ? F.clock(rv.finish) : '--', 'race time') +
      '<div class="tile"><div class="k">Best lap</div><div class="v purple">' + (c.best > 0 ? F.lap(c.best) : '--') + '</div><div class="n"></div></div>' +
      rv.drivers.map(function (d) { return tile(d.name || '?', d.avg ? F.lap(d.avg) : '--', d.stints + ' stints · best ' + (d.best ? F.lap(d.best) : '--')); }).join('');
    $('rvFindings').innerHTML = rv.findings.map(function (f) { return '<div class="finding ' + f.kind + '"><b>' + esc(f.title) + '</b><span class="muted">' + esc(f.text) + '</span></div>'; }).join('') || '<div class="faint">Nothing to point out.</div>';
    $('rvStints').innerHTML = '<thead><tr><th class="num">#</th><th>Driver</th><th class="num">Laps</th><th class="num">Average</th><th class="num">Fastest</th><th class="num">VE / lap</th><th class="num">VE left</th><th>Stop after</th></tr></thead><tbody>' +
      rv.stints.map(function (s, i) {
        var nx = rv.stints[i + 1];
        var stop = s.pitted ? (s.stopLoss > 0 ? Math.round(s.stopLoss) + ' s' : 'stop') + (nx ? (nx.tyres ? ' · ' + RM.tyreWord(nx.tyres) + (nx.tyresLikely ? ' (likely)' : '') : nx.tyres === '' ? ' · no tyres' : '') + (nx.driver && nx.driver !== s.driver ? ' · swap to ' + esc(nx.driver) : '') : '') : '<span class="faint">finish</span>';
        return '<tr class="click" data-st="' + i + '"><td class="num">' + s.n + '</td><td>' + esc(s.driver || '?') + '</td><td class="num">' + s.laps + '<span class="two">' + s.from + '-' + s.to + '</span></td>' +
          '<td class="num">' + (s.avg ? F.lap(s.avg) : '--') + '<span class="two">' + s.clean + ' clean</span></td><td class="num purple">' + (s.best ? F.lap(s.best) : '--') + '</td>' +
          '<td class="num">' + (s.ve ? F.pct(s.ve, 2) : '--') + '</td><td class="num">' + (s.veLeft >= 0 ? F.pct(s.veLeft, 1) : '--') + '</td><td>' + stop + '</td></tr>' + (rvOpen[i] ? lapsRow(s) : '');
      }).join('') + '</tbody>';
    $('rvDrivers').innerHTML = '<thead><tr><th>Driver</th><th class="num">Stints</th><th class="num">Laps</th><th class="num">Average lap</th><th class="num">Fastest</th><th class="num">VE per lap</th></tr></thead><tbody>' +
      rv.drivers.map(function (d) { return '<tr><td>' + esc(d.name || '?') + '</td><td class="num">' + d.stints + '</td><td class="num">' + d.laps + '</td><td class="num">' + (d.avg ? F.lap(d.avg) : '--') + '</td><td class="num purple">' + (d.best ? F.lap(d.best) : '--') + '</td><td class="num">' + (d.vePerLap ? F.pct(d.vePerLap, 2) : '--') + '</td></tr>'; }).join('') + '</tbody>';
    var w = rv.whatIf; show('rvWhatCard', !!(w && w.options.length));
    if (w && w.options.length) {
      $('rvWhatSub').textContent = 'The race again with its own numbers: ' + F.lap(w.pace) + ' a lap, ' + F.pct(w.rate, 2) + ' VE a lap without lifting (the most a stint used), ' + Math.round(rv.pitLoss) + ' s a stop. ' +
        (w.costKnown ? 'Lifting costs ' + (rv.cost.cost * 0.1).toFixed(2) + ' s a lap per 0.1 % (from this race), so a stint length that needs lifting has slower laps.' : 'What lifting costs is not known from this race: lap times stay the same.');
      $('rvWhat').innerHTML = '<thead><tr><th class="num">Laps a stint</th><th class="num">VE per lap</th><th class="num">Lifting</th><th class="num">Lap time</th><th class="num">Stops</th><th class="num">Laps</th><th class="num">Finish</th><th></th></tr></thead><tbody>' +
        w.options.map(function (o) {
          return '<tr' + (o === w.best ? ' class="ls-now"' : '') + '><td class="num">' + o.laps + '</td><td class="num">' + F.pct(o.perLap, 2) + '</td><td class="num">' + (o.save > 0 ? F.pct(o.save, 2) : '<span class="faint">none</span>') + '</td>' +
            '<td class="num">' + F.lap(o.lap) + '</td><td class="num">' + o.stops + '</td><td class="num">' + o.raceLaps + '</td><td class="num">' + F.clock(o.end) + '</td><td>' +
            (o.laps === w.did ? '<span class="chip lime">THE TEAM DID</span> ' : '') + (o === w.best ? '<span class="chip ok">BEST</span>' : '') + '</td></tr>';
        }).join('') + '</tbody>';
    }
  }
  // the laps of one stint (under its row)
  function lapsRow(s) {
    var rows = s.lapList.map(function (l) {
      var d = l.t && s.avg ? l.t - s.avg : null, note = l.pit ? 'in lap' : (s.n > 1 && l === s.lapList[0]) ? 'out lap' : l.n === 1 ? 'start' : l.t && s.avg && l.t > s.avg * 1.07 ? 'slow' : !l.t ? 'not timed' : '';
      var tw = l.wheels ? Math.round((l.wheels[0] + l.wheels[1] + l.wheels[2] + l.wheels[3]) / 4 * 100) + '%' : '';
      return '<tr><td class="num">' + l.n + '</td><td class="num"' + (l.t && l.t === s.best ? ' style="color:var(--purple);font-weight:700"' : '') + '>' + (l.t ? F.lap(l.t) : '--') + '</td>' +
        '<td class="num"' + (d !== null && !note ? ' style="color:var(' + (d <= 0 ? '--green' : '--red') + ')"' : '') + '>' + (d !== null && !note ? (d > 0 ? '+' : '−') + Math.abs(d).toFixed(3) : '') + '</td>' +
        '<td class="num">' + (l.veUsed ? F.pct(l.veUsed, 2) : '--') + '</td><td class="num">' + (l.veLeft >= 0 && l.veLeft !== null ? F.pct(l.veLeft, 1) : '--') + '</td><td class="num">' + tw + '</td><td class="faint">' + note + '</td></tr>';
    }).join('');
    return '<tr class="laps"><td colspan="8"><table class="tbl"><thead><tr><th class="num">Lap</th><th class="num">Time</th><th class="num">vs average</th><th class="num">VE used</th><th class="num">VE left</th><th class="num">Tyres left</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></td></tr>';
  }
  $('rvStints').onclick = function (e) { var tr = e.target.closest('tr[data-st]'); if (!tr || !rv) return; var i = +tr.getAttribute('data-st'); rvOpen[i] = !rvOpen[i]; renderRace(lastRaceSummary); };
  var lastRaceSummary = null;
  $('rvBack').onclick = function () { show('rvArea', false); show('resCard', true); };

  // ---------- race pace (like the Race Pace page: class buttons, car buttons, the tracks, a page per track) ----------
  var CLASSES = [['LMH', 'Hypercar'], ['LMP2wec', 'LMP2'], ['LMP2elms', 'LMP2 ELMS'], ['LMP3', 'LMP3'], ['LMGT3', 'GT3'], ['GTE', 'GTE']], pCar = '', pFind = '';
  function clsOf(p) { return (R && R.className(p.cls)) || p.cls || '?'; }
  function clsLabel(c) { var x = CLASSES.filter(function (k) { return k[0] === c; })[0]; return x ? x[1] : c; }
  function segHtml(items, on) { return items.map(function (it) { return '<button data-v="' + esc(it[0]) + '"' + (it[0] === on ? ' class="on"' : '') + '>' + esc(it[1]) + '</button>'; }).join(''); }
  function renderPace() {
    // classes the team drove, the one with the most rows first chosen
    var count = {}; pace.forEach(function (p) { var c = clsOf(p); count[c] = (count[c] || 0) + 1; });
    var classes = CLASSES.map(function (c) { return c[0]; }).filter(function (c) { return count[c]; }).concat(Object.keys(count).filter(function (c) { return !CLASSES.some(function (k) { return k[0] === c; }); }));
    if (!cls || !count[cls]) cls = classes.slice().sort(function (a, b) { return count[b] - count[a]; })[0] || '';
    $('segPCls').innerHTML = segHtml(classes.map(function (c) { return [c, clsLabel(c)]; }), cls);
    var inCls = pace.filter(function (p) { return clsOf(p) === cls; }), cars = {}; inCls.forEach(function (p) { cars[p.car] = 1; });
    if (pCar && !cars[pCar]) pCar = '';
    $('segPCar').innerHTML = segHtml([['', 'All cars']].concat(Object.keys(cars).sort().map(function (c) { return [c, c]; })), pCar);
    var rows = inCls.filter(function (p) { return !pCar || p.car === pCar; }), by = {};
    rows.forEach(function (p) { var k = trackName(p.track); if (!by[k]) by[k] = { name: k, raw: {}, rows: [], last: 0 }; by[k].raw[p.track] = 1; by[k].rows.push(p); by[k].last = Math.max(by[k].last, p.last); });
    var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.last - a.last; });
    if (!pace.length) { $('trkTbl').innerHTML = '<tbody><tr><td class="faint">No race pace shared yet. Each member shares theirs by opening the Team tab (Settings: on by default).</td></tr></tbody>'; show('pTrack', false); show('pList', true); return; }
    if (paceTrack && by[paceTrack]) { showTrack(by[paceTrack]); return; }
    paceTrack = null; show('pTrack', false); show('pList', true);
    var f = pFind.toLowerCase(), shown = list.filter(function (g) { return !f || g.name.toLowerCase().indexOf(f) >= 0 || Object.keys(g.raw).join(' ').toLowerCase().indexOf(f) >= 0; });
    // per track (owner 2026-11-16): best pace, the team's average pace (each driver's average over their cars), best quali lap, your pace
    $('trkTbl').innerHTML = '<thead><tr><th>Track</th><th class="num">Drivers</th><th class="num">Best pace</th><th class="num">Average team pace</th><th class="num">Best quali</th><th class="num">Your pace</th><th class="num">Last driven</th></tr></thead><tbody>' + shown.map(function (g) {
      var ds = perDriver(g.rows), wp = ds.filter(function (d) { return d.pace > 0; }), topP = wp.slice().sort(function (a, b) { return a.pace - b.pace; })[0];
      var avg = wp.length ? wp.reduce(function (t, d) { return t + d.pace; }, 0) / wp.length : 0, topL = ds.filter(function (d) { return d.best > 0; }).sort(function (a, b) { return a.best - b.best; })[0];
      var mine = wp.filter(function (d) { return d.me; })[0];
      return '<tr class="click" data-trk="' + esc(g.name) + '"><td><b>' + esc(g.name) + '</b><span class="two">' + esc(Object.keys(g.raw).join(', ')) + '</span></td><td class="num">' + ds.length + '</td>' +
        '<td class="num">' + (topP ? lap(topP.pace) + '<span class="two">' + esc(topP.name) + '</span>' : '--') + '</td>' +
        '<td class="num">' + (avg ? lap(avg) + '<span class="two">' + wp.length + (wp.length === 1 ? ' driver' : ' drivers') + '</span>' : '--') + '</td>' +
        '<td class="num purple">' + (topL ? lap(topL.best) + '<span class="two">' + esc(topL.name) + '</span>' : '--') + '</td>' +
        '<td class="num">' + (mine ? lap(mine.pace) + '<span class="two">' + (topP && mine.user !== topP.user ? '+' + (mine.pace - topP.pace).toFixed(3) + ' to the best' : 'the best') + '</span>' : '--') + '</td><td class="num">' + day(g.last) + '</td></tr>';
    }).join('') + '</tbody>';
  }
  // one row per driver (owner 2026-11-16): race pace = the average over their cars (weighted by clean laps), best lap = their best in any car, clean laps
  // added up; plus which car had the best race pace, the fastest lap and the most consistent laps (smallest spread of the clean laps)
  function perDriver(rows) {
    var by = {};
    rows.forEach(function (p) { (by[p.user] = by[p.user] || []).push(p); });
    return Object.keys(by).map(function (u) {
      var rs = by[u], wp = rs.filter(function (p) { return p.pace > 0 && p.clean > 0; }), n = wp.reduce(function (t, p) { return t + p.clean; }, 0);
      var bl = rs.filter(function (p) { return p.best > 0; }).sort(function (a, b) { return a.best - b.best; })[0], bp = wp.slice().sort(function (a, b) { return a.pace - b.pace; })[0];
      var cs = wp.filter(function (p) { return p.sd > 0 && p.clean >= 5; }).sort(function (a, b) { return a.sd - b.sd; })[0];
      var opt = rs.filter(function (p) { return p.optimal > 0; }).sort(function (a, b) { return a.optimal - b.optimal; })[0];
      return { user: +u, name: rs[0].name, me: rs[0].me, cars: rs.length, pace: n ? wp.reduce(function (t, p) { return t + p.pace * p.clean; }, 0) / n : 0,
        best: bl ? bl.best : 0, bestCar: bl ? bl.car : '', paceCar: bp ? bp.car : '', pacePace: bp ? bp.pace : 0, consCar: cs ? cs.car : '', consSd: cs ? cs.sd : 0,
        optimal: opt ? opt.optimal : 0, clean: rs.reduce(function (t, p) { return t + (p.clean || 0); }, 0), laps: rs.reduce(function (t, p) { return t + (p.laps || 0); }, 0),
        last: Math.max.apply(null, rs.map(function (p) { return p.last; })) };
    });
  }
  function showTrack(g) {
    show('pList', false); show('pTrack', true);
    var ds = perDriver(g.rows).sort(function (a, b) { return (a.pace > 0 ? a.pace : 1e9) - (b.pace > 0 ? b.pace : 1e9) || (a.best || 1e9) - (b.best || 1e9); });
    var wp = ds.filter(function (d) { return d.pace > 0; }), top = wp[0], avg = wp.length ? wp.reduce(function (t, d) { return t + d.pace; }, 0) / wp.length : 0;
    var topL = ds.filter(function (d) { return d.best > 0; }).sort(function (a, b) { return a.best - b.best; })[0], mine = wp.filter(function (d) { return d.me; })[0];
    $('trkName').textContent = g.name; $('trkSub').textContent = clsLabel(cls) + (pCar ? ' · ' + pCar : ' · all cars') + ' · ' + Object.keys(g.raw).join(', ');
    $('trkTiles').innerHTML = tile('Best pace', top ? lap(top.pace) : '--', top ? esc(top.name) : '') + tile('Average team pace', avg ? lap(avg) : '--', wp.length + (wp.length === 1 ? ' driver' : ' drivers')) +
      '<div class="tile"><div class="k">Best quali</div><div class="v purple">' + (topL ? lap(topL.best) : '--') + '</div><div class="n">' + (topL ? esc(topL.name + ' · ' + topL.bestCar) : '') + '</div></div>' +
      tile('Your pace', mine ? lap(mine.pace) : '--', mine && top ? (mine === top ? 'the best' : '+' + (mine.pace - top.pace).toFixed(3) + ' to the best · ' + (mine.pace - avg >= 0 ? '+' : '−') + Math.abs(mine.pace - avg).toFixed(3) + ' to the average') : 'not driven here');
    var many = !pCar && ds.some(function (d) { return d.cars > 1; });
    $('paceTbl').innerHTML = '<thead><tr><th>Driver</th><th class="num">Race pace</th><th class="num">Gap</th><th class="num">Best lap</th><th class="num">Optimal</th><th class="num">Clean laps</th>' +
      (many ? '<th>Best race pace</th><th>Fastest lap</th><th>Most consistent</th>' : '<th>Car</th><th class="num">Consistency</th>') + '<th class="num">Last driven</th></tr></thead><tbody>' + ds.map(function (d) {
      var carCells = many
        ? '<td>' + esc(d.paceCar || '--') + (d.cars > 1 && d.pacePace ? '<span class="two">' + lap(d.pacePace) + '</span>' : '') + '</td><td>' + esc(d.bestCar || '--') + '</td><td>' + esc(d.consCar || '--') + (d.consSd ? '<span class="two">± ' + d.consSd.toFixed(3) + ' s</span>' : '') + '</td>'
        : '<td>' + esc(d.paceCar || d.bestCar) + '</td><td class="num">' + (d.consSd ? '± ' + d.consSd.toFixed(3) : '--') + '</td>';
      return '<tr' + (d.me ? ' class="sel"' : '') + '><td>' + esc(d.name) + (d.me ? ' <span class="faint">(you)</span>' : '') + (many && d.cars > 1 ? '<span class="two">' + d.cars + ' cars, average</span>' : '') + '</td>' +
        '<td class="num">' + lap(d.pace) + '</td><td class="num">' + (top && d.pace > 0 ? (d === top ? '<span class="faint">best</span>' : '+' + (d.pace - top.pace).toFixed(3)) : '--') + '</td>' +
        '<td class="num purple">' + lap(d.best) + '</td><td class="num">' + lap(d.optimal) + '</td><td class="num">' + d.clean + '<span class="two">of ' + d.laps + '</span></td>' + carCells + '<td class="num">' + day(d.last) + '</td></tr>';
    }).join('') + '</tbody>';
    $('paceNote').textContent = 'Race pace = the average of clean laps in race sessions (no pit, out or incident laps, nothing over 5 % slower than that session\'s median), shown from 3 clean laps; with several cars, the average over them (by clean laps). ' +
      'Consistency = how much the clean laps spread (smaller = steadier). Best quali = the fastest lap in any session.';
  }
  $('segPCls').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; cls = b.getAttribute('data-v'); pCar = ''; paceTrack = null; renderPace(); };
  $('segPCar').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; pCar = b.getAttribute('data-v'); renderPace(); };
  $('pFind').oninput = function () { pFind = this.value; renderPace(); };
  $('trkTbl').onclick = function (e) { var r = e.target.closest('[data-trk]'); if (r) { paceTrack = r.getAttribute('data-trk'); renderPace(); window.scrollTo(0, $('pTrack').offsetTop - 20); } };
  $('pBack').onclick = function () { paceTrack = null; renderPace(); };

  // my sheet: per track + car from my result files (the Race Pace numbers), sent to every team that has sharing on, when it changed
  function myRows() {
    if (!mySessions) return null;
    return PM.groups(mySessions).slice(0, 400).map(function (g) {
      var c = PM.combine(g.sessions, 0.05, ['Race']).dry;
      return { track: g.track, car: g.car, cls: g.cls || '', best: c.best || 0, optimal: c.optimal || 0, pace: c.clean >= 3 ? c.pace : 0, sd: c.clean >= 3 && c.sd > 0 ? c.sd : 0, clean: c.clean || 0, laps: c.laps || 0, last: g.last };
    }).filter(function (r) { return r.track && r.car && r.laps > 0 && r.last > 1400000000; });
  }
  function sharePace() {
    var rows = myRows(); if (!rows) return;
    var sig = JSON.stringify(rows);
    (sug.teams || []).forEach(function (t) {
      if (!t.share) return;
      var k = 'pw-team-pace-' + t.id, old = null; try { old = localStorage.getItem(k); } catch (e) {}
      var h = String(sig.length) + ':' + sig.slice(-200);
      if (old === h) return;
      api('sharePace', { team: t.id, rows: rows }).then(function () { try { localStorage.setItem(k, h); } catch (e) {} if (team && team.id === t.id) loadTeam(); }, function () {});
    });
  }

  // ---------- members ----------
  function renderMembers() {
    var own = isOwner();
    $('memTbl').innerHTML = '<thead><tr><th>Name</th><th>Role</th><th class="num">Tracks shared</th><th>Since</th><th></th></tr></thead><tbody>' + members.map(function (m) {
      var n = {}; pace.forEach(function (p) { if (p.user === m.id) n[p.track] = 1; });
      var roles = own ? '<span class="roles">' + ['driver', 'engineer', 'owner'].map(function (r) { return '<label><input type="checkbox" data-role="' + r + '" data-user="' + m.id + '"' + (m.roles.indexOf(r) >= 0 ? ' checked' : '') + '> ' + r.charAt(0).toUpperCase() + r.slice(1) + '</label>'; }).join('') + '</span>' : esc(roleWords(m.roles));
      return '<tr><td>' + esc(m.name) + (m.me ? ' <span class="faint">(you)</span>' : '') + '</td><td>' + roles + '</td><td class="num">' + Object.keys(n).length + '</td><td class="faint">' + day(m.joined) + '</td>' +
        '<td style="text-align:right;white-space:nowrap">' + (own ? '<button class="btn sm" data-rename="' + m.id + '">Rename</button> ' : '') + (own && !m.me ? '<button class="btn sm" data-remove="' + m.id + '">Remove</button>' : '') + '</td></tr>';
    }).join('') + '</tbody>';
  }
  $('memTbl').onclick = function (e) {
    var rn = e.target.closest('[data-rename]');
    if (rn) {                                                                                     // the owner: a member's name (best: first and last name, as in the game)
      var who = members.filter(function (x) { return x.id === +rn.getAttribute('data-rename'); })[0]; if (!who) return;
      var nn = prompt('Name of ' + who.name + ' in the team (first and last name, as in the game):', who.name); if (nn === null || !nn.trim() || nn.trim() === who.name) return;
      api('renameMember', { team: team.id, user: who.id, name: nn.trim() }).then(function () { info('Renamed to ' + nn.trim() + '.'); loadTeam(); }, function (er) { info(er.message, true); });
      return;
    }
    var b = e.target.closest('[data-remove]'); if (!b) return;
    var m = members.filter(function (x) { return x.id === +b.getAttribute('data-remove'); })[0];
    if (!m || !confirm('Remove ' + m.name + ' from ' + team.name + '? Their personal data in this team (race pace) is deleted; the races they drove with the team stay.')) return;
    api('remove', { team: team.id, user: m.id }).then(loadTeam, function (er) { info(er.message, true); });
  };
  $('memTbl').onchange = function (e) {
    var c = e.target; if (!c.hasAttribute('data-role')) return;
    var u = +c.getAttribute('data-user'), roles = [].slice.call(document.querySelectorAll('#memTbl input[data-user="' + u + '"]:checked')).map(function (x) { return x.getAttribute('data-role'); });
    if (!roles.length) { c.checked = true; info('A member keeps at least one role.', true); return; }
    api('roles', { team: team.id, user: u, roles: roles }).then(function () { info('Saved.'); load(); }, function (er) { info(er.message, true); loadTeam(); });
  };
  $('invBtn').onclick = function () {
    var roles = [].slice.call(document.querySelectorAll('#invRoles input:checked')).map(function (x) { return x.value; });
    if (!roles.length) { info('Pick at least one role.', true); return; }
    api('invite', { team: team.id, roles: roles, days: +$('invDays').value }).then(function (r) {
      $('invOut').innerHTML = '<div class="codebox">' + esc(r.code) + '</div><div class="faint">For ' + esc(team.name) + '. Works once, for ' + r.days + (r.days === 1 ? ' day' : ' days') +
        '. Send it with the server address: ' + esc(st.url.replace(/^https:\/\//, '')) + '</div><button class="btn" id="copyCode" style="margin-top:6px">Copy</button>';
      $('copyCode').onclick = function () { try { navigator.clipboard.writeText(r.code); this.textContent = 'Copied'; } catch (e) {} };
    }, function (e) { info(e.message, true); });
  };

  // ---------- settings ----------
  function renderSettings() {
    if (!team) return;
    show('renameTeamBtn', isOwner()); show('logoBox', isOwner()); paintLogo();
    var t = (sug.teams || []).filter(function (x) { return x.id === team.id; })[0];
    $('shareChk').checked = !t || t.share !== false;
  }
  $('shareChk').onchange = function () {
    var on = this.checked, id = team.id;
    // off: first take my sheet back from the team (an empty sheet), then switch sharing off
    (on ? Promise.resolve() : api('sharePace', { team: id, rows: [] }).catch(function () {})).then(function () { return api('settings', { team: id, share: on }); }).then(function () {
      try { localStorage.removeItem('pw-team-pace-' + id); } catch (e) {}
      loadSuggest(); loadTeam();
    });
  };
  $('renameTeamBtn').onclick = function () {
    if (!team) return; var nn = prompt('New name for the team "' + team.name + '":', team.name); if (nn === null || !nn.trim() || nn.trim() === team.name) return;
    api('renameTeam', { team: team.id, name: nn.trim() }).then(function () { info('The team is now called ' + nn.trim() + '.'); load(); }, function (er) { info(er.message, true); });
  };
  $('leaveBtn').onclick = function () {
    if (!team || !confirm('Leave "' + team.name + '"? Your personal data in this team (race pace) is deleted; the races you drove with the team stay in its results.')) return;
    var me = members.filter(function (m) { return m.me; })[0]; if (!me) return;
    api('remove', { team: team.id, user: me.id }).then(function () { team = null; load(); }, function (e) { info(e.message, true); });
  };

  // ---------- team-mates racing now (live sessions: their app's own numbers, every 2 s) ----------
  var lives = [], liveOpen = null, liveTimer = null;
  function liveLoad() {
    if (!st || !st.member) return;
    api('live').then(function (l) { lives = (l || []).filter(function (x) { return !x.me; }); liveBar(); if (liveOpen) liveView(); }, function () {});
  }
  function sesName(n) { return F.sessionName ? F.sessionName(n) : n >= 10 ? 'Race' : 'Session'; }
  function liveBar() {
    $('liveBar').innerHTML = lives.map(function (x) {
      return '<div class="liveb" data-live="' + x.user + '"><i class="dot"></i><span><b>' + esc(x.name) + '</b> is in a ' + esc(sesName(x.session).toLowerCase()) + ' at ' + esc(trackName(x.track)) +
        (x.top && x.top.classPos ? ' · P' + x.top.classPos : '') + '</span><em>View</em></div>';
    }).join('');
    if (liveOpen && !lives.some(function (x) { return x.user === liveOpen; })) { $('lvAge').textContent = 'not live any more'; }
  }
  $('liveBar').onclick = function (e) { var b = e.target.closest('[data-live]'); if (!b) return; liveOpen = +b.getAttribute('data-live'); lvOpenStint = {}; show('liveView', true); liveView(); clearInterval(liveTimer); liveTimer = setInterval(liveLoad, 3000); };
  $('lvClose').onclick = function () { liveOpen = null; show('liveView', false); clearInterval(liveTimer); liveTimer = setInterval(liveLoad, 10000); };
  // the live view: a strip with the essentials; "Car" = the car from above (tyres coloured by temperature like the dashboard, wear, pressure, compound) and
  // its damage; "Laps" = the stints of this session (review-math, like a team race) with their laps
  var lvCar = false, lvLapsOpen = false, lvOpenStint = {};
  $('lvCarBtn').onclick = function () { lvCar = !lvCar; liveView(); };
  $('lvLapsBtn').onclick = function () { lvLapsOpen = !lvLapsOpen; liveView(); };
  function bar(frac, color) { return '<div class="lv-bar"><i style="width:' + Math.max(0, Math.min(100, frac * 100)).toFixed(0) + '%;background:' + color + '"></i></div>'; }
  function liveView() {
    var x = lives.filter(function (l) { return l.user === liveOpen; })[0]; if (!x) return;
    var c = x.car || {}, t = x.top || {}, ve = c.ve || {}, fu = c.fuel || {};
    $('lvName').textContent = c.driver || x.name;
    $('lvSub').textContent = [trackName(x.track), sesName(x.session), c.model || x.entry, c.inPits ? 'in the pits' : ''].filter(Boolean).join(' · ');
    $('lvPos').textContent = t.classPos ? 'P' + t.classPos : '--'; $('lvPos2').textContent = t.overall ? 'P' + t.overall + ' overall' : '';
    $('lvAge').textContent = 'updated ' + Math.max(0, Math.round((Date.now() - x.at) / 1000)) + ' s ago';
    var lastC = F.lastColor ? F.lastColor(t.lastFlag, { classBest: 'var(--purple)', ownBest: 'var(--green)', normal: 'var(--text)' }) : 'var(--text)';
    var veC = F.veColor ? F.veColor(ve.now, { none: 'var(--faint)', low: 'var(--red)', mid: 'var(--yellow)', ok: 'var(--lime)' }) : 'var(--lime)';
    var cell = function (k, v, n, style) { return '<div class="lv-cell"><div class="k">' + k + '</div><div class="v"' + (style ? ' style="' + style + '"' : '') + '>' + v + '</div><div class="n">' + (n || '') + '</div></div>'; };
    $('lvStrip').innerHTML = cell('Lap', t.lap || '--', t.timeLeft >= 0 ? F.clock(t.timeLeft) + ' left' : t.lapsLeft >= 0 ? Math.ceil(t.lapsLeft) + ' laps left' : '') +
      cell('Last lap', lap(t.last), t.lastDiff !== null && t.lastDiff !== undefined && t.last > 0 ? (t.lastDiff > 0 ? '+' : '') + t.lastDiff.toFixed(3) + ' to best' : '', 'color:' + lastC) +
      cell('Best', lap(t.best), '', 'color:var(--purple)') +
      cell('Stint', c.stintLaps >= 0 ? c.stintLaps + (c.stintLaps === 1 ? ' lap' : ' laps') : '--', '') +
      '<div class="lv-cell"><div class="k">Virtual energy</div><div class="v" style="color:' + veC + '">' + (ve.now >= 0 ? F.pct(ve.now, 1) : '--') + '</div>' + bar((ve.now || 0) / 100, veC) +
        '<div class="n">' + (ve.avg > 0 ? F.pct(ve.avg, 2) + ' a lap' : '') + (ve.laps > 0 ? ' · ' + ve.laps.toFixed(1) + ' laps' : '') + '</div></div>' +
      (fu.now > 0 ? cell('Fuel', fu.now.toFixed(1) + ' L', fu.avg > 0 ? fu.avg.toFixed(2) + ' L a lap' : '') : '');
    $('lvCarBtn').classList.toggle('on', lvCar); $('lvLapsBtn').classList.toggle('on', lvLapsOpen);
    show('lvCar', lvCar); if (lvCar) { $('lvCar').innerHTML = carHtml(c); P.liveCar.paint($('lvCar')); }
    show('lvLapsBox', lvLapsOpen); if (lvLapsOpen) lapsHtml(x);
  }
  // the car: live-car.js (the same drawing as the website's live page)
  function carHtml(c) { return P.liveCar.html(c); }
  // this session's stints (a pit lap ends one) with their laps, the review's maths
  function lapsHtml(x) {
    var laps = (x.laps || []).map(function (l) { return [l[0], l[1] > 0 ? l[1] : null, l[2] ? 1 : 0, null, (x.car && x.car.driver) || x.name, l[3] > 0 ? l[3] : null, l[4] >= 0 ? l[4] : null, null, -1]; });
    if (!laps.length) { $('lvLaps').innerHTML = '<tbody><tr><td class="faint">No laps yet in this session.</td></tr></tbody>'; return; }
    var st = RM.stints({ laps: laps });
    $('lvLaps').innerHTML = '<thead><tr><th class="num">#</th><th class="num">Laps</th><th class="num">Average</th><th class="num">Fastest</th><th class="num">VE / lap</th><th class="num">VE left</th><th></th></tr></thead><tbody>' +
      st.map(function (s, i) {
        return '<tr class="click" data-lst="' + i + '"><td class="num">' + s.n + '</td><td class="num">' + s.laps + '<span class="two">' + s.from + '-' + s.to + '</span></td><td class="num">' + lap(s.avg) + '<span class="two">' + s.clean + ' clean</span></td>' +
          '<td class="num" style="color:var(--purple)">' + lap(s.best) + '</td><td class="num">' + (s.ve ? F.pct(s.ve, 2) : '--') + '</td><td class="num">' + (s.veLeft >= 0 && s.veLeft !== null ? F.pct(s.veLeft, 1) : '--') + '</td>' +
          '<td class="faint">' + (i === st.length - 1 && !s.pitted ? 'now' : s.pitted ? 'stop' : '') + '</td></tr>' + (lvOpenStint[i] ? lapsRow(s).replace('colspan="8"', 'colspan="7"') : '');
      }).join('') + '</tbody>';
  }
  $('lvLaps').onclick = function (e) { var tr = e.target.closest('tr[data-lst]'); if (!tr) return; var i = +tr.getAttribute('data-lst'); lvOpenStint[i] = !lvOpenStint[i]; liveView(); };
  liveTimer = setInterval(liveLoad, 10000);

  // my sessions (for the race pace I share)
  if (H.inApp) H.loadPace(function () {}, function (data) { mySessions = (data.sessions || []).filter(function (s) { return !s.live; }); sharePace(); });
  load();
})(typeof window !== 'undefined' ? window : globalThis);
