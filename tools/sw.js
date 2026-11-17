// Ubiquitous System — service worker (offline app shell)
const CACHE = 'ubiq-v1';
const ASSETS = ['index.html', 'learning-engine.html', 'node-explorer.html',
                'decision-matrix.html', 'manifest.webmanifest', 'icon.svg'];

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
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(() => r)));
  }
  // External open-knowledge APIs: go to network; they just fail gracefully offline.
});
