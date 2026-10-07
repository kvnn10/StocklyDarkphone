const CACHE_NAME = "stockly-shell-v2";
const STATIC_DESTINATIONS = new Set(["script", "style", "font", "image"]);

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // Keep authenticated/API responses out of the cache. Stockly's inventory
  // and transactional data must always come from the server.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Cache only successful same-origin static assets after they are requested.
  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;

        try {
          const response = await fetch(request);
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return cached;
        }
      })
    );
  }
});
