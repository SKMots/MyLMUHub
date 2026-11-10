// Settings panel (side panel). For a widget: "Show" (tick what you want to see) + a fold-out "Colour scheme" (font + a colour picker per part).
// For the theme: only the colour scheme (open). It edits a style object in place ({ colors: {key: '#rrggbb'}, font }) and calls onChange after every
// colour / font change, onShow(key, on) after a tick; the caller applies and saves.
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, D = P.dom, T = P.theme;

  function StyleEditor(parent) { this.parent = parent; this.el = null; this.schemeOpen = false; }
  // o = { title, style, items: [{ key, label }] (the colours to offer), base(key) -> colour shown when not set, onChange(), note,
  //       options: [{ key, label, on }] (what can be shown / hidden; none = no "Show" section, colours open), onShow(key, on) }
  StyleEditor.prototype.open = function (o) {
    this.close(); var self = this, st = o.style; st.colors = st.colors || {};
    var el = this.el = D.el('div', 'pw-panel', this.parent), rows = {}, opts = o.options || [];
    var head = D.el('div', 'pw-panel-head', el); D.el('strong', '', head).textContent = o.title;
    var x = D.el('button', 'pw-panel-x', head); x.textContent = '×'; x.addEventListener('click', function () { self.close(); });
    if (o.note) D.el('div', 'pw-panel-note', el).textContent = o.note;

    var checks = {}, inputs = {}, bools = opts.filter(function (op) { return op.type === 'bool' || !op.type; }), rest = opts.filter(function (op) { return op.type && op.type !== 'bool'; });
    if (bools.length) {
      D.el('div', 'pw-panel-sec', el).textContent = 'Show';
      bools.forEach(function (op) {
        var r = D.el('label', 'pw-panel-row pw-panel-check', el), cb = D.el('input', '', r); cb.setAttribute('type', 'checkbox'); cb.checked = !!op.on;
        D.el('span', '', r).textContent = op.label;
        cb.addEventListener('change', function () { if (o.onShow) o.onShow(op.key, !!cb.checked); });
        checks[op.key] = cb;
      });
    }
    if (rest.length) {
      D.el('div', 'pw-panel-sec', el).textContent = 'Settings';
      rest.forEach(function (op) {
        var r = D.el('div', 'pw-panel-row', el), inp; D.el('span', '', r).textContent = op.label;
        if (op.type === 'select') {
          inp = D.el('select', 'pw-panel-sel', r);
          op.choices.forEach(function (c) { var oe = D.el('option', '', inp); oe.value = String(c[0]); oe.textContent = c[1]; });
        } else if (op.type === 'text') {
          inp = D.el('input', 'pw-panel-txt', r); inp.setAttribute('type', 'text'); inp.setAttribute('spellcheck', 'false');
        } else {
          inp = D.el('input', 'pw-panel-num', r); inp.setAttribute('type', 'number');
          ['min', 'max', 'step'].forEach(function (a) { if (op[a] !== undefined) inp.setAttribute(a, String(op[a])); });
        }
        inp.value = String(op.value);
        inp.addEventListener('change', function () {
          var v = op.type === 'number' ? Number(inp.value) : inp.value;
          if (op.type === 'select' && typeof op.choices[0][0] === 'number') v = Number(v);
          if (o.onShow) o.onShow(op.key, v);
        });
        inputs[op.key] = inp;
      });
    }

    // the colour scheme: folded away under the "Show" list for a widget, open for the theme (foldColors: false)
    var box = el;
    if (opts.length && o.foldColors !== false) {
      var tg = D.el('button', 'pw-panel-fold', el); box = D.el('div', 'pw-panel-scheme', el);
      var fold = function () { tg.textContent = (self.schemeOpen ? '▾' : '▸') + ' Colour scheme'; D.show(box, self.schemeOpen); };
      tg.addEventListener('click', function () { self.schemeOpen = !self.schemeOpen; fold(); }); fold(); this._fold = tg;
    }
    var fr = D.el('div', 'pw-panel-row', box); D.el('span', '', fr).textContent = 'Font';
    // a dropdown with every font (each shown in its own typeface) - always the whole list, whatever is chosen now; "Other…" = type a font name
    var font = D.el('select', 'pw-panel-font pw-panel-sel', fr), cur = st.font || '';
    var list = [['', 'Default']].concat(T.FONTS.map(function (f) { return [f, f]; }));
    if (cur && T.FONTS.indexOf(cur) < 0) list.push([cur, cur]);
    list.push(['?', 'Other…']);
    list.forEach(function (f) { var op = D.el('option', '', font); op.value = f[0]; op.textContent = f[1]; if (f[0] && f[0] !== '?') op.style.fontFamily = '"' + f[0] + '"'; if (f[0] === cur) op.selected = true; });
    font.addEventListener('change', function () {
      var v = font.value;
      if (v === '?') { v = root.prompt ? root.prompt('Font name (installed on this PC)', cur) : null; if (v === null) { font.value = cur; return; } v = String(v).trim(); }
      st.font = cur = v; o.onChange();
    });

    o.items.forEach(function (it) {
      var k = it.key, r = D.el('div', 'pw-panel-row', box); D.el('span', '', r).textContent = it.label;
      var inp = D.el('input', '', r); inp.setAttribute('type', 'color');
      var rs = D.el('button', 'pw-panel-reset', r); rs.textContent = '↺'; rs.setAttribute('title', 'back to default');
      function mark() { var on = !!st.colors[k]; inp.value = on ? st.colors[k] : o.base(k); D.show(rs, on); r.className = 'pw-panel-row' + (on ? ' set' : ''); }
      inp.addEventListener('input', function () { st.colors[k] = String(inp.value).toUpperCase(); mark(); o.onChange(); });
      rs.addEventListener('click', function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); delete st.colors[k]; mark(); o.onChange(); });
      mark(); rows[k] = { input: inp, reset: rs };
    });

    var foot = D.el('div', 'pw-panel-foot', box), all = D.el('button', '', foot); all.textContent = 'Reset colours + font';
    all.addEventListener('click', function () {
      for (var k in st.colors) delete st.colors[k]; st.font = ''; font.value = '';
      o.items.forEach(function (it) { rows[it.key].input.value = o.base(it.key); D.show(rows[it.key].reset, false); });
      o.onChange();
    });
    this._rows = rows; this._font = font; this._all = all; this._checks = checks; this._inputs = inputs; this._scheme = box;
  };
  StyleEditor.prototype.close = function () { if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el); this.el = null; };
  StyleEditor.prototype.isOpen = function () { return !!this.el; };

  P.StyleEditor = StyleEditor;
  if (typeof module !== 'undefined') module.exports = StyleEditor;
})(typeof window !== 'undefined' ? window : globalThis);
