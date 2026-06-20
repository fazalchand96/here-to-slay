// Service Worker for Here To Slay Mobile PWA
// NOTE: bump CACHE_VERSION whenever the app shell (HTML/JS/CSS) changes so old
// caches are purged on activate. A stale shell can serve outdated JS and break
// the app (e.g. "io is not defined" when an old index.html/app.js is served).
const CACHE_VERSION = 'hts-v10';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/app_icon.png',
  '/tabletop-bg.jpg',
  '/tavern-bg.jpg',
  '/sounds/dice.ogg',
  // Add recorded SFX here as you enable them in app.js SOUND_FILES, e.g.
  // '/sounds/slash.ogg', '/sounds/win.ogg', so they're cached for offline play.
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap'
];

// Install: precache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      console.log('[SW] Precaching app shell');
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  // Activate immediately without waiting for old SW to retire
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all open clients immediately
  self.clients.claim();
});

// Fetch: route requests through cache or network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip caching for Socket.IO and WebSocket requests (multiplayer must stay live)
  if (
    url.pathname.startsWith('/socket.io') ||
    event.request.headers.get('upgrade') === 'websocket'
  ) {
    return; // Let the browser handle it normally
  }

  // Network-first for navigation requests (HTML pages)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the fresh response for offline fallback
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Offline: serve from cache
          return caches.match(event.request).then((cached) => {
            return cached || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // Network-first for the app shell code (JS/CSS) so fresh code always wins when
  // online; fall back to cache only when offline. This prevents stale scripts
  // from breaking the live app during development.
  const isAppCode = event.request.destination === 'script' ||
                    event.request.destination === 'style' ||
                    /\.(?:js|css)$/.test(url.pathname);
  if (isAppCode) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for heavy static assets (images, sounds, fonts) that rarely change.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        // Only cache successful same-origin or CORS responses
        if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
