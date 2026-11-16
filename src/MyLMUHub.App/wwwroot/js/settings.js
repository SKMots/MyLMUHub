// Hub page "Settings" (owner 2026-11-16: "move it to user settings, the app is getting cluttered"): opened from your name in the header. Your driver names and
// results folder (was the popup under your name), the team server (connect, set up, join, your name in the teams, make a team, disconnect: was on the Team
// tab), your phone (pairing code, Discord, log out phones) and the hub theme (was a list in the header).
(function (root) {
  'use strict';
  var P = root.MyLMUHub, H = P.hub, esc = H.esc;
  var $ = function (id) { return document.getElementById(id); };
  H.header('settings');
  function info(t, bad) { $('info').textContent = t || ''; $('info').style.color = bad ? 'var(--red)' : ''; }
  function show(id, on) { $(id).hidden = !on; }
  function api(op, body) {
    return fetch('api/team?op=' + encodeURIComponent(op), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MLH': '1' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error((j && j.error) || ('error ' + r.status)); return j; }); });
  }

  // ---------- your driver names + results folder ----------
  var paceInfo = null;
  function loadNames() {
    if (!H.inApp) { $('nameList').innerHTML = '<span class="faint">Open the hub in the app to set your names.</span>'; return; }
    H.json('api/pace?light=1').then(function (i) {
      paceInfo = i; H.setWho(i.names && i.names[0]);
      var mine = {}, all = (i.candidates || []).slice();
      (i.names || []).forEach(function (n) { mine[n.toLowerCase()] = 1; if (!all.some(function (c) { return c.name.toLowerCase() === n.toLowerCase(); })) all.unshift({ name: n, files: 0 }); });
      $('nameList').innerHTML = all.map(function (c) {
        return '<label><input type="checkbox" value="' + esc(c.name) + '"' + (mine[c.name.toLowerCase()] ? ' checked' : '') + '><span>' + esc(c.name) + '</span>' + (c.files ? '<small>' + c.files + ' files</small>' : '') + '</label>';
      }).join('') || '<span class="faint">No result files found yet.</span>';
      if (document.activeElement !== $('folder')) $('folder').value = i.folder || '';
    }, function () { $('nameList').innerHTML = '<span class="faint">Could not load your names.</span>'; });
  }
  $('saveNames').onclick = function () {
    var list = [].slice.call(document.querySelectorAll('#nameList input:checked')).map(function (x) { return x.value; }), add = $('addName').value.trim();
    if (add) list.push(add);
    var folder = $('folder').value.trim();
    fetch('api/pace', { method: 'PUT', body: JSON.stringify({ names: list, folder: paceInfo && folder === (paceInfo.folder || '') ? null : folder }) })
      .then(function () { $('addName').value = ''; info('Saved.'); H.setWho(list[0]); document.dispatchEvent(new CustomEvent('pw-names')); loadNames(); }, function () { info('Not saved.', true); });
  };

  // ---------- the team server ----------
  var st = null;
  function loadServer() {
    if (!H.inApp) { $('srvState').textContent = 'Open the hub in the app.'; return; }
    api('status').then(function (s) {
      st = s; var member = !!(s.connected && s.member && s.me), url = s.connected ? s.url.replace(/^https:\/\//, '') : '';
      $('srvState').innerHTML = !s.connected ? 'Not connected. A team server shares races, race pace and live races with your team.'
        : !s.reachable ? '<span class="state bad">Cannot be reached</span> · ' + esc(url)
        : member ? '<span class="state ok">Connected</span> · ' + esc(url) + ' · ' + (s.me.teams || []).length + ((s.me.teams || []).length === 1 ? ' team' : ' teams') + (s.me.admin ? ' · you own this server' : '')
        : '<span class="state">Connected</span> · ' + esc(url) + ' · ' + (s.setup ? 'not set up yet' : 'not in a team yet');
      show('connectBox', !s.connected); show('setupBox', s.connected && !s.member && s.setup); show('joinBox', s.connected && !s.member && !s.setup); show('memberBox', member);
      $('joinNameField').hidden = false; $('joinSub').textContent = 'Join a team with the invite code from its owner. A code works once.';
      show('phoneCard', member);
      if (!member) return;
      if (document.activeElement !== $('nameIn')) $('nameIn').value = s.me.name || '';
      show('adminBox', !!s.me.admin);
      $('siteUrl').textContent = url.replace(/^team\./, '');
      $('discordBtn').textContent = s.me.discord ? 'Discord: ' + s.me.discord + ' (unlink)' : 'Link my Discord';
      $('phoneInfo').textContent = s.me.phones ? s.me.phones + (s.me.phones === 1 ? ' phone logged in' : ' phones logged in') : 'No phone logged in.';
    }, function (e) { $('srvState').textContent = e.message; });
  }
  $('connectBtn').onclick = function () { info('Connecting...'); api('connect', { url: $('urlIn').value }).then(function () { info(''); loadServer(); }, function (e) { info(e.message, true); }); };
  $('setupBtn').onclick = function () { api('setup', { setupKey: $('setupIn').value, name: $('setupName').value }).then(function () { info('Done: you own this server. Make your first team below.'); loadServer(); }, function (e) { info(e.message, true); }); };
  $('joinBtn').onclick = function () { api('join', { code: $('codeIn').value, name: $('joinName').value }).then(function () { $('codeIn').value = ''; info('Welcome to the team: see the Team tab.'); loadServer(); }, function (e) { info(e.message, true); }); };
  $('joinMoreBtn').onclick = function () { show('joinBox', true); $('joinNameField').hidden = true; $('joinSub').textContent = 'Another team: its invite code.'; $('codeIn').focus(); };
  $('nameBtn').onclick = function () { api('rename', { name: $('nameIn').value }).then(function () { info('Saved.'); loadServer(); }, function (e) { info(e.message, true); }); };
  $('newTeamBtn').onclick = function () { api('createTeam', { name: $('newTeamIn').value }).then(function () { $('newTeamIn').value = ''; info('Team made: invite the others on the Team tab (Members).'); loadServer(); }, function (e) { info(e.message, true); }); };
  $('discBtn').onclick = function () { if (confirm('Disconnect from this server? You need a new invite code to come back (your teams keep you as a member).')) api('disconnect').then(loadServer); };

  // ---------- your phone ----------
  var pairTimer = null;
  $('pairBtn').onclick = function () {
    api('pair').then(function (r) {
      clearInterval(pairTimer); var left = r.seconds || 120;
      $('pairOut').innerHTML = '<div class="codebox">' + esc(r.code) + '</div><div class="faint" id="pairLeft"></div>';
      var tick = function () { if (left <= 0) { clearInterval(pairTimer); $('pairOut').innerHTML = '<div class="faint">The code expired. Make a new one.</div>'; return; } $('pairLeft').textContent = 'On your phone: ' + $('siteUrl').textContent + ' > Log in > type this code. Works once, ' + left + ' s left.'; left--; };
      tick(); pairTimer = setInterval(tick, 1000);
    }, function (e) { info(e.message, true); });
  };
  $('discordBtn').onclick = function () {
    if (st && st.me && st.me.discord) { if (confirm('Unlink your Discord account (' + st.me.discord + ')? Phones that logged in stay logged in.')) api('discordUnlink').then(loadServer); return; }
    api('discordLink').then(function () { info('Your browser opened Discord: confirm there, then come back here.'); setTimeout(loadServer, 15000); }, function (e) { info(e.message, true); });
  };
  $('phonesOutBtn').onclick = function () { if (confirm('Log out every phone and browser that is logged in?')) api('logoutPhones').then(function (r) { info((r.ended || 0) + ' logged out.'); loadServer(); }, function (e) { info(e.message, true); }); };

  // ---------- hub theme ----------
  function themes() {
    var cur = H.theme();
    $('themeSeg').innerHTML = H.themes.map(function (t) { return '<button data-v="' + t[0] + '"' + (t[0] === cur ? ' class="on"' : '') + '>' + esc(t[1].replace('Theme: ', '')) + '</button>'; }).join('');
  }
  $('themeSeg').onclick = function (e) { var b = e.target.closest('[data-v]'); if (!b) return; H.setTheme(b.getAttribute('data-v')); themes(); };

  // ---------- guest mode (hub.js: the same panel the header had) ----------
  H.guestPanel($('guestBox'));

  loadNames(); loadServer(); themes();
  root.addEventListener('focus', loadServer);                                              // back from the browser (Discord): show the link
})(typeof window !== 'undefined' ? window : globalThis);
