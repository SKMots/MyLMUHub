// Race Pace reference times: Ohne Speed's LMU laptimes spreadsheet ("Laptimes" tab, CSV from api/reference). Per track and class:
// hot = the alien hotlap / qualifying time ("Class avgW"), race = race-pace times for ~100 %, 101 % .. 107 % (race[0] = 100 % = the alien race pace).
// The sheet's categories ("IF consistent"): ~100 % Alien, 101 % Competitive, 102-103 % Good, 104-105 % Midpack, 106 % Tail-ender, 107 % Offline.
// Here a pace falls in the category of the nearest column: Alien up to 100.5 %, Competitive up to 101.5 %, Good up to 103.5 %, Midpack up to 105.5 %,
// Tail-ender up to 106.5 %, Offline above. Pure functions (tests/js/pace-ref.test.js).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};

  function csvRows(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  // "1:58.50" / "58.5" -> seconds, else null
  function secs(s) {
    var m = /^\s*(?:(\d+):)?(\d{1,2}(?:\.\d+)?)\s*$/.exec(s || '');
    if (!m) return null;
    var v = Math.round(((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])) * 1000) / 1000;
    return v > 0 ? v : null;
  }
  // game versions: the sheet's "Patch" ("1.4+" = times driven on 1.4 and later) and a session's version (1.42) compared by major version (1.4)
  function patch(s) { var m = /(\d+\.\d+)/.exec(s || ''); return m ? Number(m[1]) : null; }
  function major(v) { return v > 0 ? Math.floor(v * 10 + 1e-6) / 10 : null; }
  // a session is old when its major version is below the sheet's patch for that track + class (else below the newest major version you drove: current)
  function isOld(version, sheetPatch, current) {
    var m = major(version), limit = sheetPatch || current;
    return m !== null && limit > 0 && m < limit - 1e-9;
  }
  // the sheet -> { track: { class: { hot, race: [8 times], car, patch } } }
  function parse(csv) {
    var out = {};
    csvRows(csv || '').forEach(function (r) {
      var track = (r[1] || '').trim(), key = r[0] || '';
      if (!track || track === 'Track' || key.indexOf(track) !== 0) return;
      var cls = key.slice(track.length).trim(), race = [];
      for (var i = 4; i <= 11; i++) race.push(secs(r[i]));
      if (!cls || !race[0]) return;
      (out[track] = out[track] || {})[cls] = { hot: secs(r[3]), race: race, car: (r[12] || '').trim(), patch: patch(r[2]) };
    });
    return out;
  }

  // a results file's track (course name + layout file) -> the sheet's track name, null = not in the sheet
  var RULES = [
    [/bahrain/, [[/outer/, 'Bahrain (outer)'], [/paddock/, 'Bahrain (paddock)'], [/endurance/, 'Bahrain (endurance)']], 'Bahrain (wec)'],
    [/barcelona|catalunya/, [], 'Barcelona'],
    [/sarthe|le ?mans/, [[/straight|mulsanne|nochicane/, 'Circuit de la Sarthe (straight)']], 'Circuit de la Sarthe'],
    [/americas|cota/, [[/national/, 'COTA (national)']], 'COTA'],
    [/daytona/, [], 'Daytona'],
    [/fuji/, [[/classic|nochicane/, 'Fuji (classic)']], 'Fuji (chicane)'],
    [/imola|enzo e dino/, [], 'Imola'],
    [/interlagos|carlos pace/, [], 'Interlagos'],
    [/laguna/, [], 'Laguna Seca'],
    [/long beach/, [], 'Long Beach'],
    [/monza/, [[/grande/, 'Monza (curvagrande)']], 'Monza'],
    [/ricard|castellet/, [[/1a.?v2.*short|1av2short/, 'Paul Ricard (1A v2 short)'], [/1a.?v2/, 'Paul Ricard (1A v2)'], [/1a/, 'Paul Ricard (1A)'], [/3a/, 'Paul Ricard (3A)']], 'Paul Ricard'],
    [/portim|algarve/, [], 'Portimao'],
    [/qatar|lusail/, [[/short/, 'Qatar (short)']], 'Qatar'],
    [/road atlanta/, [], 'Road Atlanta'],
    [/silverstone/, [[/national/, 'Silverstone (National)'], [/international/, 'Silverstone (International)']], 'Silverstone (GP)'],
    [/sebring/, [[/school/, 'Sebring (school)']], 'Sebring'],
    [/\bspa\b|francorchamps/, [], 'Spa']
  ];
  function trackName(course, layout) {
    var s = ((course || '') + ' ' + (layout || '')).toLowerCase();
    for (var i = 0; i < RULES.length; i++) {
      if (!RULES[i][0].test(s)) continue;
      for (var j = 0; j < RULES[i][1].length; j++) if (RULES[i][1][j][0].test(s)) return RULES[i][1][j][1];
      return RULES[i][2];
    }
    return null;
  }
  // the results files' class -> the sheet's
  var CLASSES = { GT3: 'LMGT3', LMGT3: 'LMGT3', HYPER: 'LMH', HYPERCAR: 'LMH', LMH: 'LMH', LMP2: 'LMP2wec', LMP2_ELMS: 'LMP2elms', LMP3: 'LMP3', GTE: 'GTE' };
  function className(cls) { return CLASSES[String(cls || '').toUpperCase()] || null; }
  function lookup(table, course, layout, cls) {
    var t = table && table[trackName(course, layout)], c = className(cls);
    return t && c ? t[c] || null : null;
  }

  // [name, upper limit, colour]. Colours = the sheet's own column colours (100 % white, 101 % blue, 103 % green, 104 % yellow, 106 % red, 107 % dark red), brighter for a dark page
  var BANDS = [['Alien', 1.005, '#FFFFFF'], ['Competitive', 1.015, '#8AB4F8'], ['Good', 1.035, '#93D07E'], ['Midpack', 1.055, '#FFD966'], ['Tail-ender', 1.065, '#EA8A8A'], ['Offline', Infinity, '#D7705C']];
  // the sheet's colour of each column 100 % .. 107 %
  var COLUMN_COLORS = ['#FFFFFF', '#8AB4F8', '#7FC4D0', '#93D07E', '#FFD966', '#F6B26B', '#EA8A8A', '#D7705C'];
  // ratio (your time / the 100 % time) -> { name, index, color } (null ratio -> null)
  function category(ratio) {
    if (!(ratio > 0)) return null;
    for (var i = 0; i < BANDS.length; i++) if (ratio <= BANDS[i][1]) return { name: BANDS[i][0], index: i, color: BANDS[i][2] };
    return null;
  }
  // every layout is its own track: key = the sheet's track name (else the course name) + the layout file; label = the layout file in words (layoutSpaELMS -> Spa ELMS)
  function layoutLabel(layout) { return String(layout || '').replace(/^layout/i, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').trim(); }
  // the layout's name next to its track's name: the track's own words left out (Spa + layoutSpaELMS -> ELMS), nothing left = standard
  var WORDS = { End: 'Endurance' };
  function variantLabel(track, layout) {
    var own = String(track || '').toLowerCase().split(/[^a-z0-9]+/);
    var rest = layoutLabel(layout).split(' ').filter(function (w) { return w && own.indexOf(w.toLowerCase()) < 0; }).map(function (w) { return WORDS[w] || w; });
    return rest.length ? rest.join(' ') : 'standard';
  }
  function trackKey(course, layout) { return (trackName(course, layout) || course || '') + (layout ? ' | ' + layout : ''); }

  P.paceRef = { parse: parse, secs: secs, trackName: trackName, className: className, lookup: lookup, category: category, BANDS: BANDS, COLUMN_COLORS: COLUMN_COLORS,
                layoutLabel: layoutLabel, variantLabel: variantLabel, trackKey: trackKey, major: major, isOld: isOld, csvRows: csvRows };
  if (typeof module !== 'undefined') module.exports = P.paceRef;
})(typeof window !== 'undefined' ? window : globalThis);
