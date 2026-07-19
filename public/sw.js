// Service Worker for Here To Slay Mobile PWA
// App code changes often, while card and board art rarely changes. Keeping those
// caches separate prevents every code deployment from downloading all art again.
const SHELL_CACHE = 'hts-shell-v135';
// Keep this stable across code-only deploys. Bump it only when an existing
// image/audio URL is replaced with different content.
const MEDIA_CACHE = 'hts-media-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/deck-stage.generated.css',
  '/app.js',
  '/anim.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((name) => (
          (name.startsWith('hts-shell-') && name !== SHELL_CACHE) ||
          name.startsWith('hts-v')
        ))
        .map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

function isCacheableResponse(response) {
  return response &&
    response.status === 200 &&
    (response.type === 'basic' || response.type === 'cors');
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (isCacheableResponse(response)) {
        const clone = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
      }
      return response;
    })
    .catch(() => caches.match(request));
}

function mediaCacheFirst(request) {
  return caches.open(MEDIA_CACHE).then((cache) => (
    cache.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (isCacheableResponse(response)) {
          cache.put(request, response.clone());
        }
        return response;
      });
    })
  ));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (
    url.pathname.startsWith('/socket.io') ||
    event.request.headers.get('upgrade') === 'websocket'
  ) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      networkFirst(event.request).then((response) => (
        response || caches.match('/index.html')
      ))
    );
    return;
  }

  const isAppCode = event.request.destination === 'script' ||
    event.request.destination === 'style' ||
    /\.(?:js|css)$/.test(url.pathname);
  if (isAppCode) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  const isMedia = ['audio', 'font', 'image'].includes(event.request.destination) ||
    /\.(?:avif|gif|ico|jpe?g|ogg|png|svg|webp|woff2?)$/.test(url.pathname);
  if (isMedia) {
    event.respondWith(mediaCacheFirst(event.request));
  }
});
