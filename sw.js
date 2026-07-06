/**
 * sw.js — offline support for the PWA / Android app.
 *
 * Strategy:
 *  - App shell (html/js/css/icons): cache-first with background refresh
 *    (stale-while-revalidate), so the app opens instantly and offline.
 *  - catalog.json: network-first, cached fallback — fresh data when online,
 *    last-known catalog when offline.
 *  - Audio streams / Supabase API calls: never intercepted (network only).
 */
const VERSION = 'bmtm-v15'; // bump whenever shell files change — forces every client to refetch
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/catalog.js',
  './js/player.js',
  './js/visualizer.js',
  './js/artwork.js',
  './js/pcloud.js',
  './js/backend.js',
  './js/config.js',
  './js/trackform.js',
  './js/ytmeta.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache:'reload' bypasses the HTTP cache so a new SW version always
  // installs genuinely fresh copies of the shell
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // never touch cross-origin (Supabase, pCloud, YouTube, CDN) requests
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith('/data/catalog.json')) {
    // network-first
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // shell: stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
