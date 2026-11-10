// Icons drawn as SVG in the theme's own colours (theme icon style 'line' or 'duo'; 'classic' = the original images in assets/icons).
// weather(sky, style, c): sky 0..10 = the game's forecast sky (same meaning as wx_0..wx_10): 0 clear .. 4 overcast, 5..9 more and more rain, 10 storm.
// c = { sun, cloud, rain, bolt } CSS colours (a widget's colour parts). air / road: the temperature icons of the track widget.
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  function svg(inner) { return '<svg viewBox="0 0 32 32" width="100%" height="100%" style="display:block;overflow:visible">' + inner + '</svg>'; }
  function paint(color, duo, w) { return 'style="stroke:' + color + ';stroke-width:' + (w || 2) + ';stroke-linecap:round;stroke-linejoin:round;fill:' + (duo ? color : 'none') + ';fill-opacity:' + (duo ? '.28' : '0') + '"'; }
  function sun(cx, cy, r, color, duo, ray) {
    var s = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" ' + paint(color, duo) + '/>';
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4, c = Math.cos(a), n = Math.sin(a), r1 = r + 2.2, r2 = r + 2.2 + ray;
      s += '<line x1="' + (cx + c * r1).toFixed(1) + '" y1="' + (cy + n * r1).toFixed(1) + '" x2="' + (cx + c * r2).toFixed(1) + '" y2="' + (cy + n * r2).toFixed(1) + '" ' + paint(color, false) + '/>';
    }
    return s;
  }
  var CLOUD = 'M9 25h14.5a5.5 5.5 0 0 0 .5-11a7.5 7.5 0 0 0-14.3-1.6A5.5 5.5 0 0 0 9 25z';
  function cloud(tx, ty, sc, color, duo) { return '<path d="' + CLOUD + '" transform="translate(' + tx + ' ' + ty + ') scale(' + sc + ')" ' + paint(color, duo, 2 / sc) + '/>'; }
  function drops(xs, color, len) { return xs.map(function (x) { return '<line x1="' + x + '" y1="24.5" x2="' + (x - 1.6) + '" y2="' + (24.5 + len) + '" ' + paint(color, false) + '/>'; }).join(''); }

  function weather(sky, style, c) {
    var d = style === 'duo', s = Math.round(sky);
    if (!(s >= 0 && s <= 10)) return svg('<text x="16" y="21" text-anchor="middle" style="fill:' + c.cloud + ';font-size:13px">?</text>');
    if (s === 0) return svg(sun(16, 16, 6.5, c.sun, d, 3.5));
    if (s === 1) return svg(sun(12, 12, 5, c.sun, d, 2.8) + cloud(9, 10, 0.68, c.cloud, d));
    if (s === 2) return svg(sun(11, 11, 5, c.sun, d, 2.8) + cloud(4, 6, 0.85, c.cloud, d));
    if (s === 3) return svg(sun(9, 9, 4, c.sun, d, 2) + cloud(0, 2, 1, c.cloud, d));
    if (s === 4) return svg(cloud(0, 1, 1, c.cloud, d) + cloud(-4, -5, 0.6, c.cloud, d));
    var up = cloud(0, -4, 1, c.cloud, d);                                            // rain: the cloud moves up, drops below it
    if (s === 5) return svg(up + drops([16], c.rain, 3));
    if (s === 6) return svg(up + drops([12, 20], c.rain, 3.5));
    if (s === 7) return svg(up + cloud(-4, -9, 0.55, c.cloud, d) + drops([12, 20], c.rain, 4));
    if (s === 8) return svg(up + drops([10, 16, 22], c.rain, 4.5));
    if (s === 9) return svg(up + drops([9, 14, 19, 24], c.rain, 6));
    return svg(up + drops([10, 23], c.rain, 4) + '<polyline points="18,21 14,27 18,27 15,32" ' + paint(c.bolt, false, 2.2) + '/>');   // storm
  }
  function air(style, color) {
    var d = style === 'duo';
    return svg('<path d="M13 19.5V6a3 3 0 0 1 6 0v13.5a6 6 0 1 1-6 0z" ' + paint(color, d) + '/><line x1="16" y1="12" x2="16" y2="22" ' + paint(color, false, 2.6) + '/>' +
               '<line x1="22" y1="8" x2="26" y2="8" ' + paint(color, false) + '/><line x1="22" y1="12" x2="25" y2="12" ' + paint(color, false) + '/>');
  }
  function road(style, color) {
    var d = style === 'duo';
    return svg((d ? '<path d="M10 30L14 3h4l4 27z" style="fill:' + color + ';fill-opacity:.22;stroke:none"/>' : '') +
               '<line x1="10" y1="30" x2="14" y2="3" ' + paint(color, false) + '/><line x1="22" y1="30" x2="18" y2="3" ' + paint(color, false) + '/>' +
               '<line x1="16" y1="27" x2="16" y2="23" ' + paint(color, false) + '/><line x1="16" y1="18" x2="16" y2="15" ' + paint(color, false) + '/><line x1="16" y1="10" x2="16" y2="8" ' + paint(color, false) + '/>');
  }
  P.icons = { weather: weather, air: air, road: road };
  if (typeof module !== 'undefined') module.exports = P.icons;
})(typeof window !== 'undefined' ? window : globalThis);
