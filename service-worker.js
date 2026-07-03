const CACHE_NAME = 'carcare-v2';
const ASSETS = [];

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
          caches.keys().then((keys) =>
                  Promise.all(keys.map((k) => caches.delete(k)))
                                 )
        );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('data.gov.il')) return;
    if (event.request.url.includes('supabase.co')) return;

                        event.respondWith(
                              fetch(event.request)
                                .then((response) => {
                                          const clone = response.clone();
                                          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                                          return response;
                                })
                                .catch(() => caches.match(event.request))
                            );
});
