// Relative: as the game's HUD relative - the cars just ahead of and behind the focus car ON THE ROAD (any class, any position), with the time gap.
// Shows who is about to catch you (a faster class coming up from behind) and who you are about to catch. Data: state.rel (Relative.cs), ordered from
// the car furthest ahead to the car furthest behind; gap + = ahead on the road, - = behind. Laps: race only, + = a lap or more ahead of you in the race.
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, F = P.format, D = P.dom;
  var X = 0, Y = 0, W = 245, H = 150;
  var T = P.panelWidget('relative', 'Relative', X, Y, W, H, 'accent', [
    ['labels', 'Title', 'label'], ['driver', 'Car on the same lap', 'white'], ['lapping', 'Car laps ahead of you (race)', 'red'], ['lapped', 'Car laps behind you (race)', 'blue'],
    ['pit', 'Car in the pits', 'dim'], ['me', 'You', 'focusMark'], ['meBg', 'Your row background', 'focusMark'], ['pos', 'Class position', 'label'], ['gap', 'Gap', 'white'],
    ['clsHyper', 'Class: Hypercar', 'red'], ['clsLmp2', 'Class: LMP2', 'blue'], ['clsLmp3', 'Class: LMP3', 'purple'], ['clsGt3', 'Class: GT3', 'green'], ['clsGte', 'Class: GTE', 'yellow'], ['clsOther', 'Class: other', 'accent']],
    [{ key: 'each', label: 'Cars ahead / behind', type: 'number', def: 3, min: 1, max: 6 }, ['pits', 'Cars in the pits'], ['laps', 'Laps up / down (race)']],
  function (k, e, K) {
    var each = Math.max(1, Math.min(6, Math.round(k.opt('each', 3)))), n = each * 2 + 1, top = Y + 22, rh = (H - 26) / n;
    var font = Math.min(26, Math.round(k.u(rh) * 0.56));
    var CLS = [[/hyper/, K.clsHyper], [/lmp2|elms/, K.clsLmp2], [/lmp3/, K.clsLmp3], [/gt3/, K.clsGt3], [/gte/, K.clsGte]];
    function clsColor(c) { var s = String(c || '').toLowerCase(); for (var i = 0; i < CLS.length; i++) if (CLS[i][0].test(s)) return CLS[i][1]; return K.clsOther; }
    k.txt(X + 9, Y + 5, 150, 14, 15, 600, 'left', K.labels, 'RELATIVE');
    e.msg = k.txt(X + 9, Y + 5, W - 18, 14, 14, 600, 'right', K.labels);
    e.rows = [];
    for (var j = 0; j < n; j++) {
      var y = top + j * rh, o = {};
      if (j === each) { o.bg = k.rect(X + 4, y, W - 8, rh, K.meBg); o.bg.style.opacity = '.18'; o.bg.style.borderRadius = '4px'; }
      o.bar = k.rect(X + 6, y + rh * 0.18, 2.4, rh * 0.64);
      o.pos = k.txt(X + 11, y, 24, rh, font, 700, 'left', K.pos);
      o.name = k.txt(X + 36, y, 140, rh, font, 600, 'left', K.driver); o.name.style.whiteSpace = 'nowrap'; o.name.style.overflow = 'hidden'; o.name.style.textOverflow = 'ellipsis';
      o.laps = k.txt(X + 176, y, 24, rh, Math.round(font * 0.8), 700, 'right', K.labels);
      o.gap = k.txt(X + 200, y, 39, rh, font, 700, 'right', K.gap);
      e.rows.push(o);
    }
    var pits = k.show('pits'), laps = k.show('laps');
    return function (state) {
      var list = (state.rel || []).filter(function (r) { return r.me || pits || !r.pit; }), me = -1;
      for (var i = 0; i < list.length; i++) if (list[i].me) { me = i; break; }
      D.text(e.msg, me < 0 ? (state.rel ? 'No car to follow' : 'Waiting for the game') : '');
      for (var j = 0; j < n; j++) {
        var o = e.rows[j], r = me < 0 ? null : list[me - each + j], on = !!r;
        [o.bar, o.pos, o.name, o.laps, o.gap].forEach(function (x) { D.show(x, on); });
        if (!r) continue;
        var c = r.me ? K.me : (r.pit ? K.pit : (r.laps > 0 ? K.lapping : (r.laps < 0 ? K.lapped : K.driver)));
        D.bg(o.bar, clsColor(r.cls));
        D.text(o.pos, r.classPos > 0 ? 'P' + r.classPos : '');
        D.text(o.name, (r.pit ? 'PIT ' : '') + r.driver); D.color(o.name, c);
        D.text(o.laps, laps ? F.relLaps(r.laps) : ''); D.color(o.laps, c);
        D.text(o.gap, F.relGap(r)); D.color(o.gap, r.me ? K.me : K.gap);
      }
    };
  });
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
