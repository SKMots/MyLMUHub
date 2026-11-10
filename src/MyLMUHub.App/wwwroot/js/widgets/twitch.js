// Twitch chat: a channel's live chat, made to be read at a glance while driving: big text, the name in its own (readable) colour, newest at the bottom,
// Twitch emotes as pictures, removed / timed-out messages disappear. Read-only and anonymous: Twitch's public chat connection (IRC over WebSocket,
// wss://irc-ws.chat.twitch.tv) as a guest "justinfanNNNN" - no account, no key. Viewers: the app asks decapi.me once a minute (/api/twitch).
// Options: channel, viewer count, hide messages after a time, text size. Pure parsing in P.twitch.parse (tested).
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {}, D = P.dom;
  var MAX = 60;                                                                         // messages kept on screen (older ones are removed)

  // one IRC line -> { cmd, tags, user, channel, text } (null = not a line we use)
  function parse(line) {
    var m = /^(?:@(\S+) )?(?::(\S+) )?(\S+)(?: ([^:]*?))?(?: :(.*))?$/.exec(line || ''); if (!m) return null;
    var tags = {}; (m[1] || '').split(';').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); tags[i < 0 ? kv : kv.slice(0, i)] = i < 0 ? '' : kv.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\'); });
    var params = (m[4] || '').trim().split(' ');
    return { cmd: m[3], tags: tags, user: (m[2] || '').split('!')[0], channel: (params[0] || '').replace(/^#/, ''), text: m[5] === undefined ? '' : m[5] };
  }
  // the message as parts: text and emotes ('25:0-4,12-16/1902:6-10' = emote id at code-point positions)
  function parts(text, emotes) {
    var cps = Array.from(text || ''), at = [];
    (emotes || '').split('/').forEach(function (e) { var p = e.split(':'); if (p.length < 2) return; p[1].split(',').forEach(function (r) { var q = r.split('-'); at.push({ id: p[0], a: +q[0], b: +q[1] }); }); });
    at.sort(function (x, y) { return x.a - y.a; });
    var out = [], i = 0;
    at.forEach(function (e) { if (e.a < i || e.b >= cps.length) return; if (e.a > i) out.push({ text: cps.slice(i, e.a).join('') }); out.push({ emote: e.id, text: cps.slice(e.a, e.b + 1).join('') }); i = e.b + 1; });
    if (i < cps.length) out.push({ text: cps.slice(i).join('') });
    return out;
  }
  // a name colour that reads on a dark panel: too dark -> mixed with white; none -> one picked from the name
  var FALLBACK = ['#FF7F50', '#1E90FF', '#9ACD32', '#FF69B4', '#DAA520', '#5F9EA0', '#B57EDC', '#2E8B57', '#D2691E', '#00BFFF'];
  function nameColor(c, name) {
    if (!/^#[0-9a-f]{6}$/i.test(c || '')) { var h = 0; for (var i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; c = FALLBACK[h % FALLBACK.length]; }
    var r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16), l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (l >= 0.5) return c;
    var k = (0.5 - l) / (1 - l) + 0.15;                                                   // lift towards white until it is light enough
    function mix(v) { return Math.round(v + (255 - v) * Math.min(1, k)); }
    return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
  }
  P.twitch = { parse: parse, parts: parts, nameColor: nameColor };

  var SL = P.colorSlots('twitch', [['bg', 'Background', 'panel'], ['border', 'Border', 'border'], ['strip', 'Top strip', 'accent'], ['title', 'Channel name', 'label'],
    ['text', 'Message text', 'white'], ['live', 'LIVE + viewers', 'red'], ['info', 'Notes (connecting, offline)', 'muted']]), K = SL.K;
  P.registerWidget({ type: 'twitch', title: 'Twitch chat', base: { w: 700, h: 900 }, colors: SL.list,
    options: [{ key: 'channel', label: 'Twitch channel', type: 'text', def: '' }, { key: 'viewers', label: 'Viewer count', def: true }, { key: 'colors', label: 'Names in their colour', def: true },
              { key: 'fade', label: 'Hide messages after', type: 'select', def: 0, choices: [[0, 'never'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']] },
              P.TEXT_SIZE_OPTION],
    create: function (host, ctx) {
      var set = ctx && ctx.settings, ch = String(P.opt(set, 'channel', '') || '').trim().toLowerCase().replace(/^#|^https?:\/\/(www\.)?twitch\.tv\//g, '').replace(/[^a-z0-9_]/g, '');
      var ts = P.opt(set, 'textSize', 100) / 100 * P.textScale(), fs = Math.round(28 * ts), fade = Number(P.opt(set, 'fade', 0)) || 0;
      var showViewers = P.shown(set, 'viewers', true), colors = P.shown(set, 'colors', true);
      var r = D.box('pw-tw', host, 0, 0, 700, 900); r.style.cssText += ';display:flex;flex-direction:column;background:' + K.bg + ';border:1px solid ' + K.border + ';border-radius:var(--pw-radius,8px);overflow:hidden;box-sizing:border-box';
      var strip = D.el('div', '', r); strip.style.cssText = 'height:4px;width:70px;margin-left:14px;background:' + K.strip;
      var head = D.el('div', '', r); head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 16px 6px;font-size:' + Math.round(fs * 0.8) + 'px;font-weight:700';
      var title = D.el('span', '', head); title.style.color = K.title; title.textContent = ch ? 'TWITCH · ' + ch.toUpperCase() : 'TWITCH CHAT';
      var live = D.el('span', '', head); live.style.cssText = 'margin-left:auto;color:' + K.live;
      var list = D.el('div', '', r); list.style.cssText = 'flex:1;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;padding:4px 16px 12px;gap:' + Math.round(fs * 0.35) + 'px;font-size:' + fs + 'px;line-height:1.3;color:' + K.text + ';word-wrap:break-word;overflow-wrap:anywhere';
      var note = D.el('div', '', list); note.style.cssText = 'color:' + K.info + ';font-size:' + Math.round(fs * 0.75) + 'px';
      var ws = null, alive = true, delay = 1000, retry = null, vtimer = null, ftimer = null;
      function say(t) { note.textContent = t; D.show(note, !!t); }
      function add(msg) {
        var row = D.el('div', '', list); row._t = Date.now(); if (msg.tags.id) row.setAttribute('data-id', msg.tags.id); row.setAttribute('data-user', (msg.user || '').toLowerCase());
        var name = D.el('span', '', row), who = msg.tags['display-name'] || msg.user;
        name.style.cssText = 'font-weight:800;color:' + (colors ? nameColor(msg.tags.color, who) : K.title); name.textContent = who + ' ';
        var action = /^\u0001ACTION (.*)\u0001$/.exec(msg.text), text = action ? action[1] : msg.text;
        parts(text, msg.tags.emotes).forEach(function (p) {
          if (p.emote) { var im = D.el('img', '', row); im.src = 'https://static-cdn.jtvnw.net/emoticons/v2/' + encodeURIComponent(p.emote) + '/default/dark/2.0'; im.alt = p.text; im.style.cssText = 'height:' + Math.round(fs * 1.25) + 'px;vertical-align:middle;margin:0 2px'; }
          else { var s = D.el('span', '', row); s.textContent = p.text; if (action) s.style.fontStyle = 'italic'; }
        });
        while (list.children.length > MAX + 1) list.removeChild(list.children[1]);       // [0] = the note
        say('');
      }
      function drop(e) { if (e && e.parentNode) e.parentNode.removeChild(e); }
      function remove(sel) { [].slice.call(list.querySelectorAll(sel)).forEach(drop); }
      function connect() {
        if (!alive || !ch || !root.WebSocket) return;
        say('Connecting to #' + ch + '…');
        try { ws = new root.WebSocket('wss://irc-ws.chat.twitch.tv:443'); } catch (e) { later(); return; }
        ws.onopen = function () { delay = 1000; ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands'); ws.send('PASS SCHMOOPIIE'); ws.send('NICK justinfan' + (10000 + Math.floor(Math.random() * 80000))); ws.send('JOIN #' + ch); };
        ws.onmessage = function (ev) {
          String(ev.data).split('\r\n').forEach(function (line) {
            if (!line) return;
            if (line.indexOf('PING') === 0) { ws.send('PONG' + line.slice(4)); return; }
            var m = parse(line); if (!m) return;
            if (m.cmd === 'PRIVMSG') add(m);
            else if (m.cmd === 'JOIN' || m.cmd === '366') { if (!list.children.length || list.children.length === 1) say('Connected to #' + ch + ': waiting for messages.'); }
            else if (m.cmd === 'CLEARMSG' && m.tags['target-msg-id']) remove('[data-id="' + m.tags['target-msg-id'].replace(/"/g, '') + '"]');
            else if (m.cmd === 'CLEARCHAT') { if (m.text) remove('[data-user="' + m.text.toLowerCase().replace(/"/g, '') + '"]'); else remove('[data-user]'); }
            else if (m.cmd === 'NOTICE' && /not exist|suspended|banned/i.test(m.text)) say(m.text);
          });
        };
        ws.onclose = function () { if (alive) later(); };
        ws.onerror = function () { try { ws.close(); } catch (e) {} };
      }
      function later() { say('Chat connection lost: trying again…'); clearTimeout(retry); retry = setTimeout(connect, delay); delay = Math.min(delay * 2, 30000); }
      function viewers() {
        if (!showViewers || !ch || !root.fetch || !/^https?:/.test((root.location || {}).protocol || '')) return;
        root.fetch('/api/twitch?channel=' + encodeURIComponent(ch)).then(function (x) { return x.json(); }).then(function (v) {
          live.textContent = v.live ? '● LIVE · ' + v.viewers + (v.viewers === 1 ? ' viewer' : ' viewers') : (v.error ? '' : 'offline');
          live.style.color = v.live ? K.live : K.info;
        }, function () {});
      }
      if (!ch) say('Set the Twitch channel: edit mode (E), then the gear ⚙ of this widget.');
      else { connect(); viewers(); vtimer = setInterval(viewers, 60000); }
      if (fade > 0) ftimer = setInterval(function () { var old = Date.now() - fade * 1000; [].slice.call(list.children, 1).forEach(function (e) { if (e._t < old) drop(e); }); }, 5000);
      return {
        update: function () {},                                                           // the chat does not use the game data
        resize: function (w, h) { r.style.width = w + 'px'; r.style.height = h + 'px'; },   // fills the box; the text keeps its size (Text size)
        destroy: function () { alive = false; clearTimeout(retry); clearInterval(vtimer); clearInterval(ftimer); if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} } drop(r); },
        _list: list, _add: add, _note: note, _live: live
      };
    } });
  if (typeof module !== 'undefined') module.exports = P.twitch;
})(typeof window !== 'undefined' ? window : globalThis);
