/**
 * OmniTRAF Surabaya - Service Worker (PWA Offline & Caching Engine)
 * Cache statis untuk antarmuka Command Center, Leaflet & MarkerCluster CDN, modul ES6,
 * serta fallback offline resiliency jika jaringan terputus.
 */

const CACHE_NAME = 'omnitraf-sits-v5';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.webmanifest',
  '/assets/favicon.png',
  '/assets/omnitraf-icon.png',
  '/assets/omnitraf-logo.png',
  '/src/app.js',
  '/src/config/surabayaCoords.js',
  '/src/config/trafficConfig.js',
  '/src/core/stateStore.js',
  '/src/core/soundManager.js',
  '/src/core/diagnostics.js',
  '/src/core/disposer.js',
  '/src/modules/mapManager.js',
  '/src/modules/trafficEngine.js',
  '/src/modules/cctvController.js',
  '/src/modules/chatSystem.js',
  '/src/modules/uiMarquee.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300..800;1,300..800&family=Share+Tech+Mono&display=swap'
];

// 1. Install Event: Pre-caching static & CDN assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.info('[SW] Pre-caching critical application assets...');
      return Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Partial pre-cache bypass for:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.info('[SW] Menghapus cache lawas:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Intelligent Offline & Cache Fallback Strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Jangan cache real-time streaming, socket handshake, atau REST mutation
  if (
    url.pathname.startsWith('/socket.io/') ||
    url.pathname.startsWith('/api/stream') ||
    request.method !== 'GET'
  ) {
    return;
  }

  // Strategi 1: Navigasi HTML SPA (Network-first dengan fallback cache)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match('/index.html') || caches.match('/');
        })
    );
    return;
  }

  // Strategi 2: CartoDB Tiles (Cache-First dengan graceful fallback)
  if (url.hostname.includes('cartocdn.com') || url.hostname.includes('openstreetmap.org')) {
    event.respondWith(
      caches.match(request).then((cachedTile) => {
        if (cachedTile) return cachedTile;
        return fetch(request).then((networkTile) => {
          if (networkTile && networkTile.status === 200) {
            const clone = networkTile.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkTile;
        }).catch(() => {
          // Transparent 1x1 fallback pixel to avoid broken image icons in Leaflet offline
          return new Response(
            Uint8Array.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
              0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
              0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
              0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
              0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
              0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
            ]),
            { headers: { 'Content-Type': 'image/png' } }
          );
        });
      })
    );
    return;
  }

  // Strategi 3: Aset Statis & CDN (Stale-While-Revalidate)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Abaikan error jaringan jika offline
        });

      return cachedResponse || fetchPromise;
    })
  );
});
