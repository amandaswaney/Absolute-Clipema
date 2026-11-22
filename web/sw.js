// Absolute Clipema service worker. Keeps the app shell available offline and loads updates in the background.
const BUILD = 'dev';
const CACHE = 'clipema-' + BUILD;
const SHELL = ['./', 'index.html', 'css/app.css', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo.jpg',
  'js/app.js', 'js/db.js', 'js/ui.js', 'js/views.js', 'js/create.js', 'js/admin.js', 'js/import.js', 'js/clipper.js', 'js/themes.js', 'vendor/firebase.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('clipema-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/ffmpeg/')) return; // large, the browser's own cache handles it
  // Network first so new versions show up straight away, cache when offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
