/* Constellate service worker.
 * Offline shell + static asset caching. Never caches API responses (those go to
 * api.constellate.me and carry private data). Strategy:
 *   - navigations: network-first, fall back to cached app shell when offline
 *   - same-origin static assets (js/css/img/font): cache-first
 *   - everything cross-origin (the API, fonts CDN): pass through (network only)
 */
const VERSION = "constellate-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const SHELL_URL = "/index.html";
const OFFLINE_FALLBACK = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(["/", SHELL_URL, "/manifest.webmanifest", "/icon-192.png", "/favicon.svg"]).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return /\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|webp|ico|json|webmanifest)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle our own origin. The API and any cross-origin requests pass through.
  if (url.origin !== self.location.origin) return;

  // App navigations: network-first with offline shell fallback (SPA).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((cache) => cache.put(SHELL_URL, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached || caches.match(OFFLINE_FALLBACK))),
    );
    return;
  }

  // Static assets: cache-first, then network (and populate cache).
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(ASSETS).then((cache) => cache.put(req, copy)).catch(() => undefined);
            return res;
          }),
      ),
    );
  }
});
