/* Pinly Service Worker v6 (2026-05-02)
   - bumped version → forces clients to drop the broken v5 cache
   - HTML / JS / CSS use network-first to avoid serving stale UI
   - Map tiles still use stale-while-revalidate
   - Supabase / GA / esm.sh requests are NEVER cached (always live)
*/
const VERSION = 'pinly-v6-2026-05-02';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './og.svg',
  './pins.json',
  './page.css',
  './about.html',
  './terms.html',
  './privacy.html',
  './contact.html',
  './404.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(CORE).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION && k !== 'pinly-tiles').map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Allow page to ping us to force refresh
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

function isHTMLorAsset(url) {
  return /\.(html|js|mjs|css|json|webmanifest)$/i.test(url.pathname) || url.pathname === '/' || url.pathname.endsWith('/service6/');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache realtime / API / 3rd-party scripts
  if (
    /supabase\.co$/.test(url.host) ||
    /google-analytics\.com$|googletagmanager\.com$/.test(url.host) ||
    /esm\.sh$/.test(url.host)
  ) {
    return; // let the network handle it directly
  }

  // Map tiles: stale-while-revalidate
  if (/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/.test(url.host)) {
    e.respondWith(
      caches.open('pinly-tiles').then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Same-origin
  if (url.origin === location.origin) {
    // HTML/JS/CSS: network-first (so updates show up immediately)
    if (isHTMLorAsset(url)) {
      e.respondWith((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.status === 200 && fresh.type === 'basic') {
            const copy = fresh.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          if (req.mode === 'navigate') return caches.match('./index.html');
          throw new Error('offline');
        }
      })());
      return;
    }

    // Other same-origin assets (images, etc): cache-first
    e.respondWith(
      caches.match(req).then((cached) => {
        return cached || fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => {
          if (req.mode === 'navigate') return caches.match('./index.html');
        });
      })
    );
  }
});
