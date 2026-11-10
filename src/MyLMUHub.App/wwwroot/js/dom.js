// Small DOM helpers. They only touch the DOM when a value really changed (cheap updates at 10 Hz).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  var doc = function () { return root.document; };
  P.dom = {
    el: function (tag, cls, parent) {
      var e = doc().createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e;
    },
    box: function (cls, parent, x, y, w, h) {
      var e = P.dom.el('div', cls, parent), s = e.style; s.position = 'absolute';
      if (x !== undefined) s.left = x + 'px'; if (y !== undefined) s.top = y + 'px'; if (w !== undefined) s.width = w + 'px'; if (h !== undefined) s.height = h + 'px';
      return e;
    },
    text: function (e, t) { if (e._t !== t) { e.textContent = t; e._t = t; } },
    color: function (e, c) { if (e._c !== c) { e.style.color = c; e._c = c; } },
    bg: function (e, c) { if (e._b !== c) { e.style.backgroundColor = c; e._b = c; } },
    show: function (e, on) { var d = on ? '' : 'none'; if (e._d !== d) { e.style.display = d; e._d = d; } },
    left: function (e, x) { if (e._l !== x) { e.style.left = x + 'px'; e._l = x; } },
    src: function (e, s) { if (e._s !== s) { e.src = s; e._s = s; } }
  };
  if (typeof module !== 'undefined') module.exports = P.dom;
})(typeof window !== 'undefined' ? window : globalThis);
