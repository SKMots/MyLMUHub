// Theme + widget colours. A style = { colors: { key: '#rrggbb' }, font: 'Font name' } holding only what was changed.
// THEME = the base palette (format.colors: purple, green, red, ...): CSS variables --pw-<colour> on <html>, used everywhere by default.
// WIDGET = its own named parts (P.colorSlots: 'Tyre: wet', 'Flat tyre', ...): each part is a CSS variable --pw-<type>-<part> that falls back to a theme colour,
// set on that widget's box only. So a widget's editor lists exactly its own parts, and changing one part changes nothing else.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {}, F = P.format, C = F.colors;
  var LABELS = { bg: 'Page background', panel: 'Panel', panelDark: 'Dark panel', border: 'Panel border', focusRow: 'Highlight row', focusMark: 'Highlight yellow',
    rowLine: 'Divider lines', track: 'Track lines', white: 'Text', bright: 'White', muted: 'Muted text', label: 'Labels', dim: 'Dim (no value)', sector: 'Light grey-blue',
    int: 'Ice blue', accent: 'Orange', marker: 'Dark orange', purple: 'Purple (class best)', green: 'Green (faster / good)', red: 'Red (slower / warning)',
    yellow: 'Yellow', blue: 'Blue', ve: 'Cyan', tyreH: 'Off-white', redAccent: 'Light red', limeAccent: 'Lime', subtext: 'Soft text', faint: 'Faint text',
    warnLabel: 'Soft red', dmgOk: 'Dark green', dmgLight: 'Amber', carBody: 'Near black', noData: 'Slate (no data)' };
  // fonts that come with Windows 10 / 11 (no download): the race-display ones first
  var FONTS = ['Bahnschrift', 'Bahnschrift SemiCondensed', 'Bahnschrift Condensed', 'Bahnschrift SemiBold', 'Bahnschrift Light', 'Segoe UI', 'Segoe UI Semibold', 'Segoe UI Black',
    'Segoe UI Variable', 'Segoe UI Variable Display', 'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Candara', 'Corbel', 'Franklin Gothic Medium', 'Gadugi', 'Leelawadee UI',
    'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Tahoma', 'Trebuchet MS', 'Verdana', 'Impact', 'Ebrima', 'Cambria', 'Constantia', 'Georgia', 'Palatino Linotype',
    'Sitka Text', 'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Courier New', 'Lucida Console'];
  var KEYS = Object.keys(F.colorDefaults), HEX = /^#[0-9a-fA-F]{6}$/;

  // a widget's own colour parts: slots = [[key, label, theme colour], ...] -> { K: { key: css colour }, list: [{ key, label, token, cssVar }] }
  function colorSlots(type, slots) {
    var K = {}, list = slots.map(function (s) {
      var v = '--pw-' + type + '-' + s[0]; K[s[0]] = 'var(' + v + ',' + C[s[2]] + ')';
      return { key: s[0], label: s[1], token: s[2], cssVar: v };
    });
    return { K: K, list: list };
  }
  function setVar(e, name, v) {
    var s = e.style;
    if (v) { if (s.setProperty) s.setProperty(name, v); else s[name] = v; }
    else if (s.removeProperty) s.removeProperty(name); else delete s[name];
  }
  function cssFont(name) { var n = String(name).replace(/["\\;{}]/g, '').trim(); return n ? '"' + n + '","Bahnschrift","Segoe UI",sans-serif' : ''; }
  // put a style on an element: the theme (slots = none) or a widget (slots = its colorSlots list). Parts no longer set are removed (back to the theme).
  function apply(e, style, slots) {
    var c = (style && style.colors) || {}, vars = {}, next = {}, prev = e._pwVars || {}, k;
    if (slots) slots.forEach(function (s) { vars[s.key] = s.cssVar; }); else KEYS.forEach(function (t) { vars[t] = '--pw-' + t; });
    for (k in c) if (vars[k] && HEX.test(c[k])) next[vars[k]] = c[k];
    for (k in prev) if (!(k in next)) setVar(e, k, '');
    for (k in next) setVar(e, k, next[k]);
    e._pwVars = next;
    setVar(e, '--pw-font', style && style.font ? cssFont(style.font) : '');
  }
  // widget styles saved before the parts existed used theme colour names: give that colour to every part that used it
  function migrate(style, slots) {
    if (!style || !style.colors || !slots) return style;
    var c = style.colors, own = {}; slots.forEach(function (s) { own[s.key] = 1; });
    Object.keys(c).forEach(function (k) {
      if (own[k] || KEYS.indexOf(k) < 0) return;
      slots.forEach(function (s) { if (s.token === k && !(s.key in c)) c[s.key] = c[k]; });
      delete c[k];
    });
    return style;
  }
  // the colour a theme colour shows: the first style that sets it, else the default
  function value(key) {
    for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s && s.colors && HEX.test(s.colors[key] || '')) return s.colors[key]; }
    return F.colorDefaults[key];
  }
  // ---- theme presets: a full palette + font + corner rounding + the coloured strips on top of the panels. The saved theme =
  // { preset, colors (your own changes on top of the preset), font, radius, strips } (font / radius / strips: unset = the preset's).
  // look = 'classic' | 'chips'; texture = panel surface; backdrop = page background; icons = 'classic' (images) | 'line' | 'duo' (drawn in the theme colours, icons.js)
  var PRESETS = {
    hub: { name: 'Lime (charcoal, lime: the My LMU Hub look)', font: 'Segoe UI', radius: 14, strips: true, look: 'chips', texture: 'none', backdrop: 'plain', icons: 'line', colors: {
      bg: '#0B0B0C', panel: '#151618', panelDark: '#1D1E21', border: '#26272B', white: '#F2F3F0', bright: '#FFFFFF', muted: '#A3A59F', label: '#8A8C87',
      dim: '#4A4C49', sector: '#DCDDD8', int: '#C8F24A', accent: '#C8F24A', marker: '#C8F24A', purple: '#B47CFF', green: '#3DDC84', red: '#FF5A5F',
      yellow: '#FFD21F', blue: '#5AA9FF', ve: '#35D0E3', tyreH: '#FFFFFF', track: '#2E3033', focusRow: '#2A3210', focusMark: '#C8F24A', rowLine: '#1E1F22',
      redAccent: '#C8F24A', limeAccent: '#C8F24A', subtext: '#B5B7B1', faint: '#5E605C', warnLabel: '#FF8085', dmgOk: '#1E3A26', dmgLight: '#F5A524',
      carBody: '#08080A', noData: '#2A2B2F' } },
    teal: { name: 'Teal (black, teal: race control screen)', font: 'Segoe UI', radius: 10, strips: false, look: 'classic', texture: 'none', backdrop: 'plain', icons: 'line', colors: {
      bg: '#030405', panel: '#0A0C0E', panelDark: '#07090A', border: '#1D2328', white: '#E9EEEF', bright: '#FFFFFF', muted: '#A3AEB2', label: '#7D8A90',
      dim: '#3A4448', sector: '#D3DADC', int: '#FFFFFF', accent: '#35C8C0', marker: '#FF8A3D', purple: '#C08CFF', green: '#3DDC84', red: '#FF4D5A',
      yellow: '#FFD21F', blue: '#3FA9F5', ve: '#35C8C0', tyreH: '#FFFFFF', track: '#2E9DAA', focusRow: '#0E2E2D', focusMark: '#35C8C0', rowLine: '#14191C',
      redAccent: '#E0434F', limeAccent: '#35C8C0', subtext: '#B3BEC2', faint: '#4A565B', warnLabel: '#FF7A85', dmgOk: '#123A2C', dmgLight: '#F5A524',
      carBody: '#000000', noData: '#1C2428' } },
    // light: white panels on light grey, dark text; timing / warning colours darker so they read on white
    daylight: { name: 'Daylight (light)', font: 'Segoe UI', radius: 10, strips: true, look: 'classic', texture: 'none', backdrop: 'plain', icons: 'line', colors: {
      bg: '#E9ECEF', panel: '#FFFFFF', panelDark: '#F3F5F7', border: '#D2D7DD', white: '#16181C', bright: '#000000', muted: '#4D545C', label: '#5F6770',
      dim: '#A6ADB5', sector: '#2E353D', int: '#0A6E8C', accent: '#E06A00', marker: '#E06A00', purple: '#7A3FE0', green: '#14894B', red: '#D7263D',
      yellow: '#C99300', blue: '#1F6FD1', ve: '#0E8FA8', tyreH: '#6B7280', track: '#C3C9D0', focusRow: '#FFF1BF', focusMark: '#E0A800', rowLine: '#E6E9EC',
      redAccent: '#D7263D', limeAccent: '#5E8C00', subtext: '#4D545C', faint: '#A0A7AF', warnLabel: '#C2410C', dmgOk: '#CFE8D7', dmgLight: '#E8981A',
      carBody: '#C7CCD2', noData: '#DCE0E4' } },
    // navy: the original SimHub dashboard's colours (format.js defaults; key 'original' kept so saved layouts still find it)
    original: { name: 'Navy (the original SimHub look)', font: '', radius: 8, strips: true, look: 'classic', texture: 'none', backdrop: 'plain', icons: 'classic', colors: {} }
  };
  var DEFAULT = 'hub';                                                                 // a layout without a saved theme
  var CHOICES = {
    look: [['classic', 'Classic'], ['chips', 'Chips & badges (position chips, round tyre badges)']],
    texture: [['none', 'None'], ['carbon', 'Carbon weave'], ['brushed', 'Brushed metal'], ['scanlines', 'Scan lines'], ['stripes', 'Racing stripes'], ['dots', 'Dots'], ['grid', 'Grid']],
    backdrop: [['plain', 'Plain'], ['dots', 'Dots'], ['grid', 'Grid']],
    icons: [['classic', 'Classic images'], ['line', 'Line (theme colours)'], ['duo', 'Duotone (theme colours)']],
    logos: [['mono', 'One colour'], ['color', 'Full colour (on a light badge)']]
  };  function preset(th) { return PRESETS[th && th.preset] || PRESETS[DEFAULT]; }
  function pick(th, k) { return (th && th[k]) || preset(th)[k] || (CHOICES[k] && CHOICES[k][0][0]); }  // your choice, else the preset's, else the first choice
  // the colour a theme colour shows with this theme: your change, else the preset's, else the original
  function themeValue(key, th) { return value(key, th, preset(th)); }
  // the whole theme on the page (<html>): colours, font, corner rounding, strips
  function applyTheme(e, th) {
    var p = preset(th), colors = {}, k;
    for (k in p.colors) colors[k] = p.colors[k];
    for (k in (th && th.colors) || {}) colors[k] = th.colors[k];
    apply(e, { colors: colors, font: (th && th.font) || p.font });
    var radius = th && th.radius >= 0 ? th.radius : p.radius, strips = th && typeof th.strips === 'boolean' ? th.strips : p.strips;
    setVar(e, '--pw-radius', radius + 'px');
    if (e.setAttribute) { e.setAttribute('data-strips', strips ? 'on' : 'off'); e.setAttribute('data-preset', th && PRESETS[th.preset] ? th.preset : DEFAULT); ['look', 'texture', 'backdrop', 'icons', 'logos'].forEach(function (k) { e.setAttribute('data-' + k, pick(th, k)); }); }
    P.theme.iconStyle = pick(th, 'icons'); P.theme.logoStyle = pick(th, 'logos');           // car logos: one colour / full colour (brands.js)
    P.theme.textScale = th && th.textSize > 0 ? th.textSize / 100 : 1;                // every widget's text x this (and x its own Text size)                                           // widgets draw their icons in this style (icons.js)
    titleBar(themeValue('bg', th), themeValue('white', th));
  }
  // in the app: the window's title bar takes the page's background and text colour (MainWindow.OnMessage); in a browser: nothing
  function titleBar(bg, text) {
    var w = root.chrome && root.chrome.webview;
    if (w && w.postMessage && HEX.test(bg || '')) { try { w.postMessage({ titleBar: bg, titleText: HEX.test(text || '') ? text : null }); } catch (e) {} }
  }
  // the theme panel's own settings
  function themeOptions(th) {
    var p = preset(th);
    return [{ key: 'preset', label: 'Theme', type: 'select', value: (th && PRESETS[th.preset]) ? th.preset : DEFAULT, choices: Object.keys(PRESETS).map(function (n) { return [n, PRESETS[n].name]; }) },
            { key: 'radius', label: 'Corner rounding (px)', type: 'number', min: 0, max: 30, value: th && th.radius >= 0 ? th.radius : p.radius },
            { key: 'look', label: 'Details', type: 'select', value: pick(th, 'look'), choices: CHOICES.look },
            { key: 'texture', label: 'Panel texture', type: 'select', value: pick(th, 'texture'), choices: CHOICES.texture },
            { key: 'backdrop', label: 'Page background', type: 'select', value: pick(th, 'backdrop'), choices: CHOICES.backdrop },
            { key: 'icons', label: 'Icons', type: 'select', value: pick(th, 'icons'), choices: CHOICES.icons },
            { key: 'logos', label: 'Car logos', type: 'select', value: pick(th, 'logos'), choices: CHOICES.logos },
            { key: 'strips', label: 'Coloured strip on top of panels', type: 'bool', on: th && typeof th.strips === 'boolean' ? th.strips : p.strips },
            { key: 'textSize', label: 'Text size of all widgets (%)', type: 'number', min: 60, max: 200, value: th && th.textSize > 0 ? th.textSize : 100 }];
  }
  // a change in the theme panel. Another theme = a fresh start (your colour / font / rounding changes are for the theme they were made in).
  function setThemeOption(th, key, v) {
    if (key === 'preset') { if (!PRESETS[v]) return; th.preset = v; th.colors = {}; th.font = ''; delete th.radius; delete th.strips; Object.keys(CHOICES).forEach(function (k) { if (k !== 'logos') delete th[k]; }); }   // the car-logo choice stays
    else if (CHOICES[key]) { if (CHOICES[key].some(function (c) { return c[0] === v; })) th[key] = v; }
    else if (key === 'radius') { v = Number(v); if (isFinite(v)) th.radius = Math.max(0, Math.min(30, v)); }
    else if (key === 'strips') th.strips = !!v;
    else if (key === 'textSize') { v = Number(v); if (isFinite(v)) th.textSize = Math.max(60, Math.min(200, Math.round(v))); }
  }

  P.colorSlots = colorSlots;
  P.theme = { LABELS: LABELS, FONTS: FONTS, KEYS: KEYS, apply: apply, migrate: migrate, value: value, cssFont: cssFont,
              items: KEYS.map(function (k) { return { key: k, label: LABELS[k] || k }; }),
              PRESETS: PRESETS, themeValue: themeValue, applyTheme: applyTheme, titleBar: titleBar, themeOptions: themeOptions, setThemeOption: setThemeOption };
  if (typeof module !== 'undefined') module.exports = P.theme;
})(typeof window !== 'undefined' ? window : globalThis);
