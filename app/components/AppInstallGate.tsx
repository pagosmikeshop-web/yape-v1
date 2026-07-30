"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
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

  if (
    !ready
    || isLocalEditMode()
    || installed
    || installAccepted
    || !environment.isMobile
    || pathname !== "/"
  ) {
    return <>{children}</>;
  }

  const buttonLabel = promptEvent ? "Instalar app" : "Cómo instalar";
  const showIosSafariSteps =
    environment.isIos && environment.isSafari && installHelpVisible;
  const showIosBrowserHelp =
    environment.isIos && !environment.isSafari && installHelpVisible;
  const showAndroidHelp =
    environment.isAndroid && !promptEvent && installHelpVisible;

  return (
    <>
      {children}
      <aside className="entry-install-cta" aria-label="Instalar aplicación">
        <button type="button" onClick={installApp}>
          {buttonLabel}
        </button>

        {showIosSafariSteps ? (
          <p role="status">
            En Safari toca Compartir y luego Agregar a pantalla de inicio.
          </p>
        ) : null}

        {showIosBrowserHelp ? (
          <p role="status">
            En iPhone o iPad abre esta página en Safari para instalarla.
          </p>
        ) : null}

        {showAndroidHelp ? (
          <p role="status">
            Abre el menú de Chrome y selecciona Instalar aplicación.
          </p>
        ) : null}
      </aside>
    </>
  );
}
