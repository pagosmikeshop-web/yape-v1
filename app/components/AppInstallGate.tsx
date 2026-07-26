"use client";
/* eslint-disable @next/next/no-img-element -- install screen uses the local Yape SVG */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getInstallEnvironment, isInstalledApp } from "../lib/pwa-client";
import type { InstallEnvironment } from "../lib/pwa-client";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

const EMPTY_ENVIRONMENT: InstallEnvironment = {
  isAndroid: false,
  isIos: false,
  isMobile: false,
  isNativeShell: false,
  isSafari: false,
};

function isLocalEditMode() {
  if (
    process.env.NODE_ENV === "production"
    || process.env.NEXT_PUBLIC_LOCAL_EDIT_MODE !== "true"
    || typeof window === "undefined"
  ) {
    return false;
  }

  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    window.location.hostname,
  );
}

export function AppInstallGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [environment, setEnvironment] =
    useState<InstallEnvironment>(EMPTY_ENVIRONMENT);
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installHelpVisible, setInstallHelpVisible] = useState(false);
  const [installAccepted, setInstallAccepted] = useState(false);

  useEffect(() => {
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const fullscreenQuery = window.matchMedia("(display-mode: fullscreen)");

    const updateInstalled = () => {
      setEnvironment(getInstallEnvironment());
      setInstalled(isInstalledApp());
      setReady(true);
    };

    const installPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setInstallHelpVisible(false);
      setInstallAccepted(false);
    };

    const installedApp = () => {
      setInstalled(true);
      setPromptEvent(null);
      setInstallHelpVisible(false);
      setInstallAccepted(false);
    };

    updateInstalled();
    standaloneQuery.addEventListener("change", updateInstalled);
    fullscreenQuery.addEventListener("change", updateInstalled);
    window.addEventListener("beforeinstallprompt", installPrompt);
    window.addEventListener("appinstalled", installedApp);

    return () => {
      standaloneQuery.removeEventListener("change", updateInstalled);
      fullscreenQuery.removeEventListener("change", updateInstalled);
      window.removeEventListener("beforeinstallprompt", installPrompt);
      window.removeEventListener("appinstalled", installedApp);
    };
  }, []);

  async function installApp() {
    if (!promptEvent) {
      setInstallHelpVisible((visible) => !visible);
      return;
    }

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    setInstallAccepted(choice.outcome === "accepted");
    setInstallHelpVisible(choice.outcome !== "accepted");
  }

  if (!ready) return null;
  if (isLocalEditMode()) return <>{children}</>;
  if (
    environment.isNativeShell
    || (installed && environment.isMobile)
  ) {
    return <>{children}</>;
  }

  const buttonLabel = promptEvent ? "Instalar app" : "Ver cómo instalar";
  const showIosSafariSteps =
    environment.isIos && environment.isSafari && installHelpVisible;
  const showIosBrowserHelp =
    environment.isIos && !environment.isSafari && installHelpVisible;
  const showAndroidHelp =
    environment.isAndroid && !promptEvent && installHelpVisible;
  const showDesktopHelp = !environment.isMobile && installHelpVisible;

  return (
    <main className="install-gate" aria-label="Instalar aplicación">
      <section className="install-card">
        <img
          src="/assets/apk/icons/ic_logo_static.svg"
          alt=""
          aria-hidden="true"
        />
        <h1>Descarga la app para continuar</h1>
        <p>
          El acceso de clientes funciona desde la aplicación instalada en el
          celular.
        </p>
        {installAccepted ? (
          <p className="install-help" role="status">
            Instalación aceptada. Cuando termine, abre Yape desde el icono de tu
            pantalla de inicio.
          </p>
        ) : (
          <button type="button" onClick={installApp}>
            {buttonLabel}
          </button>
        )}

        {showIosSafariSteps ? (
          <ol className="install-help" aria-label="Pasos para instalar en iPhone">
            <li>Toca Compartir en Safari.</li>
            <li>Elige Agregar a pantalla de inicio.</li>
            <li>Confirma y abre Yape desde el nuevo icono.</li>
          </ol>
        ) : null}

        {showIosBrowserHelp ? (
          <p className="install-help" role="status">
            En iPhone o iPad, abre esta página directamente en Safari para
            agregarla correctamente a la pantalla de inicio.
          </p>
        ) : null}

        {showAndroidHelp ? (
          <p className="install-help" role="status">
            Abre el menú del navegador y selecciona Instalar aplicación. Si esa
            opción no aparece, actualiza Chrome y vuelve a intentarlo.
          </p>
        ) : null}

        {showDesktopHelp ? (
          <p className="install-help" role="status">
            Abre esta página desde tu celular para instalar y usar la
            aplicación.
          </p>
        ) : null}
      </section>
    </main>
  );
}
