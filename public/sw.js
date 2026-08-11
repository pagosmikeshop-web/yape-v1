const APP_CACHE_PREFIX = "yape-app-shell-";
const RUNTIME_CACHE_PREFIX = "yape-runtime-assets-";
const requestedCacheVersion = new URL(self.location.href).searchParams.get("build") ?? "";
const CACHE_VERSION = requestedCacheVersion.replace(/[^a-zA-Z0-9._-]/g, "") || "v5";
const APP_CACHE_NAME = `${APP_CACHE_PREFIX}${CACHE_VERSION}`;
const RUNTIME_CACHE_NAME = `${RUNTIME_CACHE_PREFIX}${CACHE_VERSION}`;
const OFFLINE_PAGE = "/offline.html";
const PUBLIC_SHELL = [
  OFFLINE_PAGE,
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/favicon-16.png",
  "/icons/favicon-32.png",
  "/icons/apple-touch-icon.png",
  "/icons/yape-192.png",
  "/icons/yape-512.png",
  "/icons/yape-maskable-512.png",
];
const PUBLIC_ASSET_PREFIXES = ["/_next/static/", "/assets/", "/icons/"];

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

function isSameOriginGet(request, url) {
  return request.method === "GET" && url.origin === self.location.origin;
}

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
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
      .open(APP_CACHE_NAME)
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
              (key) =>
                (
                  key.startsWith(APP_CACHE_PREFIX)
                  || key.startsWith(RUNTIME_CACHE_PREFIX)
                )
                && key !== APP_CACHE_NAME
                && key !== RUNTIME_CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // Messages are only accepted from the same-origin page (or from the
  // registration API, which does not expose an origin/source in every
  // browser). This keeps the update command narrow and avoids treating
  // arbitrary cross-origin messages as control instructions.
  if (event.origin && event.origin !== self.location.origin) return;
  const source = event.source;
  if (source && typeof source.url === "string") {
    try {
      if (new URL(source.url).origin !== self.location.origin) return;
    } catch {
      return;
    }
  }
  const data = event.data;
  if (!data || typeof data !== "object" || data.type !== "SKIP_WAITING") return;
  self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (!isSameOriginGet(request, url) || isApiRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_PAGE)),
    );
    return;
  }

  if (!isCacheablePublicAsset(request, url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkResponse = fetch(request).then((response) => {
        if (responseMayBeCached(response)) {
          const copy = response.clone();
          event.waitUntil(
            caches
              .open(
                PUBLIC_SHELL.includes(url.pathname)
                  ? APP_CACHE_NAME
                  : RUNTIME_CACHE_NAME,
              )
              .then((cache) => cache.put(request, copy)),
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
