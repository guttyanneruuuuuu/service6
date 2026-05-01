/* Pinly Service Worker — オフラインで地図シェルとシードを使えるようにする最低限の SW */
const VERSION = 'pinly-v5';
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
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 地図タイル: stale-while-revalidate
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

  // 同一オリジン: cache first → network fallback
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((cached) => {
        return cached || fetch(req).then((res) => {
          // 成功したらキャッシュへ
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => {
          // オフラインのフォールバック (ナビゲーション)
          if (req.mode === 'navigate') return caches.match('./index.html');
        });
      })
    );
  }
});
