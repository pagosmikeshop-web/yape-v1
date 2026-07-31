import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CapabilityError,
  capabilityErrorMessage,
  normalizeCapabilityError,
} from "../app/lib/capability-errors";
import { copyText, shareText, subscribeToNetworkState } from "../app/lib/platform-adapters";
import { getRuntimePlatform } from "../app/lib/platform";
import { YapePwaBridgeWeb } from "../app/lib/pwa-bridge.web";
import { subscribeToWebLifecycle } from "../app/lib/web-lifecycle";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("capability contracts in SSR", () => {
  it("does not access browser APIs while rendering on the server", () => {
    const runtime = getRuntimePlatform();
    expect(runtime.isNative).toBe(false);
    expect(runtime.isInstalledApp).toBe(false);
    expect(runtime.capabilities.mediaDevices).toBe(false);
    expect(runtime.capabilities.serviceWorker).toBe(false);
  });

  it("returns normalized errors when clipboard/share are unavailable", async () => {
    const clipboard = await copyText("contenido de prueba");
    const sharing = await shareText({ text: "contenido de prueba" });

    expect(clipboard.ok).toBe(false);
    expect(sharing.ok).toBe(false);
    if (!clipboard.ok && !sharing.ok) {
      expect(clipboard.error).toBeInstanceOf(CapabilityError);
      expect(sharing.error).toBeInstanceOf(CapabilityError);
    }
  });

  it("distingue cancelación de permiso y no expone detalles técnicos", () => {
    const cancelled = normalizeCapabilityError(
      new DOMException("aborted", "AbortError"),
    );
    const denied = normalizeCapabilityError(
      new DOMException("denied", "NotAllowedError"),
    );

    expect(cancelled.code).toBe("CANCELLED");
    expect(denied.code).toBe("PERMISSION_DENIED");
    expect(capabilityErrorMessage(cancelled)).toBe("Operación cancelada.");
    expect(capabilityErrorMessage(denied)).toBe(
      "El permiso necesario fue rechazado.",
    );
  });

  it("limpia suscripciones cuando SSR no tiene eventos globales", () => {
    expect(() => subscribeToNetworkState(() => undefined)).not.toThrow();
    expect(() => subscribeToWebLifecycle(() => undefined)).not.toThrow();
  });

  it("degrada el puente del Service Worker cuando no existe en SSR", async () => {
    const bridge = new YapePwaBridgeWeb();
    await expect(bridge.getStatus()).resolves.toEqual({
      supported: false,
      controlled: false,
      updateWaiting: false,
      activeScriptUrl: null,
    });
    await expect(bridge.requestUpdate()).resolves.toEqual({ requested: false });
  });

  it("registra listeners globales una sola vez y los elimina al final", () => {
    const documentListeners = new Map<string, EventListener>();
    const windowListeners = new Map<string, EventListener>();
    const mediaListeners = new Map<string, EventListener>();
    const fakeDocument = {
      visibilityState: "visible",
      addEventListener: (type: string, listener: EventListener) =>
        documentListeners.set(type, listener),
      removeEventListener: (type: string) => documentListeners.delete(type),
    } as unknown as Document;
    const fakeWindow = {
      addEventListener: (type: string, listener: EventListener) =>
        windowListeners.set(type, listener),
      removeEventListener: (type: string) => windowListeners.delete(type),
      matchMedia: () => ({
        matches: false,
        addEventListener: (type: string, listener: EventListener) =>
          mediaListeners.set(type, listener),
        removeEventListener: (type: string) => mediaListeners.delete(type),
      }),
    } as unknown as Window;
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("window", fakeWindow);

    const stopOne = subscribeToWebLifecycle(() => undefined);
    const stopTwo = subscribeToWebLifecycle(() => undefined);
    expect(windowListeners.size).toBe(5);
    expect(documentListeners.size).toBe(1);
    expect(mediaListeners.size).toBe(1);

    stopOne();
    expect(windowListeners.size).toBe(5);
    stopTwo();
    expect(windowListeners.size).toBe(0);
    expect(documentListeners.size).toBe(0);
    expect(mediaListeners.size).toBe(0);
  });
});
