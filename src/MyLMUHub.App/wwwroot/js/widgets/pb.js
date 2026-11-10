// Best lap ever: YOUR best lap on this track in this car class, any car of it (result files + the laps you drive now; a team-mate's laps never count,
// see PersonalBest.cs).
// Shows the lap, its sectors, when it was set, your best this session and your last lap with the difference. Data: state.pb (PbView).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, F = P.format, D = P.dom;
  var X = 0, Y = 0, W = 245, H = 120;
  var T = P.panelWidget('pb', 'Best lap ever', X, Y, W, H, 'purple', [
    ['labels', 'Titles', 'label'], ['lap', 'Best lap', 'purple'], ['sectors', 'Sectors', 'sector'], ['info', 'When it was set', 'muted'],
    ['values', 'This session / last lap', 'white'], ['faster', 'Faster than the best', 'green'], ['slower', 'Slower than the best', 'red'], ['newTag', 'NEW tag', 'green']],
    [['sectors', 'Sectors'], ['when', 'When it was set'], ['session', 'Best this session'], ['last', 'Last lap']],
  function (k, e, K) {
    k.txt(X + 9, Y + 5, 150, 14, 15, 600, 'left', K.labels, 'BEST LAP EVER');
    e.tag = k.txt(X + W - 52, Y + 5, 44, 14, 14, 800, 'center', '#111', 'NEW'); e.tag.style.backgroundColor = K.newTag; e.tag.style.borderRadius = '6px';
    e.lap = k.txt(X + 9, Y + 20, W - 18, 32, 46, 700, 'left', K.lap);
    e.sec = [0, 1, 2].map(function (i) { return k.txt(X + 9 + i * 76, Y + 54, 74, 13, 17, 600, 'left', K.sectors); });
    e.when = k.txt(X + 9, Y + 69, W - 18, 12, 15, 600, 'left', K.info);
    k.rect(X + 9, Y + 84, W - 18, 0.6, K.labels).style.opacity = '.35';
    function row(y, title) {
      var o = { t: k.txt(X + 9, y, 90, 14, 14, 600, 'left', K.labels, title) };
      o.v = k.txt(X + 95, y, 80, 14, 22, 700, 'right', K.values); o.d = k.txt(X + 178, y, 58, 14, 18, 700, 'right', K.labels);
      return o;
    }
    e.session = row(Y + 89, 'THIS SESSION'); e.last = row(Y + 104, 'LAST LAP');
    k.hideIf('sectors', e.sec); k.hideIf('when', [e.when]); k.hideIf('session', [e.session.t, e.session.v, e.session.d]); k.hideIf('last', [e.last.t, e.last.v, e.last.d]);
    function diff(o, t, best) {
      D.text(o.v, F.lap(t));
      var d = t > 0 && best > 0 ? t - best : null;
      D.text(o.d, d === null ? '' : F.plusSec(d)); D.color(o.d, d === null ? K.labels : (d <= 0 ? K.faster : K.slower));
    }
    return function (state) {
      var b = state.pb || {};
      D.text(e.lap, F.lap(b.lap)); D.show(e.tag, !!b.new);
      var s = [b.s1, b.s2, b.s3];
      for (var i = 0; i < 3; i++) D.text(e.sec[i], 'S' + (i + 1) + ' ' + (s[i] > 0 ? F.sector(s[i]) : '-'));
      D.text(e.when, b.has ? (b.new ? 'Set this session' : F.day(b.time) + (b.type ? ' · ' + b.type : '')) + (b.setWith ? ' · ' + b.setWith : '') :
        (state.pb ? 'No lap of yours yet' + (b.track ? ' · ' + b.track : '') + (b.car ? ' · ' + b.car : '') : 'Waiting for the game'));
      diff(e.session, b.session, b.lap); diff(e.last, b.last, b.lap);
    };
  });
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
