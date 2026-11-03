// Tyres (SimHub "TyP"): per wheel a temperature block (colour = temperature, darkened from the top by the wear), wear %, pressure (psi), brake temperature bar
// + value, and the compound box. Data: state.car.wheels (FL FR RL RR) of the focus car.
// The temperature colours are a fixed scale (blue cold -> green -> yellow -> red hot), not editable colours.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format, D = P.dom;
  // per wheel: tyre block x/y, wear text y, pressure y, brake bar x, temperature text x/align, brake text y (design units, SimHub positions)
  var WH = [
    { tb: 271.8, ty: 507.9, wx: 270, wy: 489.3, py: 571.8, bb: 312, tv: 319, al: 'left', bv: 541 },
    { tb: 467.8, ty: 507.9, wx: 466, wy: 489.3, py: 571.8, bb: 460, tv: 426, al: 'right', bv: 541 },
    { tb: 271.8, ty: 611.4, wx: 270, wy: 675.2, py: 591.7, bb: 312, tv: 319, al: 'left', bv: 644.4 },
    { tb: 467.8, ty: 611.4, wx: 466, wy: 675.2, py: 591.7, bb: 460, tv: 426, al: 'right', bv: 644.4 }];
  var TH = 59.6;                                                                    // tyre block height (units)
  var T = P.panelWidget('tyres', 'Tyres', 265, 482.3, 245, 218.8, 'limeAccent', [
    ['frame', 'Tyre frame + tread lines', 'panelDark'], ['noData', 'Tyre / brake: no data', 'noData'], ['wear', 'Wear %', 'white'], ['pressure', 'Pressure', 'subtext'],
    ['brake', 'Brake temperature text', 'subtext'], ['cmpBox', 'Compound box inside', 'panelDark'],
    ['soft', 'Compound: soft', 'red'], ['medium', 'Compound: medium', 'yellow'], ['hard', 'Compound: hard', 'tyreH'], ['wet', 'Compound: wet', 'blue'],
    ['missing', 'Missing wheel / flat tyre', 'red'], ['card', 'Modern: tyre cards', 'panelDark'], ['labels', 'Modern: titles + wheel names', 'label'],
    ['wearGood', 'Modern: tyre left 60 % or more', 'green'], ['wearMid', 'Modern: tyre left 30-60 %', 'yellow'], ['wearLow', 'Modern: tyre left under 30 %', 'red']],
    [{ key: 'look', label: 'Look', type: 'select', def: 'modern', choices: [['modern', 'Modern (a card per tyre)'], ['classic', 'Classic (the SimHub panel)']] },
     ['temp', 'Tyre temperature values'], ['wear', 'Wear (% + darkening)'], ['pressure', 'Pressure'], ['brakes', 'Brake temperature'], ['compound', 'Compound box'],
     { key: 'pUnit', label: 'Pressure unit', type: 'select', def: 'psi', choices: [['psi', 'psi'], ['kPa', 'kPa'], ['bar', 'bar']] },
     { key: 'tUnit', label: 'Temperature unit', type: 'select', def: 'C', choices: [['C', '\u00B0C'], ['F', '\u00B0F']] }],
  function (k, e, K) {
    if (k.opt('look', 'modern') === 'modern') return modern(k, e, K);
    var showWear = k.show('wear'), PU = k.opt('pUnit', 'psi'), TU = k.opt('tUnit', 'C');
    e.w = WH.map(function (p) {
      var o = {}, top = p.ty + (p.ty > 600 ? 1.1 : 1.3), y3 = p.ty + 4.2;
      k.rect(p.tb, p.ty, 36.4, 62.1, K.frame);
      o.tyre = k.rect(p.tb + 1.2, top, 34, TH, K.noData);
      k.rect(p.tb + 11.7, y3, 1.6, 53.7, K.frame); k.rect(p.tb + 23.1, y3, 1.6, 53.7, K.frame);   // the three tread stripes
      o.worn = k.rect(p.tb + 1.2, top, 34, TH, 'rgba(0,0,0,0.7)'); o.worn._dynH = true;
      o.wear = k.txt(p.wx, p.wy, 40, 17.9, 22, 700, 'center', K.wear);
      o.pres = k.txt(p.wx, p.py, 40, 17.9, 19, 600, 'center', K.pressure);
      o.brake = k.rect(p.bb, y3 + 3, 4, 47.7, K.noData);
      o.temp = k.txt(p.tv, y3 + 3, 31, 23.8, 24, 700, p.al, K.noData);
      o.btemp = k.txt(p.tv, p.bv, 31, 19.9, 17, 600, p.al, K.brake);
      k.hideIf('temp', [o.temp]); k.hideIf('wear', [o.wear, o.worn]); k.hideIf('pressure', [o.pres]); k.hideIf('brakes', [o.brake, o.btemp]);
      o.u = k.u; o.ux = k.ux; o.uy = k.uy; return o;
    });
    var CMP = { soft: K.soft, medium: K.medium, hard: K.hard, wet: K.wet };
    e.cmpOut = k.rect(349.5, 578.7, 76, 27.8, K.medium); var cin = k.rect(351.5, 580.7, 72, 23.8, K.cmpBox);
    e.cmp = k.txt(349.5, 578.7, 76, 27.8, 26, 700, 'center', K.medium); k.hideIf('compound', [e.cmpOut, cin, e.cmp]);
    return function (state) {
      var c = state.car || {};                                              // no game: the frame with dashes
      for (var i = 0; i < 4; i++) {
        var o = e.w[i], w = (c.wheels || [])[i] || {}, worn = w.wear >= 0 ? Math.max(0, Math.min(1, 1 - w.wear)) : 0, tc = F.tyreTempColor(w.temp, K.noData);
        var gone = lost(w); if (gone) tc = K.missing;                                // a missing wheel / flat tyre: red, OFF / FLAT
        D.bg(o.tyre, tc); D.color(o.temp, tc); D.text(o.temp, gone || F.deg(w.temp, TU));
        D.show(o.worn, showWear && w.wear > 0); var hgt = Math.round(o.uy(TH) * worn); if (o.worn._h !== hgt) { o.worn.style.height = hgt + 'px'; o.worn._h = hgt; }
        D.text(o.wear, F.wear(w.wear)); D.text(o.pres, F.pressure(w.pressure, PU));
        D.bg(o.brake, F.brakeTempColor(w.brake, K.noData)); D.text(o.btemp, F.deg(w.brake, TU));
      }
      var n = F.compound(c.compound), cc = F.compoundColor(n, CMP);
      D.text(e.cmp, n || '--'); D.color(e.cmp, cc); D.bg(e.cmpOut, cc);
    };
  });
  // a wheel that is gone: 'OFF' (detached), 'FLAT' (flat / no pressure), else ''
  function lost(w) { return w.detached ? 'OFF' : ((w.flat || (w.pressure >= 0 && w.pressure <= 1)) ? 'FLAT' : ''); }
  // Modern look: a rounded card per tyre (FL FR / RL RR): wheel name and tyre left % (+ a bar), three bars = the temperature across the tread
  // (left / middle / right), the tyre temperature, pressure and brake temperature; the compound as a pill next to the title. Same data, same options.
  function modern(k, e, K) {
    var X = 265, Y = 482.3, PAD = 6, TOP = 24, CW = (245 - 3 * PAD) / 2, CH = (218.8 - TOP - 2 * PAD) / 2, BAR = 46;
    var PU = k.opt('pUnit', 'psi'), TU = k.opt('tUnit', 'C'), NAMES = ['FL', 'FR', 'RL', 'RR'];
    k.txt(X + 9, Y + 5, 120, 15.9, 15, 600, 'left', K.labels, 'TYRES');
    e.cmpOut = k.rect(X + 245 - PAD - 40, Y + 6, 40, 13, K.medium); e.cmpOut.style.borderRadius = '999px';
    e.cmp = k.txt(X + 245 - PAD - 40, Y + 6, 40, 13, 15, 800, 'center', K.cmpBox); k.hideIf('compound', [e.cmpOut, e.cmp]);
    function round(el, r) { el.style.borderRadius = r + 'px'; return el; }
    e.w = NAMES.map(function (name, i) {
      var cx = X + PAD + (i % 2) * (CW + PAD), cy = Y + TOP + Math.floor(i / 2) * (CH + PAD), o = {};
      round(k.rect(cx, cy, CW, CH, K.card), 14);
      k.txt(cx + 6, cy + 4, 30, 14, 16, 700, 'left', K.labels, name);
      o.wear = k.txt(cx + CW - 62, cy + 3, 56, 16, 24, 700, 'right', K.wear);
      o.wearBg = round(k.rect(cx + 6, cy + CH - 8, CW - 12, 2.6, K.noData), 4); o.wearBar = round(k.rect(cx + 6, cy + CH - 8, CW - 12, 2.6, K.wearGood), 4); o.wearBar._dynW = true; o.wearW = CW - 12;
      o.bars = [0, 1, 2].map(function (j) { return round(k.rect(cx + 7 + j * 8.5, cy + 24, 6, BAR, K.noData), 6); });
      o.temp = k.txt(cx + 36, cy + 22, 52, 22, 32, 700, 'left', K.noData);
      o.pres = k.txt(cx + 36, cy + 47, 70, 12, 17, 600, 'left', K.pressure);
      o.btemp = k.txt(cx + 36, cy + 60, 70, 11, 15, 600, 'left', K.brake);
      k.hideIf('temp', [o.temp].concat(o.bars)); k.hideIf('wear', [o.wear, o.wearBg, o.wearBar]); k.hideIf('pressure', [o.pres]); k.hideIf('brakes', [o.btemp]);
      o.u = k.u; o.ux = k.ux; o.uy = k.uy; return o;
    });
    var CMP = { soft: K.soft, medium: K.medium, hard: K.hard, wet: K.wet }, WEAR = [K.wearLow, K.wearMid, K.wearGood];
    return function (state) {
      var c = state.car || {};
      for (var i = 0; i < 4; i++) {
        var o = e.w[i], w = (c.wheels || [])[i] || {}, tc = F.tyreTempColor(w.temp, K.noData), ts = w.temps || [w.temp, w.temp, w.temp], gone = lost(w);
        for (var j = 0; j < 3; j++) D.bg(o.bars[j], gone ? K.missing : F.tyreTempColor(ts[j], K.noData));   // a missing wheel / flat tyre: red, OFF / FLAT
        D.color(o.temp, gone ? K.missing : tc); D.text(o.temp, gone || F.deg(w.temp, TU));
        D.text(o.wear, F.wear(w.wear));
        var left = w.wear >= 0 ? Math.max(0, Math.min(1, w.wear)) : 0, px = Math.round(o.ux(o.wearW) * left);
        if (o.wearBar._w !== px) { o.wearBar.style.width = px + 'px'; o.wearBar._w = px; }
        D.bg(o.wearBar, WEAR[left >= 0.6 ? 2 : (left >= 0.3 ? 1 : 0)]);
        D.text(o.pres, F.pressure(w.pressure, PU) + ' ' + PU);
        D.text(o.btemp, 'Brake ' + F.deg(w.brake, TU)); D.color(o.btemp, w.brake > 0 ? F.brakeTempColor(w.brake, K.brake) : K.brake);
      }
      var n = F.compound(c.compound), cc = F.compoundColor(n, CMP);
      D.text(e.cmp, n || '--'); D.bg(e.cmpOut, cc);
    };
  }
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
