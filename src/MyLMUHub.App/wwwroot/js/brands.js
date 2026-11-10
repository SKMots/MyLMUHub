// Which logo for a car: the car model (keywords) first, then the team/entry name. Data in brands-data.js (from the SimHub dashboard).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  function strip(s) { return s.replace(/\b20\d\d\b/g, '').replace(/\s+/g, ' ').trim(); }
  function teamBrand(c) {
    var D = P.brandData, T = D.T, K = D.K;
    if (!c) return 'generic';
    if (T[c]) return T[c];
    var q = strip(c), w = q.split(' ')[0], hit = null, mix = false;
    for (var key in T) {
      var kq = strip(key);
      if (kq === q) return T[key];
      if (w.length > 3 && kq.split(' ')[0] === w) { if (hit === null) hit = T[key]; else if (hit !== T[key]) mix = true; }
    }
    if (hit && !mix) return hit;
    for (var i = 0; i < K.length; i++) if (c.indexOf(K[i][0]) >= 0) return K[i][1];
    return 'generic';
  }
  function brandOf(model, entry) {
    var K = P.brandData.K, m = String(model || '').toLowerCase(), c = String(entry || '').toLowerCase();
    if (m) for (var i = 0; i < K.length; i++) if (m.indexOf(K[i][0]) >= 0) return K[i][1];
    return teamBrand(c);
  }
  function logoName(model, entry) { var b = brandOf(model, entry); return b === 'brand_generic' ? 'generic' : String(b).replace(/^brand_/, ''); }
  // the image: one colour (assets/brands) or, with the theme's 'Car logos: full colour', the make's own colours on a light badge (assets/brands-color; a make
  // without a colour logo keeps its one-colour one)
  var COLOR = ['acura', 'alfa', 'alpine', 'aston', 'audi', 'bmw', 'cadillac', 'chevrolet', 'ferrari', 'ford', 'genesis', 'ginetta', 'honda', 'hyundai', 'infinity', 'isotta', 'kia', 'lamborghini', 'lexus', 'ligier', 'lotus', 'mazda', 'mclaren', 'mercedes', 'nissan', 'oreca', 'peugeot', 'pontiac', 'porsche', 'radical', 'renault', 'subaru', 'toyota', 'volkswagen'];
  function logoSrc(model, entry) {
    var n = logoName(model, entry), color = P.theme && P.theme.logoStyle === 'color' && COLOR.indexOf(n) >= 0;
    return 'assets/' + (color ? 'brands-color/' : 'brands/') + n + '.png';
  }
  P.brands = { brandOf: brandOf, logoName: logoName, logoSrc: logoSrc, COLOR: COLOR };
  if (typeof module !== 'undefined') module.exports = P.brands;
})(typeof window !== 'undefined' ? window : globalThis);
