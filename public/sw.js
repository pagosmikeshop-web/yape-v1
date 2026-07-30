const CACHE_PREFIX = "yape-public-assets-";
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const OFFLINE_PAGE = "/offline.html";
const PUBLIC_SHELL = [
  OFFLINE_PAGE,
  "/manifest.webmanifest",
  "/icons/yape-192.png",
  "/icons/yape-512.png",
  "/icons/yape-maskable-512.png",
];
const PUBLIC_ASSET_PREFIXES = ["/assets/", "/icons/"];

function isCacheablePublicAsset(request, url) {
  return (
    request.method === "GET"
    && url.origin === self.location.origin
    && (
      PUBLIC_SHELL.includes(url.pathname)
      || PUBLIC_ASSET_PREFIXES.some((prefix) =>
        url.pathname.startsWith(prefix),
      )
    )
  );
}

function responseMayBeCached(response) {
  if (
    !response.ok
    || (response.type !== "basic" && response.type !== "default")
  ) {
    return false;
  }

  const policy = response.headers.get("cache-control")?.toLowerCase() ?? "";
  return (
    !policy.includes("no-store")
    && !policy.includes("private")
    && !response.headers.has("set-cookie")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PUBLIC_SHELL))
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_PAGE)),
    );
    return;
  }

  // Todas las APIs permanecen network-only y nunca entran en Cache Storage.
  if (!isCacheablePublicAsset(request, url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkResponse = fetch(request).then((response) => {
        if (responseMayBeCached(response)) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)),
          );
        }
        return response;
      });

      if (cached) {
        event.waitUntil(networkResponse.then(() => undefined).catch(() => undefined));
        return cached;
      }

      return networkResponse;
    }),
  );
});
