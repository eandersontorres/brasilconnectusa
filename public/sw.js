/* BrasilConnect Service Worker — v6
   Estratégias de cache (refatorado pra evitar stale asset hash):
   - Network First → APIs (sempre dados frescos)
   - Network First → HTML (deploy novo pega imediato; fallback offline)
   - Cache First (imutável) → /assets/* (Vite gera com content hash)
   - Cache First → fontes, imagens (mudam pouco; revalida em background)
   - Stale While Revalidate → JS/CSS legacy fora de /assets/
*/
// IMPORTANTE: bumpa CACHE_NAME a cada deploy estrutural (rename de arquivos).
// Vite hash-based assets nao precisam disso, mas mudancas em /sw.js sim.
const CACHE_NAME = 'bc-v6-network-first-html-2026-05-19';
const OFFLINE_URL = '/offline.html';
// Precache minimo — so o offline fallback e assets que nunca mudam de path
const PRECACHE = ['/offline.html', '/favicon.svg', '/img/logo-mark.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Heuristica: HTML = path raiz, terminado em /, .html, ou sem extensao
function isHtmlRequest(url, req) {
  const accept = req.headers.get('accept') || ''
  if (accept.includes('text/html')) return true
  const p = url.pathname
  if (p === '/' || p.endsWith('/')) return true
  if (p.endsWith('.html')) return true
  if (!/\.\w{1,8}$/.test(p)) return true   // sem extensao = HTML virtual route (ex: /app/feed)
  return false
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // So intercepta same-origin (evita problemas com cross-origin opaque)
  if (url.origin !== self.location.origin) {
    // Exceto pras fontes (Cache First)
    if (url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com')) {
      e.respondWith(
        caches.match(e.request).then(c => c || fetch(e.request).then(r => {
          const copy = r.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
          return r;
        }))
      );
    }
    return;
  }

  // ── 1. APIs — Network First (dados frescos) ──────────────────────────
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // ── 2. HTML — Network First (deploy novo pega imediato) ──────────────
  // Era o bug: SWR servia HTML antigo com referencias a /assets/*.js que
  // nao existem mais, quebrando o app. Agora HTML sempre vai pra rede;
  // cache so vira fallback offline.
  if (isHtmlRequest(url, e.request)) {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
        }
        return r;
      }).catch(() =>
        caches.match(e.request).then(c => c || caches.match(OFFLINE_URL))
      )
    );
    return;
  }

  // ── 3. Hashed assets (Vite build) — Cache First imutavel ─────────────
  // Vite gera /assets/*-<hash>.js que sao content-addressed e imutaveis.
  // Cache forever — se HTML novo pedir um hash que nao temos, vai pra
  // rede e adiciona ao cache.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then(c => c || fetch(e.request).then(r => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        }
        return r;
      }))
    );
    return;
  }

  // ── 4. Fontes / imagens — Cache First ───────────────────────────────
  if (/\.(?:woff2?|ttf|otf|png|jpg|jpeg|svg|webp|gif|ico)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(c => c || fetch(e.request).then(r => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        }
        return r;
      }))
    );
    return;
  }

  // ── 5. JS/CSS fora de /assets/ — Stale While Revalidate ─────────────
  // Cobre /css/premium.css, /js/site.js, /js/bc-modules.js que nao tem hash
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
