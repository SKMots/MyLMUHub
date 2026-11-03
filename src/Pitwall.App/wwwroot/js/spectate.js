// Spectate picker: choose whose car the dashboard follows. The app follows that driver (and the car after a driver swap); your own car always wins while
// you drive it (the game flags it). "Automatic" = your car, else the names in settings.json.
// o = { parent, button, load() -> Promise<{ target, cars: [{driver, entry, cls, place, player}] }>, choose(target|null) -> Promise }
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, D = P.dom;

  function Spectate(o) {
    var self = this; this.o = o; this.el = null;
    o.button.addEventListener('click', function () { if (self.el) self.close(); else self.open(); });
  }
  var S = Spectate.prototype;
  // button text from the state: driving / who is followed
  S.update = function (state) {
    var st = state && state.standings;
    D.text(this.o.button, st && st.driving ? '● DRIVING' : (st && st.focusDriver ? '👁 ' + st.focusDriver : '👁 SPECTATE'));
  };
  S.open = function () {
    var self = this; this.close();
    var el = this.el = D.el('div', 'pw-panel pw-spec', this.o.parent);
    var head = D.el('div', 'pw-panel-head', el); D.el('strong', '', head).textContent = 'Spectate';
    var x = D.el('button', 'pw-panel-x', head); x.textContent = '×'; x.addEventListener('click', function () { self.close(); });
    var find = D.el('input', 'pw-spec-find', el); find.setAttribute('placeholder', 'search driver / team');
    var list = D.el('div', 'pw-spec-list', el); list.textContent = 'loading…';
    this.o.load().then(function (info) {
      if (self.el !== el) return;
      self._info = info || { target: null, cars: [] }; self._render(list, '');
      find.addEventListener('input', function () { self._render(list, find.value); });
    }, function () { if (self.el === el) list.textContent = 'not available (demo data / app not running)'; });
  };
  S._render = function (list, q) {
    var self = this, info = this._info, t = info.target, k = String(q || '').trim().toLowerCase(), cls = null;
    list.textContent = '';
    var auto = D.el('div', 'pw-spec-row' + (t ? '' : ' on'), list); auto.textContent = 'Automatic – my car / names in settings';
    auto.addEventListener('click', function () { self._pick(null); });
    var order = {}, cars = (info.cars || []).slice(), n = 0;                   // grouped by class (leading class first), class position inside
    cars.forEach(function (c) { if (!(c.cls in order)) order[c.cls] = Object.keys(order).length; });
    cars.sort(function (a, b) { return order[a.cls] - order[b.cls] || a.place - b.place; });
    cars.forEach(function (c) {
      if (c.cls !== cls) { cls = c.cls; n = 0; if (!k) D.el('div', 'pw-spec-cls', list).textContent = cls || '-'; }
      n++;
      if (k && (c.driver + ' ' + c.entry).toLowerCase().indexOf(k) < 0) return;
      var on = !!t && t.driver === c.driver, r = D.el('div', 'pw-spec-row' + (on ? ' on' : ''), list);
      D.el('span', 'pw-spec-pos', r).textContent = 'P' + n;
      D.el('span', 'pw-spec-name', r).textContent = c.driver + (c.player ? '  (you)' : '');
      D.el('span', 'pw-spec-team', r).textContent = c.entry;
      r.addEventListener('click', function () { self._pick({ driver: c.driver, entry: c.entry }); });
    });
  };
  S._pick = function (target) { var self = this; this.o.choose(target).then(function () { self.close(); }, function () { self.close(); }); };
  S.close = function () { if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el); this.el = null; };

  P.Spectate = Spectate;
  if (typeof module !== 'undefined') module.exports = Spectate;
})(typeof window !== 'undefined' ? window : globalThis);
