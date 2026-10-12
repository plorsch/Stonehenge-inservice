// Keeps the iPad off the host's "502 Bad Gateway" page. When the site is restarting (a new version
// going live) the kiosk page is served from the last good copy instead, and that page reloads itself
// once the site answers again. Only the kiosk page and its files are handled; admin and API calls pass through.
const CACHE = 'kiosk-v1';
const SHELL = ['/', '/format.js', '/logo.png'];

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const page = e.request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html');
  const key = page ? '/' : url.pathname;
  if (!page && !SHELL.includes(key)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request, { cache: 'no-store' });
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); return res; }
      if (res.status < 500) return res;
    } catch { /* network down */ }
    return (await caches.match(key)) || fetch(e.request);
  })());
});
