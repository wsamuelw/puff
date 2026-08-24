// Bump this version whenever app.js / style.css / index.html change —
// assets are served cache-first, so same-name caches mean users never see updates
const CACHE_NAME = 'puff-v97';
const RUNTIME_CACHE = 'puff-runtime-v1';

// Relative paths — resolve against the SW location, so this works both at
// /puff/ on GitHub Pages and at a domain root in local development
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

// Install — cache core assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Firebase data APIs — always live, never cached (auth tokens, doc reads/writes)
  if (url.hostname === 'firestore.googleapis.com' ||
      url.hostname === 'identitytoolkit.googleapis.com' ||
      url.hostname === 'securetoken.googleapis.com') {
    return; // default browser handling
  }

  // Google Fonts + the Firebase JS SDK files — stale-while-revalidate.
  // Caching the SDK files is what keeps the app bootable offline.
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const isFirebaseSdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (isFont || isFirebaseSdk) {
    e.respondWith(
      caches.open(RUNTIME_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const fetching = fetch(e.request).then(response => {
            cache.put(e.request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || fetching;
        })
      )
    );
    return;
  }

  // Navigation — network first, cache fallback
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }

  // Core assets — cache first (ignoreSearch lets style.css?v=77 hit the cached style.css)
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => cached || fetch(e.request))
  );
});
