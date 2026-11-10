// Number formatting and colours shared by all widgets. Pure functions (unit-tested in tests/js).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  // Theme colours. Widgets use C.x = 'var(--pw-x, default)': the theme (page) or a widget's own style (its box) overrides the CSS variable, see theme.js.
  var DEFAULTS = { purple: '#B66DFF', green: '#00E676', red: '#FF3B3B', yellow: '#FFE600', white: '#D9E4F5', muted: '#98A9C6',
            dim: '#364260', sector: '#BCCBE2', int: '#8DEBFF', accent: '#FF9F43', ve: '#26BCFF', label: '#7A8BA8',
            blue: '#4AA3FF', tyreH: '#F2F2F2', bright: '#FFFFFF', marker: '#FF8A1F', track: '#1B2640',
            bg: '#050914', panel: '#0F1626', panelDark: '#070C18', border: '#1F2B47', focusRow: '#152A4F', focusMark: '#FFD400', rowLine: '#151E34',
            redAccent: '#FF5252', limeAccent: '#02FF39', subtext: '#A2B3CF', faint: '#46557A', warnLabel: '#FF6B6B', dmgOk: '#14502F', dmgLight: '#FFB300',
            carBody: '#080D1A', noData: '#1F2A44' };
  var C = {}; for (var k in DEFAULTS) C[k] = 'var(--pw-' + k + ',' + DEFAULTS[k] + ')';

  // lap time: 01:48.400
  function lap(s) {
    if (!(s > 0)) return '--:--.---';
    var ms = Math.round(s * 1000), m = Math.floor(ms / 60000), r = ms - m * 60000;
    return pad(m, 2) + ':' + pad(Math.floor(r / 1000), 2) + '.' + pad(r % 1000, 3);
  }
  // sector time: 30.515 under a minute, 1:31.000 from a minute up
  function sector(s) {
    if (!(s > 0)) return '-';
    var ms = Math.round(s * 1000);
    if (ms < 60000) return (ms / 1000).toFixed(3);
    var m = Math.floor(ms / 60000), r = ms - m * 60000;
    return m + ':' + pad(Math.floor(r / 1000), 2) + '.' + pad(r % 1000, 3);
  }
  // leaderboard gap column: +4.50 / -22.3 / +1:15 / +1L / -- for the focus car
  // a leaderboard row's penalties: 'DT', 'SG', '+10s' (the kind from the game's UI websocket, when it gives it), else the count from shared memory: 'PEN' / '2 PEN'; '' = none
  function penalty(d) {
    var dt = (d && d.penDt) || 0, sg = (d && d.penSg) || 0, sec = (d && d.penSec) || 0, n = (d && d.pen) || 0, out = [];
    if (dt) out.push(dt > 1 ? dt + '×DT' : 'DT');
    if (sg) out.push(sg > 1 ? sg + '×SG' : 'SG');
    if (sec > 0) out.push('+' + Math.round(sec) + 's');
    if (!out.length && n > 0) out.push(n > 1 ? n + ' PEN' : 'PEN');
    return out.join(' ');
  }
  function gapText(g, isFocus) {
    if (!g || g.kind === 'none') return isFocus ? '--' : '';
    if (g.kind === 'laps') return g.sign + Math.floor(g.value) + 'L';
    var t = g.value;
    if (t >= 60) { var m = Math.floor(t / 60), s = Math.floor(t - m * 60); return g.sign + m + ':' + pad(s, 2); }
    return g.sign + (t < 10 ? t.toFixed(2) : t.toFixed(1));
  }
  // card gap: always a time (+3.10 / -22.30 / +4:33 from 100 s)
  function cardGapText(g) {
    if (!g || g.kind === 'none') return '';
    var t = g.value;
    if (t >= 100) { var m = Math.floor(t / 60), s = Math.floor(t - m * 60); return g.sign + m + ':' + pad(s, 2); }
    return g.sign + t.toFixed(2);
  }
  function delta(d) { return (d && d.has) ? ((d.value > 0 ? '+' : '') + d.value.toFixed(1)) : ''; }
  function ve(v) { return v > 0 ? Math.round(v) + '%' : '--'; }
  function clock(sec) {
    if (!(sec >= 0)) return '';
    var s = Math.floor(sec); return Math.floor(s / 3600) + ':' + pad(Math.floor((s % 3600) / 60), 2) + ':' + pad(s % 60, 2);
  }
  // top bar session clock: 01:23:45, none = --:--:--
  function hms(sec) {
    if (!(sec >= 0)) return '--:--:--';
    var s = Math.floor(sec); return pad(Math.floor(s / 3600), 2) + ':' + pad(Math.floor((s % 3600) / 60), 2) + ':' + pad(s % 60, 2);
  }
  // mSession: 0 test day, 1-4 practice, 5-8 qualifying, 9 warm-up, 10-13 race
  function sessionName(id) { return !(id >= 0) ? '' : id === 0 ? 'TEST DAY' : (id <= 4 ? 'PRACTICE' : (id <= 8 ? 'QUALIFY' : (id === 9 ? 'WARMUP' : (id <= 13 ? 'RACE' : '')))); }
  // signed difference: +0.123 / -0.40; null = nothing
  function diff(d, decimals) { return (d === null || d === undefined) ? '' : (d > 0 ? '+' : '') + d.toFixed(decimals); }
  // live delta: +0.123, none = -.---
  function liveDelta(d, decimals) { var n = decimals || 3; return (d === null || d === undefined) ? '-.' + '---'.slice(0, n) : diff(d, n); }
  function lapsLeft(v) { return v > 0 ? v.toFixed(1) : ''; }
  // Colour rules. The optional last argument k = the widget's own colours for each outcome (its colour parts, see theme.js); without it: the theme colours.
  function diffColor(d, k) { k = k || { none: C.label, slower: C.red, faster: C.green }; return (d === null || d === undefined) ? k.none : (d > 0 ? k.slower : k.faster); }
  function sectorBoxColor(flag, k) { k = k || { classBest: C.purple, ownBest: C.green, slower: C.yellow, none: C.label }; return flag === 1 ? k.classBest : (flag === 2 ? k.ownBest : (flag === 3 ? k.slower : k.none)); }
  function veColor(v, k) { k = k || { none: C.dim, low: C.red, mid: C.yellow, ok: C.ve }; return !(v > 0) ? k.none : (v < 15 ? k.low : (v < 30 ? k.mid : k.ok)); }
  function tyreColor(t, k) { k = k || { soft: C.red, medium: C.yellow, hard: C.tyreH, wet: C.blue, other: C.label }; return t === 'S' ? k.soft : (t === 'M' ? k.medium : (t === 'H' ? k.hard : (t === 'W' ? k.wet : k.other))); }
  function bestColor(flag, k) { k = k || { classBest: C.purple, normal: C.white }; return flag === 1 ? k.classBest : k.normal; }
  function lastColor(flag, k) { k = k || { classBest: C.purple, ownBest: C.green, normal: C.white }; return flag === 1 ? k.classBest : (flag === 2 ? k.ownBest : k.normal); }
  function deltaColor(flag, k) { k = k || { theyFaster: C.red, theySlower: C.green, none: C.label }; return flag === 1 ? k.theyFaster : (flag === 2 ? k.theySlower : k.none); }
  function sectorColor(s, k) { k = k || { time: C.sector, none: C.dim }; return s > 0 ? k.time : k.none; }

  // ---- car / tyres / fuel / damage / track / forecast widgets (SimHub v4.21 rules) ----
  function has(v) { return v !== null && v !== undefined; }
  function hex2(v) { v = Math.round(v); return (v < 16 ? '0' : '') + v.toString(16); }
  // colour gradient: stops [[value, [r,g,b]], ...]; nothing = the "no data" colour
  function ramp(stops, t, none) {
    if (!has(t) || !(t > 0)) return none || C.noData;
    if (t <= stops[0][0]) return '#' + stops[0][1].map(hex2).join('').toUpperCase();
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0]);
        return '#' + [0, 1, 2].map(function (k) { return hex2(a[1][k] + (b[1][k] - a[1][k]) * f); }).join('').toUpperCase();
      }
    }
    return '#' + stops[stops.length - 1][1].map(hex2).join('').toUpperCase();
  }
  var TYRE_T = [[40, [14, 165, 233]], [65, [0, 200, 230]], [85, [2, 255, 57]], [105, [255, 230, 0]], [120, [255, 140, 0]], [135, [255, 59, 59]]];
  var BRAKE_T = [[150, [14, 165, 233]], [300, [0, 200, 230]], [450, [2, 255, 57]], [750, [255, 230, 0]], [900, [255, 140, 0]], [1000, [255, 59, 59]]];
  function tyreTempColor(t, none) { return ramp(TYRE_T, t, none); }
  function brakeTempColor(t, none) { return ramp(BRAKE_T, t, none); }
  // temperatures come in °C; unit 'F' shows Fahrenheit (the colour scales stay on °C)
  function toUnit(t, unit) { return unit === 'F' ? t * 9 / 5 + 32 : t; }
  function deg(t, unit) { return has(t) && isFinite(t) ? Math.round(toUnit(t, unit)) + '\u00B0' : '--'; }
  function wear(w) { return w >= 0 ? Math.round(w * 100) + '%' : '--'; }
  function psi(kpa) { return kpa > 0 ? (kpa * 0.1450377).toFixed(1) : '--'; }         // the game gives kPa
  function pressure(kpa, unit) { return !(kpa > 0) ? '--' : (unit === 'kPa' ? String(Math.round(kpa)) : (unit === 'bar' ? (kpa / 100).toFixed(2) : psi(kpa))); }
  // compound box: SOFT / MED / HARD / WET from the compound name
  function compound(name) {
    var t = String(name || '').toLowerCase();
    return t.indexOf('soft') >= 0 ? 'SOFT' : (t.indexOf('med') >= 0 ? 'MED' : (t.indexOf('hard') >= 0 ? 'HARD' : ((t.indexOf('wet') >= 0 || t.indexOf('rain') >= 0) ? 'WET' : '')));
  }
  function compoundColor(n, k) { k = k || { soft: C.red, medium: C.yellow, hard: C.tyreH, wet: C.blue }; return n === 'SOFT' ? k.soft : (n === 'HARD' ? k.hard : (n === 'WET' ? k.wet : k.medium)); }
  function level(v) { return v >= 0 ? String(v) : '-'; }
  function bias(b) { return b > 0 ? b.toFixed(2) : '-'; }
  // fuel / energy
  function litres(v, d) { return v >= 0 ? v.toFixed(d) + ' L' : '--'; }
  function pct(v, d) { return v >= 0 ? (d ? v.toFixed(d) : String(Math.round(v))) + '%' : '--'; }
  function laps1(v) { return v > 0 ? v.toFixed(1) : '--'; }
  function levelColor(p, okColor, k) { k = k || { none: C.label, low: C.red, mid: C.yellow }; return !(p >= 0) ? k.none : (p < 15 ? k.low : (p < 30 ? k.mid : okColor)); }
  // per-lap use: the 5-lap average, else the live estimate marked with ~
  function perLap(u, unit) {
    if (!u) return '--';
    if (u.avg > 0) return unit === 'L' ? u.avg.toFixed(2) + ' L' : u.avg.toFixed(2) + '%';
    if (u.live > 0) return '~' + (unit === 'L' ? u.live.toFixed(2) + ' L' : u.live.toFixed(2) + '%');
    return '--';
  }
  function raceLaps(v) { return v > 0 ? 'RACE: ~' + v.toFixed(1) + ' LAPS LEFT' : ''; }
  // damage: dent severity 0 none, 1 light, 2 heavy, 3 = detached part
  function dentColor(s, k) { k = k || { none: C.dmgOk, light: C.dmgLight, heavy: C.red, detached: C.purple }; return !(s > 0) ? k.none : (s <= 1 ? k.light : (s <= 2 ? k.heavy : k.detached)); }
  function wheelColor(w, k) { k = k || { ok: C.noData, flat: C.blue, detached: C.purple }; return !w ? k.ok : (w.detached ? k.detached : ((w.flat || (w.pressure >= 0 && w.pressure <= 1)) ? k.flat : k.ok)); }
  function condColor(v, k) { k = k || { none: C.label, good: C.green, fair: C.yellow, bad: C.red }; return !(v >= 0) ? k.none : (v >= 0.9 ? k.good : (v >= 0.6 ? k.fair : k.bad)); }
  // track
  function weatherText(raining, wet) { return raining > 0 ? 'RAIN' : (wet > 0.05 ? 'WET ' + Math.round(wet * 100) + '%' : 'DRY'); }
  // the track's wetness in words (wet = the game's average wetness of the racing line 0..1): DRY, DAMP, SLIGHTLY WET, WET, VERY WET, FLOODED
  function trackWet(raining, wet) {
    if (!(wet >= 0)) return '--';
    var w = wet < 0.02 ? 'DRY' : (wet < 0.1 ? 'DAMP' : (wet < 0.3 ? 'SLIGHTLY WET' : (wet < 0.6 ? 'WET' : (wet < 0.85 ? 'VERY WET' : 'FLOODED'))));
    return w === 'DRY' || wet < 0.02 ? w : w + ' ' + Math.round(wet * 100) + '%';
  }
  function weatherColor(raining, wet, k) { k = k || { wet: C.blue, dry: C.green }; return (raining > 0 || wet > 0.05) ? k.wet : k.dry; }
  function temp1(t, unit) { return has(t) && isFinite(t) ? toUnit(t, unit).toFixed(1) + ' \u00B0' : '--'; }
  function hhmm(h, m, h12) { if (h12) { var ap = h < 12 ? ' AM' : ' PM'; h = h % 12 || 12; return h + ':' + pad(m, 2) + ap; } return pad(h, 2) + ':' + pad(m, 2); }
  // the game's time of day: hours (0..24) or seconds since midnight - the unit is not verified, both are read
  function timeOfDay(v) {
    if (!(v >= 0)) return '';
    var s = v <= 24 ? v * 3600 : v; s = Math.floor(s) % 86400;
    return 'GAME ' + hhmm(Math.floor(s / 3600), Math.floor((s % 3600) / 60));
  }
  // forecast rows: NOW + the next points. Points start at 0/20/40/60/80 % of the session; row k shows point cur+k, labelled with the minutes until it starts.
  function forecastRows(nodes, length, elapsed) {
    var rows = [], known = length > 0 && elapsed >= 0, cur = known ? Math.min(4, Math.floor(elapsed / (length * 0.2))) : 0;
    for (var k = 0; k < 5; k++) {
      var idx = cur + k, n = nodes && idx <= 4 ? nodes[idx] : null;
      var ok = !!n && (n.sky >= 0 || has(n.temp) || has(n.rain)), mins = known ? Math.floor((0.2 * idx * length - elapsed) / 60) : -1;
      rows.push({ show: ok && (k === 0 || mins > 0 || !known), label: k === 0 ? 'NOW' : (mins > 0 ? '+' + mins + 'm' : Math.round(idx * 20) + '%'),
                  icon: ok && n.sky >= 0 ? 'wx_' + Math.round(n.sky) : 'wx_na', sky: ok && n.sky >= 0 ? Math.round(n.sky) : -1, rain: ok && has(n.rain) ? Math.round(n.rain) + '%' : '--',
                  rainW: ok && has(n.rain) ? Math.max(0, Math.min(100, n.rain)) / 100 : 0, temp: ok && has(n.temp) ? Math.round(n.temp) + '°' : '--', tempC: ok && has(n.temp) ? n.temp : null });
    }
    return rows;
  }
  // the track condition widget: how warm the road / the air is (cold, good, warm, hot) and the wetness of the racing line as a word + %
  function tempBand(t, kind) {
    if (!has(t) || !isFinite(t)) return 'none';
    var b = kind === 'air' ? [10, 28, 35] : [20, 40, 50];
    return t < b[0] ? 'cold' : t < b[1] ? 'good' : t < b[2] ? 'warm' : 'hot';
  }
  function surface(wet) {
    if (!(wet >= 0)) return { word: '--', pct: '', band: 'none' };
    var word = wet < 0.02 ? 'DRY' : wet < 0.1 ? 'DAMP' : wet < 0.3 ? 'SLIGHTLY WET' : wet < 0.6 ? 'WET' : wet < 0.85 ? 'VERY WET' : 'FLOODED';
    return { word: word, pct: Math.round(wet * 100) + '%', band: wet < 0.02 ? 'dry' : wet < 0.1 ? 'damp' : 'wet' };
  }
  // the weather cards: the game's sky (0..10) in words, and which 'splash art' its card gets (clear, cloudy, overcast, rain, heavy, storm, none)
  var SKY = ['CLEAR', 'MOSTLY CLEAR', 'PARTLY CLOUDY', 'MOSTLY CLOUDY', 'OVERCAST', 'DRIZZLE', 'LIGHT RAIN', 'RAIN', 'HEAVY RAIN', 'DOWNPOUR', 'STORM'];
  function skyName(s) { return s >= 0 && s <= 10 ? SKY[Math.round(s)] : '--'; }
  function skyArt(s) { return !(s >= 0 && s <= 10) ? 'none' : s < 1 ? 'clear' : s < 4 ? 'cloudy' : s < 5 ? 'overcast' : s < 8 ? 'rain' : s < 10 ? 'heavy' : 'storm'; }
  // Race Pace page: time over a reference (+0.412), % over a reference (ratio 1.0123 -> +1.23%), consistency (± 0.456s), date (Oct 25, 2026), counts (12,345)
  function plusSec(d) { return has(d) && isFinite(d) ? diff(d, 3) : '--'; }
  function pctOver(r) { return r > 0 && isFinite(r) ? diff((r - 1) * 100, 2) + '%' : '--'; }
  // Untapped potential: a difference of two ratios in % points (0.0123 -> '+1.23%'); metres round the lap as km ('1.25 km')
  function pctPts(d) { return has(d) && isFinite(d) ? diff(d * 100, 2) + '%' : '--'; }
  function km(m) { return m >= 0 && isFinite(m) ? (m / 1000).toFixed(2) + ' km' : '--'; }
  function spread(s) { return s > 0 ? '± ' + s.toFixed(3) + 's' : '--'; }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(unix) { if (!(unix > 0)) return '--'; var d = new Date(unix * 1000); return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  // Strategy page: a real clock time (ms) -> "Sat 14:05"; a duration (s) -> "5:12" (h:mm)
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function wallClock(ms) { if (!isFinite(ms)) return '--'; var d = new Date(ms); return DAYS[d.getDay()] + ' ' + hhmm(d.getHours(), d.getMinutes()); }
  function hm(sec) { if (!(sec >= 0)) return '--'; var m = Math.round(sec / 60); return Math.floor(m / 60) + ':' + pad(m % 60, 2); }
  function count(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  // Relative widget: road gap of a car (+1.4 ahead / -2.1 behind, '' = you, '--' = no lap time yet); laps up / down in the race ('+1L' / '-2L', '' = same lap)
  function relGap(r) { return !r || r.me ? '' : (r.hasGap ? (r.gap > 0 ? '+' : (r.gap < 0 ? '-' : '')) + Math.abs(r.gap).toFixed(1) : '--'); }
  function relLaps(n) { return n > 0 ? '+' + n + 'L' : (n < 0 ? n + 'L' : ''); }
  // Prediction widget: predicted gap to you at the finish (+19.4 / -3.0 / +1L), stops still needed, places won / lost (▲2 / ▼1)
  function predGap(r) { return !r || r.me ? '' : (r.laps ? relLaps(r.laps) : (r.gap > 0 ? '+' : (r.gap < 0 ? '-' : '')) + Math.abs(r.gap).toFixed(1)); }
  function stops(n) { return !(n >= 0) ? '--' : (n === 0 ? 'no stop' : n + (n === 1 ? ' stop' : ' stops')); }
  function posMove(now, pred) { return !(now > 0 && pred > 0) || now === pred ? '' : (pred < now ? '▲' + (now - pred) : '▼' + (pred - now)); }

  P.format = { lap: lap, sector: sector, gapText: gapText, cardGapText: cardGapText, delta: delta, ve: ve, clock: clock, colors: C, colorDefaults: DEFAULTS,
               veColor: veColor, tyreColor: tyreColor, bestColor: bestColor, lastColor: lastColor, deltaColor: deltaColor, sectorColor: sectorColor,
               hms: hms, sessionName: sessionName, diff: diff, liveDelta: liveDelta, lapsLeft: lapsLeft, diffColor: diffColor, sectorBoxColor: sectorBoxColor,
               tyreTempColor: tyreTempColor, pressure: pressure, brakeTempColor: brakeTempColor, deg: deg, wear: wear, psi: psi, compound: compound, compoundColor: compoundColor,
               level: level, bias: bias, litres: litres, pct: pct, laps1: laps1, levelColor: levelColor, perLap: perLap, raceLaps: raceLaps,
               dentColor: dentColor, wheelColor: wheelColor, condColor: condColor, weatherText: weatherText, trackWet: trackWet, weatherColor: weatherColor, temp1: temp1,
               hhmm: hhmm, timeOfDay: timeOfDay, forecastRows: forecastRows, plusSec: plusSec, pctOver: pctOver, pctPts: pctPts, km: km, spread: spread, day: day, count: count, wallClock: wallClock, hm: hm,
               relGap: relGap, penalty: penalty, skyName: skyName, skyArt: skyArt, tempBand: tempBand, surface: surface, relLaps: relLaps, predGap: predGap, stops: stops, posMove: posMove };
  if (typeof module !== 'undefined') module.exports = P.format;
})(typeof window !== 'undefined' ? window : globalThis);
