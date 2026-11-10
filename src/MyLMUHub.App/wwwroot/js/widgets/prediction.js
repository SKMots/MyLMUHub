// Prediction: where your class finishes if everybody keeps their race pace and makes the stops their VE / fuel needs (Prediction.cs). Top: your position now
// -> predicted, stops you still need; rows: the cars around you in PREDICTED order with places won / lost, their stops and the predicted gap to you at the
// finish. Dimmed = not enough laps seen yet for that car. Data: state.pred (PredictionView). Accidents and safety cars cannot be predicted.
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, F = P.format, D = P.dom;
  var X = 0, Y = 0, W = 245, H = 160;
  var T = P.panelWidget('prediction', 'Prediction', X, Y, W, H, 'purple', [
    ['labels', 'Titles', 'label'], ['big', 'Your position', 'white'], ['better', 'Gaining places', 'green'], ['worse', 'Losing places', 'red'],
    ['driver', 'Drivers', 'white'], ['me', 'You', 'focusMark'], ['meBg', 'Your row background', 'focusMark'], ['pos', 'Positions', 'label'], ['gap', 'Gap', 'white'], ['info', 'Notes', 'muted']],
    [{ key: 'each', label: 'Cars ahead / behind', type: 'number', def: 3, min: 1, max: 6 }, ['stops', 'Stops still needed'], ['move', 'Places won / lost']],
  function (k, e, K) {
    var each = Math.max(1, Math.min(6, Math.round(k.opt('each', 3)))), n = each * 2 + 1, top = Y + 38, rh = (H - 42) / n;
    var font = Math.min(24, Math.round(k.u(rh) * 0.55)), small = Math.round(font * 0.8), showStops = k.show('stops'), showMove = k.show('move');
    k.txt(X + 9, Y + 5, 120, 14, 15, 600, 'left', K.labels, 'PREDICTION');
    e.info = k.txt(X + 100, Y + 5, W - 109, 14, 13, 600, 'right', K.info);
    e.big = k.txt(X + 9, Y + 19, 120, 18, 28, 800, 'left', K.big);
    e.mine = k.txt(X + 130, Y + 19, W - 139, 18, 18, 700, 'right', K.labels);
    e.rows = [];
    for (var j = 0; j < n; j++) {
      var y = top + j * rh, o = {};
      if (j === each) { o.bg = k.rect(X + 4, y, W - 8, rh, K.meBg); o.bg.style.opacity = '.18'; o.bg.style.borderRadius = '4px'; }
      o.pos = k.txt(X + 9, y, 24, rh, font, 700, 'left', K.pos);
      o.move = k.txt(X + 33, y, 22, rh, small, 700, 'left', K.better);
      o.name = k.txt(X + 56, y, 108, rh, font, 600, 'left', K.driver); o.name.style.whiteSpace = 'nowrap'; o.name.style.overflow = 'hidden'; o.name.style.textOverflow = 'ellipsis';
      o.stops = k.txt(X + 164, y, 38, rh, small, 600, 'right', K.labels);
      o.gap = k.txt(X + 202, y, 37, rh, font, 700, 'right', K.gap);
      e.rows.push(o);
    }
    var WHY = { race: 'Race sessions only', length: 'Race length unknown', car: 'No car to follow' };
    return function (state) {
      var v = state.pred;
      if (!v || !v.has) {
        D.text(e.info, ''); D.text(e.big, '--'); D.color(e.big, K.big); D.text(e.mine, !v ? 'Waiting for the game' : (WHY[v.why] || ''));
        e.rows.forEach(function (o) { [o.pos, o.move, o.name, o.stops, o.gap].forEach(function (x) { D.show(x, false); }); });
        return;
      }
      D.text(e.info, (v.remaining >= 0 ? F.hms(v.remaining) + ' left' : (v.lapsLeft >= 0 ? v.lapsLeft + ' laps left' : '')) + ' · stop ' + Math.round(v.pitLoss) + ' s' + (v.pitLossLearned ? '' : ' (est.)'));
      D.text(e.big, 'P' + v.myPos + ' → P' + v.myPred); D.color(e.big, v.myPred < v.myPos ? K.better : (v.myPred > v.myPos ? K.worse : K.big));
      D.text(e.mine, F.stops(v.myStops) + ' left');
      var me = 0; for (var i = 0; i < v.rows.length; i++) if (v.rows[i].me) { me = i; break; }
      for (var j = 0; j < n; j++) {
        var o = e.rows[j], r = v.rows[me - each + j], on = !!r;
        [o.pos, o.move, o.name, o.stops, o.gap].forEach(function (x) { D.show(x, on); });
        if (!r) continue;
        var dim = r.sure || r.me ? '1' : '.6'; if (o.name._op !== dim) { [o.pos, o.name, o.stops, o.gap].forEach(function (x) { x.style.opacity = dim; }); o.name._op = dim; }
        D.text(o.pos, 'P' + r.predPos);
        var mv = showMove ? F.posMove(r.classPos, r.predPos) : ''; D.text(o.move, mv); D.color(o.move, r.predPos < r.classPos ? K.better : K.worse);
        D.text(o.name, (r.pit ? 'PIT ' : '') + r.driver); D.color(o.name, r.me ? K.me : K.driver);
        D.text(o.stops, showStops ? F.stops(r.stops) : '');
        D.text(o.gap, F.predGap(r)); D.color(o.gap, r.me ? K.me : K.gap);
      }
    };
  });
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
