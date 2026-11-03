// "Last 7 days" card on the hub's Home page: what you drove this week per track + class (every class), the biggest race-pace gain and the biggest
// best-lap gain against all your laps before this week, and a line per track + class (paceMath.weekly). Race sessions for the pace, slow laps > 5 %
// left out, sessions of an older game version left out (as Race Pace's defaults). Ids filled: weekSub, weekTiles, weekTbl.
(function (root) {
  'use strict';
  var P = root.Pitwall, F = P.format, M = P.paceMath, R = P.paceRef;
  var CLASS_LABEL = { LMH: 'Hypercar', LMP2wec: 'LMP2', LMP2elms: 'LMP2 ELMS', LMP3: 'LMP3', LMGT3: 'GT3', GTE: 'GTE' }, TYPES = ['Race'], SLOW = 0.05;
  function esc(s) { return P.hub.esc(s); }
  function clsOf(s) { return R.className(s['class']) || String(s['class'] || ''); }
  function clsName(c) { return CLASS_LABEL[c] || c; }
  function tile(k, v, n, cls) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + esc(v) + '</div><div class="n">' + esc(n || '') + '</div></div>'; }
  // ref = the reference sheet (R.parse): its patch per track + class decides which sessions are on an older game version
  P.paceWeek = function (sessions, ref) {
    var current = null; sessions.forEach(function (s) { var m = R.major(s.version); if (m && (!current || m > current)) current = m; });
    var list = sessions.filter(function (s) { var t = ref[R.trackName(s.track, s.layout)], c = t && t[R.className(s['class'])]; return !R.isOld(s.version, c && c.patch, current); });
    var w = M.weekly(list, Date.now() / 1000, function (s) { return R.trackKey(s.track, s.layout) + '\u0001' + clsOf(s); }, SLOW, TYPES, 7);
    function name(g) { var s = g.sample, n = R.trackName(s.track, s.layout) || s.track, l = R.layoutLabel(s.layout); return n + (l ? ' · ' + l : ''); }
    function cls(g) { return clsName(g.key.split('\u0001')[1]); }
    function diff(d, rel) { return d === null ? '<span class="faint">--</span>' : '<b class="' + (d < 0 ? 'green' : d > 0 ? 'red' : '') + '">' + esc(F.plusSec(d)) + '</b>' + (rel !== undefined && rel !== null ? '<span class="two">' + esc(F.diff(rel * 100, 2)) + ' %</span>' : ''); }
    function top(key) { var b = null; w.forEach(function (g) { if (g[key] !== null && g[key] < 0 && (!b || g[key] < b[key])) b = g; }); return b; }
    var most = w[0], pg = top('paceDiff'), bg = top('bestDiff'), $ = function (id) { return document.getElementById(id); };
    $('weekTiles').innerHTML = !w.length ? '' :
      tile('Most driven', name(most), cls(most) + ' · ' + most.laps + ' laps · ' + F.hm(most.secs) + ' h') +
      tile('Race pace: biggest gain', pg ? F.plusSec(pg.paceDiff) + ' s' : '--', pg ? name(pg) + ' · ' + cls(pg) + ' · now ' + F.lap(pg.pace) + ' (' + F.diff(pg.paceRel * 100, 2) + ' %)' : 'not faster than before anywhere yet', pg ? 'green' : '') +
      tile('Best lap: biggest gain', bg ? F.plusSec(bg.bestDiff) + ' s' : '--', bg ? name(bg) + ' · ' + cls(bg) + ' · new best ' + F.lap(bg.best) : 'no new best lap this week', bg ? 'purple' : '');
    $('weekSub').textContent = w.length ? 'What you drove since ' + F.day(Date.now() / 1000 - 7 * 86400) + ', per track and class, compared with all your laps before that. Race pace from race sessions; negative = faster.'
      : 'No sessions in the last 7 days.';
    var h = '<thead><tr><th>Track</th><th>Class</th><th class="num">Sessions</th><th class="num">Laps</th><th class="num">Time</th><th class="num">Race pace</th><th class="num">vs before</th>' +
      '<th class="num">Best lap</th><th class="num">vs before</th></tr></thead><tbody>';
    w.forEach(function (g) {
      h += '<tr class="click" data-t="' + esc(g.key.split('\u0001')[0]) + '"><td><b>' + esc(name(g)) + '</b></td><td>' + esc(cls(g)) + '</td><td class="num">' + g.sessions + '</td><td class="num">' + g.laps + '</td><td class="num">' + F.hm(g.secs) +
        '</td><td class="num">' + F.lap(g.pace) + '<span class="two">' + (g.clean ? g.clean + ' laps' : '') + '</span></td><td class="num">' + diff(g.paceDiff, g.paceRel) +
        '</td><td class="num purple">' + F.lap(g.best) + '</td><td class="num">' + diff(g.bestDiff) + '</td></tr>';
    });
    $('weekTbl').innerHTML = w.length ? h + '</tbody>' : '';
    $('weekTbl').onclick = function (e) { var r = e.target.closest('tr[data-t]'); if (r) location.href = 'pace.html#t=' + encodeURIComponent(r.getAttribute('data-t')); };   // a line opens that track in Race Pace
  };
})(window);
