/* BrasilConnect Service Worker
   3 estratégias de cache:
   - Network First → APIs (sempre dados frescos)
   - Cache First   → fontes, imagens, ícones
   - Stale While Revalidate → HTML, JS, CSS (rápido, atualiza em background)
*/
const CACHE_NAME = 'bc-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = ['/', '/offline.html', '/css/premium.css', '/js/site.js', '/img/logo.svg', '/img/logo-mark.svg', '/favicon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Network First — APIs
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Cache First — fontes, imagens, fonts.googleapis
  if (/\.(?:woff2?|ttf|otf|png|jpg|jpeg|svg|webp|gif|ico)$/.test(url.pathname) ||
      url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com')) {
    e.respondWith(
      caches.match(e.request).then(c => c || fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        return r;
      }))
    );
    return;
  }

  // Stale While Revalidate — HTML/JS/CSS
  e.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(e.request).then(cached => {
        const fetchP = fetch(e.request).then(r => {
          if (r.ok) cache.put(e.request, r.clone());
          return r;
        }).catch(() => cached || caches.match(OFFLINE_URL));
        return cached || fetchP;
      })
    )
  );
});

// Push notification
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  const title = data.title || 'BrasilConnect';
  const options = {
    body: data.body || 'Você tem uma notificação',
    icon: '/img/logo-mark.svg',
    badge: '/favicon.svg',
    tag: data.type || 'general',
    data: { url: data.url || '/' },
    actions: data.actions || []
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if (c.url.includes(url) && 'focus' in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});
