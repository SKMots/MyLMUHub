// My sessions page: every result file with laps under your names (api/sessions, PaceService.Files): tick some, then hide them from your data, give them to a
// guest, take them back, or delete them (Recycle Bin). For sessions someone else drove while guest mode was off.
(function (root) {
  'use strict';
  var P = root.MyLMUHub, F = P.format, R = P.paceRef, H = P.hub, esc = H.esc;
  function $(id) { return document.getElementById(id); }
  var data = null, show = '', find = '', ticked = {};
  H.header('');

  function who(f) { return f.hidden ? 'hidden' : f.owner ? 'guest' : 'mine'; }
  function text(f) { return f.sessions.map(function (s) { return [s.track, R.trackName(s.track, s.layout) || '', s.car, s.cls, s.type].join(' '); }).join(' ') + ' ' + (f.owner || ''); }
  function list() {
    return (data ? data.files : []).filter(function (f) { return (!show || who(f) === show) && (!find || text(f).toLowerCase().indexOf(find) >= 0); });
  }
  function render() {
    if (!data) return;
    var l = list(), all = data.files.length;
    $('count').textContent = l.length + (l.length === all ? '' : ' of ' + all) + ' result files' + (data.scanning ? ' (still reading your result files...)' : '');
    if (!l.length) { $('tbl').innerHTML = '<tbody><tr><td class="empty">' + (all ? 'Nothing here.' : 'No result files with your laps yet.') + '</td></tr></tbody>'; sel(); return; }
    var h = '<thead><tr><th><input type="checkbox" id="all"></th><th>Date</th><th>Track</th><th>Session</th><th>Car</th><th class="num">Laps</th><th class="num">Best</th><th>Whose</th></tr></thead><tbody>';
    l.forEach(function (f) {
      var s0 = f.sessions[0], laps = 0, best = null, types = [];
      f.sessions.forEach(function (s) { laps += s.laps; if (s.best && (!best || s.best < best)) best = s.best; if (types.indexOf(s.type) < 0) types.push(s.type); });
      var chip = f.hidden ? '<span class="chip dim">HIDDEN</span>' : f.owner ? '<span class="chip pit">' + esc(f.owner.toUpperCase()) + '</span>' : '<span class="chip lime">YOU</span>';
      h += '<tr class="click' + (ticked[f.file] ? ' sel' : '') + '" data-f="' + esc(f.file) + '"><td><input type="checkbox"' + (ticked[f.file] ? ' checked' : '') + '></td><td>' + esc(F.wallClock(f.time * 1000)) +
        '<span class="two">' + esc(F.day(f.time)) + '</span></td><td>' + esc(R.trackName(s0.track, s0.layout) || s0.track) + '</td><td>' + esc(types.join(' + ')) + '</td><td>' + esc(s0.car) +
        '<span class="two">' + esc(s0.cls) + '</span></td><td class="num">' + laps + '</td><td class="num">' + F.lap(best) + '</td><td>' + chip + '</td></tr>';
    });
    $('tbl').innerHTML = h + '</tbody>';
    $('all').checked = l.every(function (f) { return ticked[f.file]; });
    $('all').onclick = function (e) { e.stopPropagation(); var on = this.checked; l.forEach(function (f) { if (on) ticked[f.file] = 1; else delete ticked[f.file]; }); render(); };
    sel();
  }
  $('tbl').onclick = function (e) {
    var r = e.target.closest('tr[data-f]'); if (!r) return;
    var f = r.getAttribute('data-f'); if (ticked[f]) delete ticked[f]; else ticked[f] = 1; render();
  };
  function picked() { return Object.keys(ticked).filter(function (f) { return data && data.files.some(function (x) { return x.file === f; }); }); }
  function sel() {
    var p = picked(), files = data ? data.files.filter(function (f) { return ticked[f.file]; }) : [];
    $('selInfo').textContent = p.length ? p.length + ' ticked' : 'Nothing ticked';
    $('bHide').disabled = !files.some(function (f) { return !f.hidden; }); $('bRestore').disabled = !files.some(function (f) { return f.hidden; });
    $('bGuest').disabled = !p.length; $('bMine').disabled = !files.some(function (f) { return f.owner; }); $('bDelete').disabled = !p.length;
    var here = H.inApp && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (!here) ['bHide', 'bRestore', 'bGuest', 'bMine', 'bDelete'].forEach(function (b) { $(b).disabled = true; });
  }
  function act(what, name) {
    var files = picked(); if (!files.length) return;
    $('msg').textContent = 'Working...';
    fetch('api/sessions', { method: 'POST', body: JSON.stringify({ do: what, files: files, name: name || null }) }).then(function (r) { return r.json(); }).then(function (r) {
      $('msg').textContent = r.changed + ' result file' + (r.changed === 1 ? '' : 's') + ' changed'; ticked = {}; setTimeout(load, what === 'delete' ? 1500 : 0);
    }, function () { $('msg').textContent = 'That did not work'; });
  }
  $('bHide').onclick = function () { act('hide'); };
  $('bRestore').onclick = function () { act('restore'); };
  $('bMine').onclick = function () { act('mine'); };
  $('bGuest').onclick = function () {
    var g = (data.guests || []), n = prompt('Give the ticked sessions to which guest?' + (g.length ? '\n\nYour guests: ' + g.join(', ') : '') + '\n\nHe sees them when guest mode is on with his name; they are no longer in your data.', g[0] || '');
    if (n && n.trim()) act('guest', n.trim());
  };
  $('bDelete').onclick = function () {
    var n = picked().length;
    if (confirm('Delete ' + n + ' result file' + (n === 1 ? '' : 's') + '?\n\nThey go to the Windows Recycle Bin (you can still get them back from there) and leave your data and any guest\'s.')) act('delete');
  };
  $('segShow').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    [].forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); }); show = b.getAttribute('data-v'); render();
  };
  $('find').oninput = function () { find = this.value.trim().toLowerCase(); render(); };
  function load() {
    if (!H.inApp) { $('tbl').innerHTML = '<tbody><tr><td class="empty">Open this page in the app.</td></tr></tbody>'; return; }
    H.json('api/sessions').then(function (d) { data = d; render(); if (d.scanning) setTimeout(load, 1500); }, function () { $('tbl').innerHTML = '<tbody><tr><td class="empty">Could not read your sessions.</td></tr></tbody>'; });
  }
  load();
  document.addEventListener('pw-names', function () { setTimeout(load, 300); });
})(window);
