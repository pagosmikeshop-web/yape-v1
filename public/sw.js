const CACHE_NAME = "yape-public-assets-v2";
const PUBLIC_SHELL = ["/manifest.webmanifest"];
const PUBLIC_ASSET_PREFIXES = ["/assets/", "/icons/"];

function isCacheablePublicAsset(request, url) {
  return request.method === "GET"
    && url.origin === self.location.origin
    && (
      PUBLIC_SHELL.includes(url.pathname)
      || PUBLIC_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
    );
}

function responseMayBeCached(response) {
  if (!response.ok || (response.type !== "basic" && response.type !== "default")) return false;
  const policy = response.headers.get("cache-control")?.toLowerCase() ?? "";
  return !policy.includes("no-store") && !policy.includes("private") && !response.headers.has("set-cookie");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PUBLIC_SHELL))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Las navegaciones y todas las APIs permanecen network-only. De esta forma
  // una página autenticada nunca queda disponible en Cache Storage.
  if (!isCacheablePublicAsset(request, url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (responseMayBeCached(response)) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)),
          );
        }
        return response;
      });
    }),
  );
});
