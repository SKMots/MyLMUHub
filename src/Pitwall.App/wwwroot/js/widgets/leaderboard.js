// Leaderboard widget: 13 rows of ONE class (P1 on top, the focus car in the middle). Same look and columns as the SimHub dashboard.
// Base size = the SimHub panel (752 x 397 design units, scale 2.025 -> 2560x1440 pixels).
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format, D = P.dom;
  var S = 2.025, BASE_W = Math.round(752 * S), BASE_H = Math.round(397 * S);   // 1523 x 804
  var ROWS = 13, ROW0 = Math.round(42 * S), STEP = 27.2 * S, ROWH = Math.round(26 * S);
  // key, x, width, align, font px, weight, header label
  var COLS = [['pos', 12, 57, 'left', 22, 700, 'POS'], ['logo', 75, 40, 'center', 0, 0, ''], ['name', 126, 223, 'left', 22, 600, 'DRIVER'],
    ['tyre', 353, 49, 'center', 22, 700, 'T'], ['ve', 405, 81, 'right', 20, 700, 'VE %'], ['s1', 494, 89, 'right', 18, 600, 'S1'], ['s2', 592, 89, 'right', 18, 600, 'S2'],
    ['s3', 689, 89, 'right', 18, 600, 'S3'], ['best', 786, 126, 'right', 21, 600, 'BEST'], ['last', 920, 126, 'right', 21, 600, 'LAST'], ['avg', 1053, 126, 'right', 21, 600, '5 AVG'],
    ['pit', 1187, 61, 'center', 17, 700, 'PIT'], ['lap', 1252, 57, 'right', 22, 600, 'LAP'], ['int', 1316, 89, 'right', 20, 700, 'INT'], ['dlt', 1414, 93, 'right', 20, 600, 'Δ']];
  // this widget's colour parts: key, name in the editor, theme colour it starts from
  var SL = P.colorSlots('leaderboard', [
    ['bg', 'Background', 'panel'], ['border', 'Border', 'border'], ['header', 'Header text (class)', 'accent'], ['headerLine', 'Header line', 'accent'],
    ['colTitles', 'Column titles', 'label'], ['sepLine', 'Line under P1 (positions skipped)', 'accent'],
    ['focusRow', 'Your row: background', 'focusRow'], ['focusMark', 'Your row: marker', 'focusMark'], ['rowLine', 'Row divider', 'rowLine'],
    ['pos', 'Position', 'white'], ['name', 'Driver name', 'white'],
    ['tyreSoft', 'Tyre: soft', 'red'], ['tyreMedium', 'Tyre: medium', 'yellow'], ['tyreHard', 'Tyre: hard', 'tyreH'], ['tyreWet', 'Tyre: wet', 'blue'], ['tyreOther', 'Tyre: other', 'label'],
    ['ve', 'VE %', 've'], ['veMid', 'VE % under 30', 'yellow'], ['veLow', 'VE % under 15', 'red'], ['veNone', 'VE %: none', 'dim'],
    ['sector', 'Sector times', 'sector'], ['sectorNone', 'Sector: none yet', 'dim'],
    ['best', 'Best lap', 'white'], ['bestClass', 'Best lap: class best', 'purple'],
    ['last', 'Last lap', 'white'], ['lastOwn', 'Last lap: own best', 'green'], ['lastClass', 'Last lap: class best', 'purple'],
    ['avg', '5-lap average', 'muted'], ['pit', 'PIT', 'yellow'], ['laps', 'Laps', 'muted'], ['int', 'Gap (INT)', 'int'],
    ['chipHyper', 'Position chip: Hypercar', 'red'], ['chipLmp2', 'Position chip: LMP2', 'blue'], ['chipLmp3', 'Position chip: LMP3', 'purple'],
    ['chipGt3', 'Position chip: GT3', 'green'], ['chipGte', 'Position chip: GTE', 'yellow'], ['chipOther', 'Position chip: other class', 'accent'],
    ['chipYou', 'Position chip: you', 'focusMark'], ['chipText', 'Position chip: number', 'bg'],
    ['dltFaster', 'Δ: car was faster than you', 'red'], ['dltSlower', 'Δ: car was slower than you', 'green'], ['dltNone', 'Δ: none', 'label']]);
  var K = SL.K;
  var TYRE = { soft: K.tyreSoft, medium: K.tyreMedium, hard: K.tyreHard, wet: K.tyreWet, other: K.tyreOther }, VE = { none: K.veNone, low: K.veLow, mid: K.veMid, ok: K.ve };
  var SEC = { time: K.sector, none: K.sectorNone }, BEST = { classBest: K.bestClass, normal: K.best }, LAST = { classBest: K.lastClass, ownBest: K.lastOwn, normal: K.last };
  var DLT = { theyFaster: K.dltFaster, theySlower: K.dltSlower, none: K.dltNone };

  // the visible columns, closed up: each keeps the gap it had before it in the original layout. W = the width the board is then drawn at.
  function layoutCols(settings) {
    var out = [], end = 0;
    COLS.forEach(function (c, i) {
      if (FIXED.indexOf(c[0]) < 0 && !P.shown(settings, c[0])) return;
      var gap = i === 0 ? c[1] : c[1] - (COLS[i - 1][1] + COLS[i - 1][2]), x = out.length ? end + gap : c[1];
      out.push({ c: c, x: x }); end = x + c[2];
    });
    return { cols: out, W: end + (BASE_W - (COLS[COLS.length - 1][1] + COLS[COLS.length - 1][2])), lineW: end + 4 - 12 };
  }
  var FIXED = ['pos', 'name'];
  // the position chip colour of a class (theme detail 'Chips & badges', see theme.css)
  function chipFor(cls) {
    var s = String(cls || '').toLowerCase();
    return s.indexOf('hyper') >= 0 ? K.chipHyper : s.indexOf('lmp2') >= 0 ? K.chipLmp2 : s.indexOf('lmp3') >= 0 ? K.chipLmp3 : s.indexOf('gt3') >= 0 ? K.chipGt3 : s.indexOf('gte') >= 0 ? K.chipGte : K.chipOther;
  }
  function cssVar(e, n, v) { if (e.style.setProperty) e.style.setProperty(n, v); else e.style[n] = v; }
  // which rows to show. Standard = the app's 13 (P1 + a window around you, see DASHBOARD-SPEC). Custom = a window of 'ahead' + you + 'behind' cars with you
  // in the middle (+ P1 on top when wanted). Too close to the front for that: the window starts at the top and fills up with cars behind you (and at the
  // back with cars ahead), so the board keeps its size. When you ARE P1 the P1 row is your row: at P1 with 0 / 0 only you. No focus car: the first rows.
  function pickRows(st, o) {
    if (!o.custom || !st.all) return { rows: st.rows || [], sep: !!st.sep };
    var all = st.all, m = -1, n = o.ahead + 1 + o.behind;
    for (var i = 0; i < all.length; i++) if (all[i].focus) { m = i; break; }
    if (m < 0) return { rows: all.slice(0, (o.p1 ? 1 : 0) + n), sep: false };
    var p1row = o.p1 && m > 0, lowest = p1row ? 1 : 0;                              // P1 shown on its own row above the window
    var start = Math.max(lowest, m - o.ahead), end = Math.min(all.length - 1, start + n - 1);
    start = Math.max(lowest, end - n + 1);                                           // near the back: take more cars ahead
    var rows = (p1row ? [all[0]] : []).concat(all.slice(start, end + 1));
    return { rows: rows, sep: p1row && start > 1 };
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  // the board of another class (settings: Class): from standings.others, rows from P1 down; my class / 'mine' = the standings as they are; not there = { missing }
  function boardOf(st, cls) {
    if (!st || cls === 'mine' || norm(st['class']) === norm(cls)) return st;
    var o = (st.others || []).filter(function (b) { return norm(b['class']) === norm(cls); })[0];
    return o ? { 'class': o['class'], count: o.count, focusPos: 1, rows: o.rows.slice(0, ROWS), all: o.rows, sep: false } : { missing: true };
  }
  function heightOf(n) { return Math.round(ROW0 + (n - 1) * STEP + ROWH + 5); }
  // a box of w x h (canvas px) for a board drawn W wide: scale = the width (text as wide as the box), rows = what fits in the height (3 .. 60);
  // a box too flat for 3 rows: scaled to its height instead. h = the board's own height (design units) so its background fills the box
  function fitBoard(w, h, W) {
    var k = w / W, rows = Math.floor((h / k - ROW0 - ROWH - 1) / STEP) + 1;          // the 5 px under the last row may be squeezed to 1
    if (rows < 3) { rows = 3; k = h / heightOf(3); }
    rows = Math.min(rows, 60);
    return { k: k, rows: rows, h: Math.max(heightOf(rows), h / k) };
  }
  // n rows of the standard kind but any count: P1 on top + a window with you in the middle (more cars behind when it is even)
  function fillRows(n) { var a = Math.floor((n - 2) / 2); return { custom: true, p1: true, ahead: a, behind: n - 2 - a }; }

  function create(host, ctx) {
    var set = ctx && ctx.settings, L = layoutCols(set), W = L.W, LW = L.lineW;
    var RO = { custom: P.opt(set, 'rows', 'standard') === 'custom', ahead: P.opt(set, 'ahead', 3), behind: P.opt(set, 'behind', 3), p1: P.shown(set, 'p1') };
    var NR = RO.custom ? (RO.p1 ? 1 : 0) + RO.ahead + 1 + RO.behind : ROWS, H = heightOf(NR), zebra = P.shown(set, 'zebra'), last = null;
    var FILL = !RO.custom;                                                            // standard rows: the board fills its box (taller = more cars around you)
    var TS = P.opt(set, 'textSize', 100) / 100 * (P.textScale ? P.textScale() : 1), CLS = P.opt(set, 'cls', 'mine'), HIDE = P.shown(set, 'hideEmpty');
    var root_ = D.box('pw-lb', host, 0, 0, W, H); cssVar(root_, '--pw-chip-you', K.chipYou); cssVar(root_, '--pw-chip-text', K.chipText); root_.style.backgroundColor = K.bg; root_.style.borderColor = K.border;
    var head = D.box('pw-lb-head', root_, 32, 8, Math.min(900, W - 40), 40); head.style.fontSize = Math.round(24 * TS) + 'px'; head.style.fontWeight = '700'; head.style.color = K.header;
    var hline = D.box('pw-lb-line', root_, 12, 49, LW, 2.4); hline.style.backgroundColor = K.headerLine;
    if (!P.shown(set, 'header')) { D.show(head, false); D.show(hline, false); }
    if (P.shown(set, 'titles')) L.cols.forEach(function (o) {
      var c = o.c; if (!c[6]) return; var h = D.box('pw-lb-colh', root_, o.x, 53, c[2], 30); h.style.fontSize = Math.round(15 * TS) + 'px'; h.style.color = K.colTitles; h.style.textAlign = c[3]; h.textContent = c[6];
    });
    var rows = [];
    for (var i = 0; i < NR; i++) addRow(i);
    function addRow(i) {
      var top = ROW0 + i * STEP, r = { el: D.box('pw-lb-row', root_, 0, top, W, ROWH), cells: {} };
      r.bg = D.box('pw-lb-rowbg', r.el, 12, 0, LW, ROWH);
      r.mark = D.box('pw-lb-mark', r.el, 3, 0, 6, ROWH); r.mark.style.backgroundColor = K.focusMark;   // left of the position number (owner: it overlapped)
      r.line = D.box('pw-lb-rowline', r.el, 12, ROWH + 1, LW, 1); r.line.style.backgroundColor = K.rowLine;
      L.cols.forEach(function (o) {
        var c = o.c;
        if (c[0] === 'logo') { var im = D.el('img', 'pw-lb-logo', r.el); im.style.cssText = 'position:absolute;left:' + o.x + 'px;top:5px;width:40px;height:40px;object-fit:contain'; r.cells.logo = im; return; }
        var e = D.box('pw-lb-cell' + (c[0] === 'pos' ? ' pw-lb-pos' : (c[0] === 'tyre' ? ' pw-lb-tyre' : '')), r.el, o.x, 0, c[2], ROWH); var s = e.style;
        s.fontSize = Math.round(c[4] * TS) + 'px'; s.fontWeight = c[5]; s.textAlign = c[3]; s.lineHeight = ROWH + 'px'; r.cells[c[0]] = e;
      });
      r.zebra = zebra && (i % 2 === 1); rows.push(r);
      if (sep && sep.parentNode) root_.appendChild(sep);                             // the separator line stays on top of the rows
    }
    var sep = null;
    sep = D.box('pw-lb-sep', root_, 12, Math.round(68 * S), LW, 3); sep.style.backgroundColor = K.sepLine;
    function cell(e, t, color) { if (!e) return; D.text(e, t); D.color(e, color); }                   // a hidden column has no cell

    function update(state) {
      last = state; var st = boardOf(state.standings, CLS);
      if (st && st.missing) { D.show(root_, !HIDE); D.text(head, 'NO ' + String(CLS).toUpperCase() + ' CARS'); D.show(sep, false); rows.forEach(function (r) { D.show(r.el, false); }); return; }
      D.show(root_, true);
      if (!st) { D.text(head, 'WAITING FOR DATA'); D.show(sep, false); rows.forEach(function (r) { D.show(r.el, false); }); return; }   // no game: the empty board
      D.text(head, String(st['class'] || '').toUpperCase() + ' - ' + st.count + ' DRIVERS' + (st.focusPos > 0 ? '' : ' - SET FOCUS NAME'));
      var pick = pickRows(st, FILL && NR !== ROWS ? fillRows(NR) : RO), chip = chipFor(st['class']); D.show(sep, pick.sep);
      if (root_._chip !== chip) { cssVar(root_, '--pw-chip', chip); root_._chip = chip; }
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i], d = i < NR ? pick.rows[i] : null;
        if (!d) { D.show(r.el, false); continue; }
        D.show(r.el, true); var rc = 'pw-lb-row' + (d.focus ? ' me' : ''); if (r.el.className !== rc) r.el.className = rc;
        D.bg(r.bg, d.focus ? K.focusRow : (r.zebra ? 'rgba(110,146,214,0.04)' : 'rgba(0,0,0,0)')); D.show(r.mark, !!d.focus);
        var c = r.cells;
        cell(c.pos, String(d.classPos), K.pos);
        if (c.logo) D.src(c.logo, P.brands.logoSrc(d.model, d.entry));
        cell(c.name, d.driver, K.name);
        cell(c.tyre, d.tyre, F.tyreColor(d.tyre, TYRE));
        cell(c.ve, F.ve(d.ve), F.veColor(d.ve, VE));
        cell(c.s1, F.sector(d.s1), F.sectorColor(d.s1, SEC));
        cell(c.s2, F.sector(d.s2), F.sectorColor(d.s2, SEC));
        cell(c.s3, F.sector(d.s3), F.sectorColor(d.s3, SEC));
        cell(c.best, F.lap(d.best), F.bestColor(d.bestFlag, BEST));
        cell(c.last, F.lap(d.last), F.lastColor(d.lastFlag, LAST));
        cell(c.avg, F.lap(d.avg), K.avg);
        cell(c.pit, d.pit ? 'PIT' : '', K.pit);
        cell(c.lap, String(d.laps), K.laps);
        cell(c.int, F.gapText(d.gap, d.focus), K.int);
        cell(c.dlt, F.delta(d.delta), F.deltaColor(d.delta.flag, DLT));
      }
    }
    // standard rows: the width sets the size of the text, the height how many rows (at least 3); custom rows: the board keeps its shape and scales to fit
    function resize(w, h) {
      var k = P.layoutMath.fitScale(w, h, W, H), bh = H;
      if (FILL && w > 0 && h > 0) {
        var f = fitBoard(w, h, W); k = f.k; bh = f.h;
        for (var i = rows.length; i < f.rows; i++) addRow(i);
        if (f.rows !== NR) { NR = f.rows; if (last) update(last); }
      }
      root_.style.height = Math.round(bh) + 'px'; root_.style.transform = 'scale(' + k + ')'; root_.style.transformOrigin = '0 0';
    }
    return { update: update, resize: resize, destroy: function () { if (root_.parentNode) root_.parentNode.removeChild(root_); }, size: { w: W, h: H },
             _rows: rows, _head: head, _sep: sep };
  }
  P.registerWidget({ type: 'leaderboard', title: 'Leaderboard', base: { w: BASE_W, h: BASE_H }, create: create, colors: SL.list,
    options: [{ key: 'cls', label: 'Class', type: 'select', def: 'mine', choices: [['mine', 'My class (the car I follow)'], ['Hyper', 'Hypercar'], ['LMP2', 'LMP2'], ['LMP2_ELMS', 'LMP2 ELMS'], ['LMP3', 'LMP3'], ['GT3', 'GT3'], ['GTE', 'GTE']] },
      { key: 'hideEmpty', label: 'Hide when that class is not in the session' },
      { key: 'textSize', label: 'Text size (%)', type: 'number', def: 100, min: 60, max: 160 },
      { key: 'rows', label: 'Rows', type: 'select', def: 'standard', choices: [['standard', 'Standard: P1 + 12 around you'], ['custom', 'Custom (below)']] },
      { key: 'ahead', label: 'Custom: cars ahead of you', type: 'number', def: 3, min: 0, max: 15 }, { key: 'behind', label: 'Custom: cars behind you', type: 'number', def: 3, min: 0, max: 15 },
      { key: 'p1', label: 'Custom: always show P1' }, { key: 'zebra', label: 'Zebra stripes' }].concat([['header', 'Class header'], ['titles', 'Column titles'], ['logo', 'Brand logo'], ['tyre', 'Tyre (T)'], ['ve', 'Virtual energy (VE %)'],
      ['s1', 'Sector 1'], ['s2', 'Sector 2'], ['s3', 'Sector 3'], ['best', 'Best lap'], ['last', 'Last lap'], ['avg', '5-lap average'], ['pit', 'PIT'],
      ['lap', 'Laps'], ['int', 'Gap (INT)'], ['dlt', 'Δ last lap vs you']].map(function (o) { return { key: o[0], label: o[1] }; })) });
  if (typeof module !== 'undefined') module.exports = { pickRows: pickRows, boardOf: boardOf, fitBoard: fitBoard, fillRows: fillRows, heightOf: heightOf, COLS: COLS, ROWS: ROWS, BASE_W: BASE_W, BASE_H: BASE_H, K: K };
})(typeof window !== 'undefined' ? window : globalThis);
