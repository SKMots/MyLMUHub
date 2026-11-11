// Live data: a WebSocket to the app's local server ("/ws"). Messages: { "type":"state", "standings", "top", "car", "track", "forecast", "pb", "rel", "pred" } and
// { "type":"map", "track", "complete", "points" } (the track outline, only when it changes). Reconnects by itself.
(function (root) {
  'use strict';
  var P = root.MyLMUHub = root.MyLMUHub || {};
  P.connect = function (store, opts) {
    opts = opts || {}; var delay = 500, ws;
    var url = opts.url || ((root.location.protocol === 'https:' ? 'wss://' : 'ws://') + root.location.host + '/ws');
    function open() {
      store.set({ status: 'connecting' });
      try { ws = new root.WebSocket(url); } catch (e) { retry(); return; }
      ws.onopen = function () { delay = 500; store.set({ status: 'live' }); };
      ws.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m && m.type === 'state') store.set({ standings: m.standings || null, top: m.top || null, car: m.car || null, track: m.track || null, forecast: m.forecast || null, pb: m.pb || null, rel: m.rel || null, pred: m.pred || null, status: 'live' });
        else if (m && m.type === 'map') store.set({ map: m });                       // the learned track outline (rare)
        else if (m && m.type === 'layout') store.set({ layoutMsg: { by: m.by || '', at: Date.now() } });   // a page saved the layout file (theme, keys, views: hub Race Control page)
      };
      ws.onclose = retry; ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }
    function retry() { store.set({ status: 'reconnecting' }); setTimeout(open, delay); delay = Math.min(delay * 2, 5000); }
    open();
  };
})(typeof window !== 'undefined' ? window : globalThis);
