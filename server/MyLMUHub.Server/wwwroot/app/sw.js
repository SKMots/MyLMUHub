// My LMU Hub as a phone app (2026-11-16): keeps the app's own files (page, styles, scripts, icons) so it starts without a connection and then says it is offline.
// Always the network first (a new version shows at once), the kept copy only when the network fails. The data (/api/...) and the log-in (/auth/...) are never
// kept: they always come from the server.
var V = 'mlh-app-1';
var SHELL = ['/app/', '/app/manifest.webmanifest', '/css/site.css', '/js/app.js', '/js/shared/format.js', '/js/shared/pace-math.js', '/js/shared/pace-ref.js',
  '/js/shared/strategy-math.js', '/js/shared/review-math.js', '/js/shared/live-car.js', '/img/icon-192.png', '/img/icon-180.png', '/img/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin || u.pathname.indexOf('/api/') === 0 || u.pathname.indexOf('/auth/') === 0) return;
  e.respondWith(fetch(r).then(function (res) {
    if (res.ok && res.type === 'basic') { var copy = res.clone(); caches.open(V).then(function (c) { c.put(r, copy); }); }
    return res;
  }, function () {
    return caches.match(r, { ignoreSearch: true }).then(function (hit) { return hit || (r.mode === 'navigate' ? caches.match('/app/') : Response.error()); });
  }));
});
