/**
 * Public app shell and static asset cache. API, Socket.io, auth and map tiles
 * stay network-only so an offline response can never look like live state.
 */
const CACHE_NAME = 'omnitraf-sits-v9';
const SHELL_CACHE_NAME = 'omnitraf-sits-v9-shell';
const APP_SHELL = ['/index.html', '/style.css', '/css/main.css', '/manifest.webmanifest'];
const STATIC_PATH = /^\/(?:src|css|assets)\/.+\.(?:js|css|png|jpe?g|webp|svg|woff2?)$/i;
const MAX_STATIC_ENTRIES = 120;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('omnitraf-sits-') && key !== CACHE_NAME && key !== SHELL_CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isPublicStaticRequest(request, url) {
  return request.method === 'GET' &&
    url.origin === self.location.origin &&
    !request.headers.has('Authorization') &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/socket.io/') &&
    STATIC_PATH.test(url.pathname);
}

async function cacheStaticResponse(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  const keys = await cache.keys();
  const overflow = keys.length - MAX_STATIC_ENTRIES;
  if (overflow > 0) {
    await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Live and privileged data is always network-only, including responses
  // that were cached by an older service worker version.
  if (url.origin === self.location.origin && (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    request.headers.has('Authorization') ||
    request.method !== 'GET'
  )) return;

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(SHELL_CACHE_NAME).then((cache) => cache.put('/index.html', copy)));
      }
      return response;
    }).catch(async () => (await caches.match('/index.html', { cacheName: SHELL_CACHE_NAME })) || Response.error()));
    return;
  }

  if (!isPublicStaticRequest(request, url)) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then((response) => {
      event.waitUntil(cacheStaticResponse(request, response.clone()).catch(() => {}));
      return response;
    });
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  })());
});
