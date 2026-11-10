// Widget registry. A widget = { type, title, base:{w,h}, create(host, ctx) -> { update(state), resize(w,h), destroy(), size? } }
// base = the size the widget is drawn at; the layout manager scales it to the box the user dragged (see layoutMath.fitScale).
// colors (optional) = the widget's own colour parts (P.colorSlots(...).list); the colour scheme editor offers those for this widget.
// options (optional) = what the user can set in the widget's panel:
//   { key, label, def }                                        tick box "show this part" (settings.show[key]; def false = hidden until switched on)
//   { key, label, type: 'number', def, min, max, step }        a number   (settings.opt[key])
//   { key, label, type: 'select', def, choices: [[v, label]] } a choice   (settings.opt[key])
//   { key, label, type: 'text', def }                          a short text (settings.opt[key], trimmed, at most 60 characters)
//   create reads them with P.shown(ctx.settings, key, def) / P.opt(ctx.settings, key, def); after a change the widget is created again.
// size = {w,h} it is drawn at when that differs from base (e.g. columns hidden) - the layout manager then fits the box to it.
// Every widget also gets the GENERAL options below (applied by the layout manager).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  P.widgets = P.widgets || {};
  P.registerWidget = function (def) { P.widgets[def.type] = def; };
  P.shown = function (settings, key, def) { var s = settings && settings.show; return s && key in s ? !!s[key] : def !== false; };
  P.opt = function (settings, key, def) { var o = settings && settings.opt; return o && key in o && o[key] !== null && o[key] !== '' ? o[key] : def; };
  // float = on top of the other widgets: may overlap them, does not push them and is not pushed (still lines up with edges / the grid); layout.js
  P.GENERAL_OPTIONS = [{ key: 'float', label: 'Float on top (may overlap other widgets)', def: false }, { key: 'opacity', label: 'Opacity (%)', type: 'number', def: 100, min: 10, max: 100, step: 5 }];
  P.isFloat = function (settings) { return P.shown(settings, 'float', false); };
  // the widget's options with the current setting, for the panel
  P.optionStates = function (def, settings) {
    return (def.options || []).concat(P.GENERAL_OPTIONS).map(function (o) {
      var t = o.type || 'bool', s = { key: o.key, label: o.label, type: t, min: o.min, max: o.max, step: o.step, choices: o.choices };
      if (t === 'bool') s.on = s.value = P.shown(settings, o.key, o.def); else s.value = P.opt(settings, o.key, o.def);
      return s;
    });
  };
  // store a changed option (tick boxes in settings.show, the rest in settings.opt)
  P.setOption = function (def, settings, key, value) {
    var o = (def.options || []).concat(P.GENERAL_OPTIONS).filter(function (x) { return x.key === key; })[0]; if (!o) return;
    if ((o.type || 'bool') === 'bool') { (settings.show = settings.show || {})[key] = !!value; return; }
    if (o.type === 'number') { value = Number(value); if (!isFinite(value)) return; if (o.min !== undefined) value = Math.max(o.min, value); if (o.max !== undefined) value = Math.min(o.max, value); }
    if (o.type === 'text') value = String(value || '').trim().slice(0, 60);
    (settings.opt = settings.opt || {})[key] = value;
  };
})(typeof window !== 'undefined' ? window : globalThis);
