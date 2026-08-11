import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
function readSource(relativePath: string) {
  return readFileSync(resolve(root, relativePath), "utf8").replace(/\r\n/gu, "\n");
}

const pwaRuntime = readSource("app/components/PwaRuntime.tsx");
const serviceWorker = readSource("public/sw.js");
const versionRoute = readSource("app/api/pwa/version/route.ts");
const capacitorConfig = readSource("capacitor.config.ts");

describe("contrato de actualización PWA", () => {
  it("consulta la versión sin caché y detecta workers pendientes", () => {
    expect(pwaRuntime).toContain('fetch("/api/pwa/version"');
    expect(pwaRuntime).toContain('cache: "no-store"');
    expect(pwaRuntime).toContain("registration.waiting");
    expect(pwaRuntime).toContain('return `/sw.js?build=${encodeURIComponent(PWA_BUILD_VERSION)}`');
    expect(pwaRuntime).toContain('register(serviceWorkerUrl(), { scope: "/", updateViaCache: "none" })');
    expect(pwaRuntime).toContain("registration.update()");
    expect(pwaRuntime).toContain("latestAppVersion.current");
  });

  it("activa el worker nuevo y recarga después del cambio de controlador", () => {
    expect(pwaRuntime).toContain('postMessage({ type: "SKIP_WAITING" })');
    expect(pwaRuntime).toContain("navigator.serviceWorker.addEventListener(");
    expect(pwaRuntime).toContain('"controllerchange"');
    expect(pwaRuntime).toContain("window.location.reload()");
    expect(serviceWorker).toContain("self.skipWaiting()");
    expect(serviceWorker).toContain("self.clients.claim()");
  });

  it("evita cachear APIs y publica la versión con no-store", () => {
    expect(serviceWorker).toContain('function isApiRequest(url)');
    expect(serviceWorker).toContain('if (!isSameOriginGet(request, url) || isApiRequest(url)) return;');
    expect(versionRoute).toContain('cache-control": "no-store, max-age=0"');
    expect(versionRoute).toContain("NEXT_PUBLIC_BUILD_VERSION");
  });

  it("versiona los caches con el build actual y conserva una salida segura para workers previos", () => {
    expect(serviceWorker).toContain('searchParams.get("build")');
    expect(serviceWorker).toContain('replace(/[^a-zA-Z0-9._-]/g, "") || "v5"');
    expect(serviceWorker).toContain('`${APP_CACHE_PREFIX}${CACHE_VERSION}`');
    expect(serviceWorker).toContain('`${RUNTIME_CACHE_PREFIX}${CACHE_VERSION}`');
  });

  it("mantiene la entrega como PWA y no convierte Capacitor en una dependencia remota", () => {
    expect(capacitorConfig).toContain('webDir: "out"');
    expect(capacitorConfig).not.toContain("server:");
    expect(capacitorConfig).toContain("una única web/PWA");
  });
});
