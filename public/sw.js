const CACHE_PREFIX = 'omnitraf-build-';
const CACHE_NAME = `${CACHE_PREFIX}v12`;
const APP_SHELL = ['/index.html'];
const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css|png|jpe?g|webp|svg|woff2?)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

function isLiveRequest(request, url) {
  return request.method !== 'GET' || request.headers.has('Authorization') ||
    url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isLiveRequest(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy)));
      }
      return response;
    }).catch(async () => (await caches.match('/index.html', { cacheName: CACHE_NAME })) || Response.error()));
    return;
  }

  if (!HASHED_ASSET.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
    return response;
  })());
});
