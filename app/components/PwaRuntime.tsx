"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getRouteThemeColor } from "../lib/route-theme";
import { isNativeApp } from "../lib/pwa-client";
import {
  subscribeToNetworkState,
  type ConnectivityState,
} from "../lib/platform-adapters";
import { subscribeToWebLifecycle } from "../lib/web-lifecycle";
import { PwaBridge } from "../lib/pwa-bridge";

function findThemeMeta() {
  return document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
}

export function PwaRuntime() {
  const pathname = usePathname();
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [connectivity, setConnectivity] = useState<ConnectivityState>("online");
  const reloadAfterActivation = useRef(false);

  useEffect(() => {
    const themeColor = getRouteThemeColor(pathname);
    findThemeMeta()?.setAttribute("content", themeColor);
    document.documentElement.style.setProperty("--app-route-bg", themeColor);
    document.documentElement.style.backgroundColor = themeColor;
    document.body.style.backgroundColor = themeColor;
  }, [pathname]);

  useEffect(() => {
    document.documentElement.classList.add("app-ready");
    window.dispatchEvent(new Event("app-ready"));

    return () => {
      document.documentElement.classList.remove("app-ready");
    };
  }, []);

  useEffect(() => {
    return subscribeToNetworkState(setConnectivity);
  }, []);

  useEffect(() => {
    if (
      isNativeApp()
      ||
      process.env.NODE_ENV !== "production"
      || !window.isSecureContext
      || !("serviceWorker" in navigator)
    ) {
      return;
    }

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let installingWorker: ServiceWorker | null = null;

    const handleControllerChange = () => {
      if (reloadAfterActivation.current) window.location.reload();
    };

    const handleInstallingState = () => {
      if (
        !disposed
        && installingWorker?.state === "installed"
        && navigator.serviceWorker.controller
      ) {
        setWaitingWorker(registration?.waiting ?? installingWorker);
      }
    };

    const handleUpdateFound = () => {
      installingWorker?.removeEventListener("statechange", handleInstallingState);
      installingWorker = registration?.installing ?? null;
      installingWorker?.addEventListener("statechange", handleInstallingState);
    };

    const checkForUpdate = () => {
      if (document.visibilityState === "visible") {
        void registration?.update().catch(() => undefined);
      }
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((nextRegistration) => {
        if (disposed) return;
        registration = nextRegistration;
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
        }
        registration.addEventListener("updatefound", handleUpdateFound);
        void registration.update().catch(() => undefined);
      })
      .catch(() => undefined);

    const stopLifecycle = subscribeToWebLifecycle((event) => {
      if (event.type === "visibilitychange" && event.visible) checkForUpdate();
    });

    return () => {
      disposed = true;
      stopLifecycle();
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
      installingWorker?.removeEventListener(
        "statechange",
        handleInstallingState,
      );
      registration?.removeEventListener("updatefound", handleUpdateFound);
    };
  }, []);

  async function applyUpdate() {
    if (!waitingWorker) return;
    reloadAfterActivation.current = true;
    try {
      const result = await PwaBridge.requestUpdate();
      if (!result.requested) waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } catch {
      // El fallback mantiene la actualización funcional si el bridge no está disponible.
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    }
  }

  return (
    <>
      {connectivity !== "online" ? (
        <aside
          className={`pwa-network-banner is-${connectivity}`}
          role="status"
          aria-live="polite"
        >
          <span>
            {connectivity === "offline"
              ? "Sin conexión. Algunas acciones estarán disponibles al reconectarte."
              : "Conexión restablecida."}
          </span>
          {connectivity === "restored" ? (
            <button
              type="button"
              aria-label="Cerrar aviso de conexión restablecida"
              onClick={() => setConnectivity("online")}
            >
              Cerrar
            </button>
          ) : null}
        </aside>
      ) : null}

      {waitingWorker ? (
        <aside className="pwa-update-banner" role="status" aria-live="polite">
          <div>
            <strong>Nueva versión disponible</strong>
            <span>Actualiza cuando estés listo. No perderás tu sesión.</span>
          </div>
          <button type="button" onClick={() => void applyUpdate()}>
            Actualizar
          </button>
          <button
            type="button"
            className="pwa-update-later"
            aria-label="Cerrar aviso de actualización"
            onClick={() => setWaitingWorker(null)}
          >
            Ahora no
          </button>
        </aside>
      ) : null}
    </>
  );
}
