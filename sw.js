/* Service worker: офлайн-оболочка и кэш последнего news.json. */
const CACHE_NAME = 'my-best-newspaper-v18';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Новости, полные статьи и переводы — network-first: свежие данные важнее, но офлайн отдаём кэш.
  if (
    url.pathname.endsWith('/data/news.json') ||
    url.pathname.endsWith('/data/articles.json') ||
    url.pathname.endsWith('/data/translations.json') ||
    url.pathname.endsWith('/data/summaries.json') ||
    url.pathname.includes('/data/digest/')
  ) {
    const cacheKey = new Request(`${url.origin}${url.pathname}`);

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(cacheKey).then(
            (cached) =>
              cached ||
              new Response(JSON.stringify({ error: 'offline', items: [] }), {
                status: 503,
                headers: { 'content-type': 'application/json; charset=utf-8' },
              }),
          ),
        ),
    );
    return;
  }

  // Оболочка — cache-first с обновлением кэша.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && ['script', 'style', 'image', 'font'].includes(request.destination)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
