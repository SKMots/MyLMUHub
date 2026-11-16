// Strategy tab "Review" (owner 2026-11-15): a race you drove from its results file (api/stints: every driver's laps of your car) - stints, pit stops,
// tyres, drivers, findings in plain words, "what if" with the race's own numbers, and a plan to compare with. The maths: review-math.js.
(function (root) {
  'use strict';
  var P = root.MyLMUHub, H = P.hub, F = P.format, SM = P.strategyMath, RM = P.reviewMath, R = P.paceRef, esc = H.esc;
  var $ = function (id) { return document.getElementById(id); };
  H.header('strategy');
  if (H.inApp) H.json('api/pace?light=1').then(function (i) { H.setWho(i.names && i.names[0]); }, function () {});
  var races = [], plans = [], race = null, rv = null, open = {};

  function tile(k, v, n, cls) { return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div><div class="n">' + (n || '') + '</div></div>'; }
  function trackOf(s) { return R.trackName(s.track, s.layout) || s.track; }
  function planFits(p, s) { if (!p || !s || !p.track) return false; var n = trackOf(s); return n === p.track || p.track.indexOf(n) === 0 || n.indexOf(p.track) === 0; }
  function plan() { var id = $('planSel').value; return plans.filter(function (p) { return p.id === id; })[0] || null; }

  function load(file) {
    if (!file) return;
    $('info').textContent = 'Reading ' + file + '...'; $('body').hidden = true;
    H.json('api/stints?file=' + encodeURIComponent(file)).then(function (r) {
      race = r; open = {};
      var s = races.filter(function (x) { return x.file === file; })[0];
      // the plan: one for this track (the one picked for the race first)
      if (!$('planSel').value || !planFits(plan(), s)) { var p = plans.filter(function (x) { return planFits(x, s); })[0]; $('planSel').value = p ? p.id : ''; }
      $('info').textContent = ''; render();
    }, function () { $('info').textContent = 'Your car was not found in that race.'; });
  }

  function render() {
    if (!race) return;
    rv = RM.review(race, { plan: plan() });
    if (!rv) { $('info').textContent = 'No laps in that race.'; return; }
    $('body').hidden = false;
    var c = rv.car || {}, s0 = races.filter(function (x) { return x.file === $('raceSel').value; })[0] || {};
    $('raceSub').textContent = [trackOf(s0), c.carType || s0.car, c.team, c.vehicle].filter(Boolean).join(' · ') + (c.finish ? ' · ' + c.finish : '');
    var stops = rv.stints.filter(function (x) { return x.pitted; }).length;
    $('sumTiles').innerHTML = tile('Result', c.classPos ? 'P' + c.classPos : '--', c.pos ? 'class · P' + c.pos + ' overall' : '') + tile('Laps', rv.laps, rv.length && rv.length.kind !== 'laps' ? F.hm(rv.length.time) + ' race' : '') +
      tile('Stops', stops, rv.pitLoss ? Math.round(rv.pitLoss) + ' s each (median)' : '') + tile('Finish', rv.finish > 0 ? F.clock(rv.finish) : '--', 'race time') +
      tile('Best lap', c.best > 0 ? F.lap(c.best) : '--', '', 'purple') +
      rv.drivers.map(function (d) { return tile(d.name || '?', d.avg ? F.lap(d.avg) : '--', d.stints + ' stints · best ' + (d.best ? F.lap(d.best) : '--')); }).join('');
    $('findings').innerHTML = rv.findings.map(function (f) { return '<div class="finding ' + f.kind + '"><b>' + esc(f.title) + '</b><span class="muted">' + esc(f.text) + '</span></div>'; }).join('') || '<div class="faint">Nothing to point out.</div>';
    // stints (+ the plan's stint next to each)
    var vp = rv.vsPlan;
    $('stintTbl').innerHTML = '<thead><tr><th class="num">#</th><th>Driver</th><th class="num">Laps</th><th class="num">Average</th><th class="num">Fastest</th><th class="num">VE / lap</th><th class="num">VE left</th><th>Stop after</th>' +
      (vp ? '<th>Plan</th>' : '') + '</tr></thead><tbody>' +
      rv.stints.map(function (s, i) {
        var nx = rv.stints[i + 1], ps = vp && vp.stints[i] ? vp.stints[i].plan : null;
        var stop = s.pitted ? (s.stopLoss > 0 ? Math.round(s.stopLoss) + ' s' : 'stop') + (nx ? (nx.tyres ? ' · ' + RM.tyreWord(nx.tyres) + (nx.tyresLikely ? ' (likely)' : '') : nx.tyres === '' ? ' · no tyres' : '') + (nx.driver && nx.driver !== s.driver ? ' · swap to ' + esc(nx.driver) : '') : '') : '<span class="faint">finish</span>';
        var row = '<tr class="click" data-i="' + i + '"><td class="num">' + s.n + '</td><td>' + esc(s.driver || '?') + '</td><td class="num">' + s.laps + '<span class="two">' + s.from + '-' + s.to + '</span></td>' +
          '<td class="num">' + (s.avg ? F.lap(s.avg) : '--') + '<span class="two">' + s.clean + ' clean</span></td><td class="num" style="color:var(--purple)">' + (s.best ? F.lap(s.best) : '--') + '</td>' +
          '<td class="num">' + (s.ve ? F.pct(s.ve, 2) : '--') + '</td><td class="num">' + (s.veLeft >= 0 ? F.pct(s.veLeft, 1) : '--') + '</td><td>' + stop + '</td>' +
          (vp ? '<td class="faint">' + (ps ? esc(ps.driver) + ', ' + ps.laps + ' laps, ' + F.lap(ps.lap) : '--') + '</td>' : '') + '</tr>';
        return row + (open[i] ? lapsRow(s, vp ? 9 : 8) : '');
      }).join('') + '</tbody>';
    [].forEach.call($('stintTbl').querySelectorAll('tr.click'), function (tr) { tr.onclick = function () { var i = +tr.getAttribute('data-i'); open[i] = !open[i]; render(); }; });
    // drivers
    $('drvTbl').innerHTML = '<thead><tr><th>Driver</th><th class="num">Stints</th><th class="num">Laps</th><th class="num">Average lap</th><th class="num">Fastest</th><th class="num">VE per lap</th></tr></thead><tbody>' +
      rv.drivers.map(function (d) { return '<tr><td>' + esc(d.name || '?') + '</td><td class="num">' + d.stints + '</td><td class="num">' + d.laps + '</td><td class="num">' + (d.avg ? F.lap(d.avg) : '--') + '</td><td class="num" style="color:var(--purple)">' + (d.best ? F.lap(d.best) : '--') + '</td><td class="num">' + (d.vePerLap ? F.pct(d.vePerLap, 2) : '--') + '</td></tr>'; }).join('') + '</tbody>';
    // what if
    var w = rv.whatIf; $('whatCard').hidden = !w || !w.options.length;
    if (w && w.options.length) {
      $('whatSub').textContent = 'The race again with its own numbers: ' + F.lap(w.pace) + ' a lap, ' + F.pct(w.rate, 2) + ' VE a lap without lifting (the most a stint used), ' + Math.round(rv.pitLoss) + ' s a stop. ' +
        (w.costKnown ? 'Lifting costs ' + (rv.cost.cost * 0.1).toFixed(2) + ' s a lap per 0.1 % (from this race), so a stint length that needs lifting has slower laps.' : 'What lifting costs is not known from this race: lap times stay the same.');
      $('whatTbl').innerHTML = '<thead><tr><th class="num">Laps a stint</th><th class="num">VE per lap</th><th class="num">Lifting</th><th class="num">Lap time</th><th class="num">Stops</th><th class="num">Laps</th><th class="num">Finish</th><th></th></tr></thead><tbody>' +
        w.options.map(function (o) {
          return '<tr' + (o === w.best ? ' class="ls-now"' : '') + '><td class="num">' + o.laps + '</td><td class="num">' + F.pct(o.perLap, 2) + '</td><td class="num">' + (o.save > 0 ? F.pct(o.save, 2) : '<span class="faint">none</span>') + '</td>' +
            '<td class="num">' + F.lap(o.lap) + '</td><td class="num">' + o.stops + '</td><td class="num">' + o.raceLaps + '</td><td class="num">' + F.clock(o.end) + '</td><td>' +
            (o.laps === w.did ? '<span class="chip lime">YOU DID</span> ' : '') + (o === w.best ? '<span class="chip ok">BEST</span>' : '') + '</td></tr>';
        }).join('') + '</tbody>';
    }
  }

  // the laps of one stint (under its row): time, against the stint average, VE used and left, tyre left (your own laps)
  function lapsRow(s, cols) {
    var rows = s.lapList.map(function (l) {
      var d = l.t && s.avg ? l.t - s.avg : null, note = l.pit ? 'in lap' : (s.n > 1 && l === s.lapList[0]) ? 'out lap' : l.n === 1 ? 'start' : l.t && s.avg && l.t > s.avg * 1.07 ? 'slow' : !l.t ? 'not timed' : '';
      var tw = l.wheels ? Math.round((l.wheels[0] + l.wheels[1] + l.wheels[2] + l.wheels[3]) / 4 * 100) + '%' : '';
      return '<tr><td class="num">' + l.n + '</td><td class="num"' + (l.t && l.t === s.best ? ' style="color:var(--purple);font-weight:700"' : '') + '>' + (l.t ? F.lap(l.t) : '--') + '</td>' +
        '<td class="num"' + (d !== null && !note ? ' style="color:var(' + (d <= 0 ? '--green' : '--red') + ')"' : '') + '>' + (d !== null && !note ? (d > 0 ? '+' : '−') + Math.abs(d).toFixed(3) : '') + '</td>' +
        '<td class="num">' + (l.veUsed ? F.pct(l.veUsed, 2) : '--') + '</td><td class="num">' + (l.veLeft >= 0 ? F.pct(l.veLeft, 1) : '--') + '</td><td class="num">' + tw + '</td><td class="faint">' + note + '</td></tr>';
    }).join('');
    return '<tr class="laps"><td colspan="' + cols + '"><table class="tbl"><thead><tr><th class="num">Lap</th><th class="num">Time</th><th class="num">vs average</th><th class="num">VE used</th><th class="num">VE left</th><th class="num">Tyres left</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></td></tr>';
  }

  $('raceSel').onchange = function () { load(this.value); };
  $('planSel').onchange = function () { render(); };

  var plansP = H.inApp ? H.json('api/strategy').catch(function () { return {}; }) : Promise.resolve({});
  plansP.then(function (st) {
    plans = (st && st.plans) || [];
    $('planSel').innerHTML = '<option value="">No plan</option>' + plans.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name || 'Unnamed') + '</option>'; }).join('');
    H.loadPace(function (i) { $('info').textContent = 'Reading your result files... ' + (i.done || 0) + ' / ' + (i.total || '?'); }, function (data) {
      if (data.error) { $('raceSel').innerHTML = '<option value="">--</option>'; $('info').textContent = data.error; return; }
      var seen = {};
      races = (data.sessions || []).filter(function (s) { var last = s.laps.length ? s.laps[s.laps.length - 1][0] : 0; if (s.type !== 'Race' || s.live || last < 10 || seen[s.file]) return false; s.last = last; return (seen[s.file] = true); })
        .sort(function (a, b) { return b.time - a.time; });
      $('raceSel').innerHTML = races.length ? races.map(function (s) { return '<option value="' + esc(s.file) + '">' + esc(F.day(s.time) + ' · ' + trackOf(s) + ' · ' + s.car + ' · ' + s.last + ' laps') + '</option>'; }).join('') : '<option value="">No races found</option>';
      if (races.length) load(races[0].file); else $('info').textContent = 'No races of 10+ laps in your result files.';
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
