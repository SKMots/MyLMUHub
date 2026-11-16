// Hub page "Team" (owner 2026-11-16): the team server. Connect, set it up (server owner) or join with an invite code; then the team: its race results
// (a little showcase), sending your races, the members and their roles, invite codes. Every action goes through the app (api/team?op=..., TeamClient.cs):
// the member key stays in the app and never comes to this page. Text from the server is always shown as text (esc), never as HTML.
(function (root) {
  'use strict';
  var P = root.MyLMUHub, H = P.hub, F = P.format, esc = H.esc;
  var $ = function (id) { return document.getElementById(id); };
  H.header('team');
  var st = null, team = null, members = [], results = [], races = [], sent = {};

  function api(op, body) {
    return fetch('api/team?op=' + encodeURIComponent(op), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MLH': '1' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error((j && j.error) || ('error ' + r.status)); e.status = r.status; throw e; } return j; }); });
  }
  function info(t, bad) { $('info').textContent = t || ''; $('info').style.color = bad ? 'var(--red)' : ''; }
  function tile(k, v, n) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div><div class="n">' + (n || '') + '</div></div>'; }
  function day(t) { var d = new Date(t * 1000); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  function roleWords(r) { return (r || []).map(function (x) { return x === 'owner' ? 'Owner' : x === 'engineer' ? 'Engineer' : 'Driver'; }).join(' + '); }
  function myRoles() { return team ? team.roles || [] : []; }
  function isOwner() { return myRoles().indexOf('owner') >= 0; }

  function show(id, on) { $(id).hidden = !on; }
  function load() {
    if (!H.inApp) { info('Open this page in the app.'); return; }
    api('status').then(function (s) {
      st = s;
      var member = s.connected && s.member && s.me;
      show('connectCard', !s.connected); show('setupCard', s.connected && !s.member && s.setup); show('joinCard', s.connected && !s.member && !s.setup);
      show('memberArea', !!member); show('topBar', !!member);
      $('joinNameField').hidden = false;
      if (s.connected && !s.reachable) info('The server at ' + s.url + ' cannot be reached right now.', true);
      else info(s.connected ? 'Server: ' + s.url : '');
      if (!member) return;
      var teams = s.me.teams || [];
      if (!teams.length) { info('Server: ' + s.url + ' · you are in no team yet' + (s.me.admin ? ': make one below.' : '.')); }
      var keep = team && teams.filter(function (t) { return t.id === team.id; })[0];
      team = keep || teams[0] || null;
      $('teamSel').innerHTML = teams.map(function (t) { return '<option value="' + t.id + '"' + (team && t.id === team.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
      if (document.activeElement !== $('nameIn')) $('nameIn').value = s.me.name || '';
      show('adminBox', !!s.me.admin);
      loadTeam();
    }, function (e) { info(e.message, true); });
  }

  function loadTeam() {
    if (!team) { $('teamName').textContent = 'No team'; $('results').innerHTML = ''; $('memTbl').innerHTML = ''; show('inviteBox', false); return; }
    $('teamName').textContent = team.name; $('teamInfo').textContent = 'you: ' + roleWords(team.roles);
    show('inviteBox', isOwner()); show('leaveBtn', true);
    Promise.all([api('members', { team: team.id }), api('results', { team: team.id })]).then(function (a) {
      members = a[0] || []; results = a[1] || [];
      renderSummary(); renderResults(); renderMembers(); renderSend();
    }, function (e) { info(e.message, true); });
  }

  function renderSummary() {
    var rs = results.map(function (x) { return x.result; }), best = null, laps = 0;
    rs.forEach(function (r) { laps += r.laps || 0; if (r.classPos > 0 && (best === null || r.classPos < best.classPos)) best = r; });
    $('sumTiles').innerHTML = tile('Members', members.length, members.filter(function (m) { return m.roles.indexOf('driver') >= 0; }).length + ' drivers') +
      tile('Races', rs.length, rs.length ? 'last ' + day(rs[0].date) : '') + tile('Laps raced', laps, '') +
      tile('Best finish', best ? 'P' + best.classPos : '--', best ? esc(best.cls + ' · ' + best.track) : '');
  }

  function renderResults() {
    if (!results.length) { $('results').innerHTML = '<div class="faint">No races yet. Send one below.</div>'; return; }
    $('results').innerHTML = results.map(function (x) {
      var r = x.result, len = r.lengthKind === 'time' ? F.hm(r.length) : r.length + ' laps';
      var drv = (r.drivers || []).map(function (d) { return '<div class="drv">' + esc(d.name) + ' <span>' + d.laps + ' laps' + (d.avg ? ' · avg ' + F.lap(d.avg) : '') + (d.best ? ' · best ' + F.lap(d.best) : '') + '</span></div>'; }).join('');
      return '<div class="rcard"><span class="pos">' + (r.classPos ? 'P' + r.classPos : '--') + '</span><div class="t">' + esc(r.track) + '</div>' +
        '<div class="d">' + day(r.date) + ' · ' + esc(len) + ' · ' + esc(r.cls || '') + (r.classCars ? ' (' + r.classCars + ' cars)' : '') + '</div>' +
        '<div class="d">' + esc(r.car || '') + (r.entry ? ' · ' + esc(r.entry) : '') + '</div>' +
        '<div class="d">' + r.laps + ' laps' + (r.best ? ' · best ' + F.lap(r.best) : '') + (r.finish ? ' · ' + esc(r.finish) : '') + '</div>' + drv +
        (isOwner() ? '<div style="margin-top:8px;text-align:right"><button class="btn" style="padding:3px 10px;font-size:12px" data-delres="' + x.id + '">Remove</button></div>' : '') + '</div>';
    }).join('');
  }

  function renderMembers() {
    var own = isOwner();
    $('memTbl').innerHTML = '<thead><tr><th>Name</th><th>Role</th><th>Since</th><th></th></tr></thead><tbody>' + members.map(function (m) {
      var roles = own ? '<span class="roles">' + ['driver', 'engineer', 'owner'].map(function (r) { return '<label><input type="checkbox" data-role="' + r + '" data-user="' + m.id + '"' + (m.roles.indexOf(r) >= 0 ? ' checked' : '') + '> ' + r.charAt(0).toUpperCase() + r.slice(1) + '</label>'; }).join('') + '</span>' : esc(roleWords(m.roles));
      return '<tr><td>' + esc(m.name) + (m.me ? ' <span class="faint">(you)</span>' : '') + '</td><td>' + roles + '</td><td class="faint">' + day(m.joined) + '</td>' +
        '<td style="text-align:right">' + (own && !m.me ? '<button class="btn" style="padding:3px 10px;font-size:12px" data-remove="' + m.id + '">Remove</button>' : '') + '</td></tr>';
    }).join('') + '</tbody>';
  }

  function renderSend() {
    if (!races.length) { $('sendTbl').innerHTML = '<tbody><tr><td class="faint">' + (racesLoaded ? 'No races of yours in the results files.' : 'Reading your result files...') + '</td></tr></tbody>'; return; }
    $('sendTbl').innerHTML = '<thead><tr><th>When</th><th>Track</th><th>Car</th><th class="num">Laps</th><th class="num">Class</th><th></th></tr></thead><tbody>' + races.map(function (s) {
      var k = team ? team.id + '|' + s.file : '', state = sent[k];
      return '<tr><td>' + day(s.time) + '</td><td>' + esc(s.track || '') + '</td><td>' + esc(s.car || '') + '</td><td class="num">' + s.last + '</td><td class="num">' + (s.classPos ? 'P' + s.classPos : '--') + '</td>' +
        '<td style="text-align:right">' + (state ? '<span class="faint">' + esc(state) + '</span>' : '<button class="btn" style="padding:3px 10px;font-size:12px" data-send="' + esc(s.file) + '">Send</button>') + '</td></tr>';
    }).join('') + '</tbody>';
  }

  // ---- actions ----
  $('connectBtn').onclick = function () { info('Connecting...'); api('connect', { url: $('urlIn').value }).then(load, function (e) { info(e.message, true); }); };
  $('setupBtn').onclick = function () { api('setup', { setupKey: $('setupIn').value, name: $('setupName').value }).then(function () { info('Done: you own this server. Make your first team below.'); load(); }, function (e) { info(e.message, true); }); };
  $('joinBtn').onclick = function () { api('join', { code: $('codeIn').value, name: $('joinName').value }).then(function () { $('codeIn').value = ''; show('joinCard', false); info('Welcome to the team.'); load(); }, function (e) { info(e.message, true); }); };
  $('joinMoreBtn').onclick = function () { show('joinCard', true); $('joinNameField').hidden = true; $('codeIn').focus(); };
  $('teamSel').onchange = function () { var id = +this.value; team = (st.me.teams || []).filter(function (t) { return t.id === id; })[0]; loadTeam(); };
  $('nameBtn').onclick = function () { api('rename', { name: $('nameIn').value }).then(function () { info('Saved.'); load(); }, function (e) { info(e.message, true); }); };
  $('newTeamBtn').onclick = function () { api('createTeam', { name: $('newTeamIn').value }).then(function () { $('newTeamIn').value = ''; load(); }, function (e) { info(e.message, true); }); };
  $('discBtn').onclick = function () { if (confirm('Disconnect from this server? You need a new invite code to come back (your teams keep you as a member).')) api('disconnect').then(load); };
  $('leaveBtn').onclick = function () {
    if (!team || !confirm('Leave "' + team.name + '"? Your personal data in this team is deleted; the races you drove with the team stay in its results.')) return;
    var me = members.filter(function (m) { return m.me; })[0]; if (!me) return;
    api('remove', { team: team.id, user: me.id }).then(function () { team = null; load(); }, function (e) { info(e.message, true); });
  };
  $('invBtn').onclick = function () {
    var roles = [].slice.call(document.querySelectorAll('#invRoles input:checked')).map(function (x) { return x.value; });
    if (!roles.length) { info('Pick at least one role.', true); return; }
    api('invite', { team: team.id, roles: roles, days: +$('invDays').value }).then(function (r) {
      $('invOut').innerHTML = '<div class="codebox">' + esc(r.code) + '</div><div class="faint">Works once, for ' + r.days + (r.days === 1 ? ' day' : ' days') + '. Send it to the new member with the server address: ' + esc(st.url.replace(/^https:\/\//, '')) +
        '</div><button class="btn" id="copyCode" style="margin-top:6px">Copy</button>';
      $('copyCode').onclick = function () { try { navigator.clipboard.writeText(r.code); this.textContent = 'Copied'; } catch (e) {} };
    }, function (e) { info(e.message, true); });
  };
  $('memTbl').onclick = function (e) {
    var b = e.target.closest('[data-remove]'); if (!b) return;
    var m = members.filter(function (x) { return x.id === +b.getAttribute('data-remove'); })[0];
    if (!m || !confirm('Remove ' + m.name + ' from the team? Their personal data in this team is deleted; the races they drove with the team stay.')) return;
    api('remove', { team: team.id, user: m.id }).then(loadTeam, function (er) { info(er.message, true); });
  };
  $('memTbl').onchange = function (e) {
    var c = e.target; if (!c.hasAttribute('data-role')) return;
    var u = +c.getAttribute('data-user'), roles = [].slice.call(document.querySelectorAll('#memTbl input[data-user="' + u + '"]:checked')).map(function (x) { return x.getAttribute('data-role'); });
    if (!roles.length) { c.checked = true; info('A member keeps at least one role.', true); return; }
    api('roles', { team: team.id, user: u, roles: roles }).then(function () { info('Saved.'); load(); }, function (er) { info(er.message, true); loadTeam(); });
  };
  $('results').onclick = function (e) {
    var b = e.target.closest('[data-delres]'); if (!b || !confirm('Remove this race from the team results?')) return;
    api('deleteResult', { team: team.id, id: +b.getAttribute('data-delres') }).then(loadTeam, function (er) { info(er.message, true); });
  };
  $('sendTbl').onclick = function (e) {
    var b = e.target.closest('[data-send]'); if (!b || !team) return;
    var file = b.getAttribute('data-send'), k = team.id + '|' + file; b.disabled = true; b.textContent = 'Sending...';
    api('send', { team: team.id, file: file }).then(function (r) { sent[k] = r.added ? 'sent' : 'already there'; renderSend(); loadTeam(); },
      function (er) { sent[k] = ''; info(er.message, true); renderSend(); });
  };

  // your races (the same list as the Review tab)
  var racesLoaded = false;
  if (H.inApp) H.loadPace(function () {}, function (data) {
    var seen = {};
    // one row per race: a race you left and rejoined is in several files (the same raceKey); the app sends it with all of them
    races = (data.sessions || []).filter(function (s) { var last = s.laps.length ? s.laps[s.laps.length - 1][0] : 0; s.last = last; return s.type === 'Race' && !s.live && last >= 10; })
      .sort(function (a, b) { return (b.classPos > 0) - (a.classPos > 0) || b.last - a.last; })
      .filter(function (s) { var k = s.raceKey || s.file; if (seen[k]) return false; return (seen[k] = true); })
      .sort(function (a, b) { return b.time - a.time; }).slice(0, 40);
    racesLoaded = true; renderSend();
  });
  load();
})(typeof window !== 'undefined' ? window : globalThis);
