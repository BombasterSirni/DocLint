/* DocLint service worker: после первого открытия страница и проверка работают
   без сети. Кэшируются только статические файлы приложения, не документы. */

const CACHE_NAME = 'doclint-v1';

const APP_SHELL = [
  './',
  './index.html',
  './assets/css/styles.css',
  './assets/js/app.js',
  './assets/js/errors.js',
  './assets/js/xml.js',
  './assets/js/units.js',
  './assets/js/style-resolver.js',
  './assets/js/docx-parser.js',
  './assets/js/rules.js',
  './assets/js/report.js',
  './assets/js/profiles.js',
  './assets/js/presets.js',
  './assets/js/hints.js',
  './assets/js/demo.js',
  './assets/js/file-reader.js',
  './assets/vendor/jszip.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => {
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    }),
  );
});
