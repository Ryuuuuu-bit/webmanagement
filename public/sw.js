// Minimal service worker. Its only job is to exist with a fetch handler so
// Chrome/Android consider this site installable as a home-screen app — it
// intentionally does no caching, so it can never serve stale content.
// Every request just passes straight through to the network.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
