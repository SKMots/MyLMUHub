// A tiny state store: the network layer sets the latest state, the layout manager passes it to the widgets.
(function (root) {
  'use strict';
  var P = root.Pitwall = root.Pitwall || {};
  function Store() { this.state = { standings: null, status: 'starting' }; this.subs = []; }
  Store.prototype.set = function (patch) {
    for (var k in patch) this.state[k] = patch[k];
    for (var i = 0; i < this.subs.length; i++) { try { this.subs[i](this.state); } catch (e) { if (root.console) console.error(e); } }
  };
  Store.prototype.subscribe = function (fn) { this.subs.push(fn); };
  P.Store = Store;
  if (typeof module !== 'undefined') module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
