"use client";
/* eslint-disable @next/next/no-img-element -- install screen uses the local Yape SVG */

import { ReactNode, useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneDisplay() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function AppInstallGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installHelpVisible, setInstallHelpVisible] = useState(false);
  const isAndroid = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /android/iu.test(navigator.userAgent);
  }, []);
  const isIos = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iphone|ipad|ipod/iu.test(navigator.userAgent);
  }, []);
  const isIpadOs = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /macintosh/iu.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  }, []);
  const isMobileDevice = isAndroid || isIos || isIpadOs;

  useEffect(() => {
    const updateInstalled = () => {
      const standalone = isStandaloneDisplay();
      setInstalled(standalone);
      setReady(true);
    };
    updateInstalled();
    window.matchMedia("(display-mode: standalone)").addEventListener("change", updateInstalled);
    const installPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setInstallHelpVisible(false);
    };
    const installedApp = () => {
      setInstalled(true);
      setPromptEvent(null);
      setInstallHelpVisible(false);
    };
    window.addEventListener("beforeinstallprompt", installPrompt);
    window.addEventListener("appinstalled", installedApp);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => {
      window.matchMedia("(display-mode: standalone)").removeEventListener("change", updateInstalled);
      window.removeEventListener("beforeinstallprompt", installPrompt);
      window.removeEventListener("appinstalled", installedApp);
    };
  }, []);

  async function installApp() {
    if (!isMobileDevice) {
      setInstallHelpVisible(true);
      return;
    }
    if (!promptEvent) {
      setInstallHelpVisible(true);
      return;
    }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === "accepted") setInstalled(true);
    else setInstallHelpVisible(true);
  }

  if (!ready) return null;
  if (installed && isMobileDevice) return <>{children}</>;

  return (
    <main className="install-gate" aria-label="Instalar aplicacion">
      <section className="install-card">
        <img src="/assets/apk/icons/ic_logo_static.svg" alt="" aria-hidden="true" />
        <h1>Descarga la app para continuar</h1>
        <p>El acceso de clientes funciona solo desde la aplicacion instalada en el celular.</p>
        <button type="button" onClick={installApp}>Instalar app</button>
        {isIos ? (
          <ol>
            <li>Toca Compartir en Safari.</li>
            <li>Elige Agregar a pantalla de inicio.</li>
            <li>Abre la app desde el icono instalado.</li>
          </ol>
        ) : !isMobileDevice && installHelpVisible ? (
          <p className="install-help" role="status">Abre esta pagina desde tu celular para instalar la app.</p>
        ) : !promptEvent ? (
          <p className="install-help">Abre el menu del navegador y selecciona Instalar aplicacion o Agregar a pantalla de inicio.</p>
        ) : null}
      </section>
    </main>
  );
}
