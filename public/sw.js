// Service Worker for Here To Slay Mobile PWA
// NOTE: bump CACHE_VERSION whenever the app shell (HTML/JS/CSS) changes so old
// caches are purged on activate. A stale shell can serve outdated JS and break
// the app (e.g. "io is not defined" when an old index.html/app.js is served).
const CACHE_VERSION = 'hts-v75';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/deck-stage.generated.css',
  '/app.js',
  '/anim.js',
  '/manifest.json',
  '/app_icon.png',
  '/tabletop-bg.jpg',
  '/tavern-bg.jpg',
  '/assets/skin/premium-tabletop-landscape.png',
  '/assets/skin/premium-tabletop-portrait.png',
  '/assets/skin/card-backs-sheet.png',
  '/assets/skin/card-frames-sheet.png',
  '/assets/skin/button-blanks-sheet.png',
  '/assets/skin/material-textures-sheet.png',
  '/assets/skin/ui-icons-sheet.png',
  '/assets/skin/cards/back-main.png',
  '/assets/skin/cards/back-hidden.png',
  '/assets/skin/anim/dice-roll.png',
  '/assets/skin/anim/cast-fighter.png',
  '/assets/skin/anim/cast-bard.png',
  '/assets/skin/anim/cast-guardian.png',
  '/assets/skin/anim/cast-ranger.png',
  '/assets/skin/anim/cast-thief.png',
  '/assets/skin/anim/cast-wizard.png',
  '/assets/skin/anim/monster-card_001.png',
  '/assets/skin/anim/monster-card_002.png',
  '/assets/skin/anim/monster-card_003.png',
  '/assets/skin/anim/monster-card_004.png',
  '/assets/skin/anim/monster-card_005.png',
  '/assets/skin/anim/monster-card_006.png',
  '/assets/skin/anim/monster-card_007.png',
  '/assets/skin/anim/monster-card_008.png',
  '/assets/skin/anim/monster-card_009.png',
  '/assets/skin/anim/monster-card_010.png',
  '/assets/skin/anim/monster-card_011.png',
  '/assets/skin/anim/monster-card_012.png',
  '/assets/skin/anim/monster-card_013.png',
  '/assets/skin/anim/monster-card_014.png',
  '/assets/skin/anim/monster-card_015.png',
  '/assets/skin/anim/burst-buff.png',
  '/assets/skin/anim/burst-debuff.png',
  '/assets/skin/anim/burst-damage.png',
  '/assets/skin/anim/burst-draw.png',
  '/assets/skin/anim/gameover-finale.png',
  '/assets/skin/icons/ap-full.png',
  '/assets/skin/icons/ap-empty.png',
  '/assets/skin/buttons/primary.png',
  '/assets/skin/buttons/draw-blue.png',
  '/assets/skin/buttons/reload-amber.png',
  '/assets/skin/buttons/danger-red.png',
  '/assets/skin/buttons/disabled-dark.png',
  '/assets/skin/buttons/icon-round.png',
  '/assets/skin/textures/parchment.png',
  '/assets/skin/textures/monster-leather.png',
  '/assets/skin/textures/leather.png',
  '/assets/skin/textures/emerald-leather.png',
  '/assets/skin/textures/blackened-iron.png',
  // One frame per card type — leader and cursed no longer borrow another type's.
  '/assets/skin/frames/leader.png',
  '/assets/skin/frames/hero.png',
  '/assets/skin/frames/monster.png',
  '/assets/skin/frames/magic.png',
  '/assets/skin/frames/item.png',
  '/assets/skin/frames/cursed.png',
  '/assets/skin/frames/modifier.png',
  '/assets/skin/frames/challenge.png',
  '/assets/skin/cards/back-leader.png',
  // Class crests (crest-v2): the animal of each class, shown on the leader's
  // medallion. The old crest-*.png set had no Bard and is no longer referenced.
  '/assets/skin/icons/crest-v2/fighter.png',
  '/assets/skin/icons/crest-v2/bard.png',
  '/assets/skin/icons/crest-v2/guardian.png',
  '/assets/skin/icons/crest-v2/ranger.png',
  '/assets/skin/icons/crest-v2/thief.png',
  '/assets/skin/icons/crest-v2/wizard.png',
  '/assets/skin/icons/sound.png',
  '/assets/skin/icons/menu.png',
  '/assets/skin/icons/close.png',
  '/assets/skin/icons/deck.png',
  '/assets/skin/icons/discard.png',
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
