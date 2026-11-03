// Car info strip (SimHub "InfoP"): brand logo, car model, driver, brake bias, TC slip / cut, TC, ABS, engine map of the focus car. Data: state.car (CarView).
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format, D = P.dom;
  var T = P.panelWidget('carinfo', 'Car info', 775, 422.6, 483, 49.7, 'redAccent', [
    ['model', 'Car model', 'label'], ['driver', 'Driver', 'white'], ['biasTitle', 'Title: BRK BIAS', 'warnLabel'], ['titles', 'Titles (TC, ABS, MAP)', 'label'], ['values', 'Values', 'white']],
    [['logo', 'Brand logo'], ['model', 'Car model'], ['driver', 'Driver'], ['bias', 'Brake bias'], ['tcSlip', 'TC slip'], ['tcCut', 'TC cut'], ['tc', 'TC'], ['abs', 'ABS'], ['map', 'Engine map']],
  function (k, e, K) {
    e.logo = k.img(782, 433.6, 26, 26);
    e.model = k.txt(814, 426.6, 132, 17.9, 17, 600, 'left', K.model);
    e.driver = k.txt(814, 444.5, 132, 21.9, 22, 700, 'left', K.driver);
    e.v = {};
    [['bias', 936, 'BRK BIAS', K.biasTitle], ['tcSlip', 1016, 'TC SLIP'], ['tcCut', 1074, 'TC CUT'], ['tc', 1126, 'TC'], ['abs', 1168, 'ABS'], ['map', 1212, 'MAP']].forEach(function (a) {
      var title = k.txt(a[1], 425.6, 70, 13.9, 15, 600, 'center', a[3] || K.titles, a[2]);
      e.v[a[0]] = k.txt(a[1], 439.5, 70, 27.8, 30, 700, 'center', K.values); k.hideIf(a[0], [title, e.v[a[0]]]);
    });
    k.hideIf('model', [e.model]); k.hideIf('driver', [e.driver]); var logo = k.show('logo');
    return function (state) {
      var c = state.car || {};                                              // no game: the frame with dashes
      D.src(e.logo, P.brands.logoSrc(c.model, c.entry)); D.show(e.logo, !!c.has && logo);
      D.text(e.model, c.model || ''); D.text(e.driver, c.driver || '');
      D.text(e.v.bias, F.bias(c.brakeBias)); D.text(e.v.tcSlip, F.level(c.tcSlip)); D.text(e.v.tcCut, F.level(c.tcCut));
      D.text(e.v.tc, F.level(c.tc)); D.text(e.v.abs, F.level(c.abs)); D.text(e.v.map, F.level(c.map));
    };
  });
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
