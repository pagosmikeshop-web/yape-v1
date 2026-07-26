"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getRouteThemeColor } from "../lib/route-theme";

function findThemeMeta() {
  return document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
}

export function PwaRuntime() {
  const pathname = usePathname();
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
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
    if (
      process.env.NODE_ENV !== "production"
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

    document.addEventListener("visibilitychange", checkForUpdate);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", checkForUpdate);
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

  function applyUpdate() {
    if (!waitingWorker) return;
    reloadAfterActivation.current = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  if (!waitingWorker) return null;

  return (
    <aside className="pwa-update-banner" role="status" aria-live="polite">
      <div>
        <strong>Nueva versión disponible</strong>
        <span>Actualiza cuando estés listo. No perderás tu sesión.</span>
      </div>
      <button type="button" onClick={applyUpdate}>
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
  );
}
