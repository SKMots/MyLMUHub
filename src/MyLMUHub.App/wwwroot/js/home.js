// Home page: live session summary, the last 7 days (pace-week.js), the two features, your recent sessions.
(function (root) {
  'use strict';
  var P = root.MyLMUHub, F = P.format, M = P.paceMath, R = P.paceRef, H = P.hub;
  function $(id) { return document.getElementById(id); }
  H.header('home');
  $('openRc').onclick = H.openRaceControl;
  document.addEventListener('pw-names', function () { setTimeout(function () { location.reload(); }, 300); });

  H.live(function (s) {
    $('liveTiles').hidden = !s;
    if (!s) { $('liveText').textContent = 'Game not running. Start Le Mans Ultimate and join a session: Race Control fills in by itself.'; $('rcFollow').textContent = '--'; return; }
    var st = s.standings, top = s.top || {}, car = s.car || {};
    $('liveText').textContent = st.focusDriver ? (st.driving ? 'You are driving' : 'Watching ' + st.focusDriver) + (car.model ? ' · ' + car.model : '') : 'Live session, no car to follow yet (pick one with SPECTATE in Race Control).';
    $('lvTrack').textContent = (s.track && s.track.name) || '--';
    $('lvSession').textContent = top.session >= 0 ? F.sessionName(top.session) : '--';
    $('lvPos').textContent = st.focusPos ? 'P' + st.focusPos + ' / ' + st.count : '--';
    $('lvLeft').textContent = st.remaining >= 0 ? F.hms(st.remaining) : '--';
    $('rcFollow').textContent = st.focusDriver || '--';
    $('rcLast').textContent = F.lap(top.last); $('rcBest').textContent = 'best ' + F.lap(top.best);
  });

  H.loadPace(function (i) {
    $('rpProg').hidden = false; $('rpProg').firstChild.style.width = (i.total ? Math.round(100 * i.done / i.total) : 0) + '%';
    $('rpNote').textContent = 'Reading result files: ' + i.done + ' / ' + i.total;
  }, function (i) { show(i); H.watchPace(i.gen, show); });                                 // then follows new laps / result files by itself (hub.js watchPace)

  function show(i) {
    $('rpProg').hidden = true; $('rpNote').textContent = i.error || '';
    H.setWho(i.names && i.names[0]);
    if (i.names && i.names[0]) $('hello').textContent = 'Welcome back, ' + i.names[0].split(/[ #]/)[0];
    var ss = i.sessions || [], groups = M.groups(ss), tracks = {}, laps = 0;
    ss.forEach(function (s) { tracks[s.track] = 1; laps += s.laps.length; });
    $('rpSessions').textContent = F.count(ss.length); $('rpLaps').textContent = F.count(laps) + ' laps';
    $('rpCombos').textContent = F.count(groups.length); $('rpTracks').textContent = Object.keys(tracks).length + ' tracks';
    recent(ss.slice(-8).reverse());
    var refP = H.inApp ? H.json('api/reference') : Promise.reject();                          // the sheet's game patches (which sessions are an older version)
    refP.then(function (r) { return R.parse(r.csv); }, function () { return {}; }).then(function (ref) { P.paceWeek(ss, ref); });
  }

  function recent(list) {
    var t = $('recent');
    if (!list.length) { t.innerHTML = '<tbody><tr><td class="empty">No sessions of yours found yet.</td></tr></tbody>'; return; }
    var h = '<thead><tr><th>Date</th><th>Track</th><th>Session</th><th>Car</th><th class="num">Laps</th><th class="num">Best</th><th class="num">Pace</th><th class="num">vs class best</th><th></th></tr></thead><tbody>';
    list.forEach(function (s) {
      var a = M.session(s), d = a.dry.best ? a.dry : a.wet, wet = !a.dry.best && a.wet.best;
      h += '<tr class="click" data-href="' + H.esc('t=' + encodeURIComponent(R.trackKey(s.track, s.layout)) + '&c=' + encodeURIComponent(s.car)) + '"><td>' + F.day(s.time) + '</td><td>' + H.esc(s.track) + '</td><td>' + H.esc(s.type) + '</td><td>' + H.esc(s.car) +
        '<span class="two">' + H.esc(s['class']) + '</span></td><td class="num">' + s.laps.length + '</td><td class="num">' + F.lap(d.best) + '</td><td class="num">' + F.lap(d.pace) +
        '</td><td class="num">' + F.pctOver(d.best && s.classBest ? d.best / s.classBest : null) + '</td><td>' + (s.live ? '<span class="chip lime" title="the session you are driving now: its result file comes when it ends">LIVE</span>' : '') + (wet ? '<span class="chip wet">WET</span>' : '') + '</td></tr>';
    });
    t.innerHTML = h + '</tbody>';
    t.onclick = function (e) { var r = e.target.closest('tr[data-href]'); if (r) location.href = 'pace.html#' + r.getAttribute('data-href'); };
  }
})(window);
