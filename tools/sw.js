// Ubiquitous System — service worker (offline app shell)
const CACHE = 'ubiq-v5';
const ASSETS = ['index.html', 'pattern-tracker.html', 'node-explorer.html',
                'decision-matrix.html', 'manifest.webmanifest', 'icon.svg',
                // Research Hub
                'research/index.html', 'research/style.css', 'research/data/classics-catalog.js',
                'research/vendor/pdf.min.js', 'research/vendor/pdf.worker.min.js',
                'research/js/core.js', 'research/js/tei.js', 'research/js/web.js', 'research/js/etym.js',
                'research/js/app.js', 'research/js/views-archive.js', 'research/js/views-classics.js',
                'research/js/views-etym-map.js', 'research/js/views-data-trails.js', 'research/js/bridge.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // App shell (same origin): cache-first so it works offline.
  // The bridge API (scripts/hub_bridge.py) is live data: never cache it.
  if (url.origin === location.origin && url.pathname.startsWith('/bridge/')) return;
  if (url.origin === location.origin) {
    // ignoreSearch: '?q=…' links (e.g. node-explorer.html?q=Logos) still hit the cached page offline
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).catch(() => r)));
  }
  // External open-knowledge APIs: go to network; they just fail gracefully offline.
});
