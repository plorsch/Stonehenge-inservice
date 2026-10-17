// Admin home-screen app: shows the phone alert and sets the red badge when the site sends a push.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'In-service', body: e.data ? e.data.text() : '' }; }
  const badge = Number(d.badge);
  const jobs = [self.registration.showNotification(d.title || 'In-service', { body: d.body || '', icon: '/admin-icon-192.png', badge: '/admin-icon-192.png', tag: d.tag || 'inservice', renotify: true, data: { url: d.url || '/admin' } })];
  if (Number.isFinite(badge) && self.navigator && self.navigator.setAppBadge) jobs.push(badge > 0 ? self.navigator.setAppBadge(badge) : self.navigator.clearAppBadge());
  e.waitUntil(Promise.all(jobs).catch(() => {}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/admin';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.includes('/admin'));
    if (open) { open.navigate(url).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
