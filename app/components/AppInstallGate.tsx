"use client";

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

function InstallationRequiredScreen({
  environment,
  promptEvent,
  installCompleted,
  installError,
  onInstall,
}: {
  environment: InstallEnvironment;
  promptEvent: BeforeInstallPromptEvent | null;
  installCompleted: boolean;
  installError: boolean;
  onInstall: () => void;
}) {
  return (
    <main className="installation-required" aria-labelledby="installation-title">
      <section className="installation-required__card">
        <img
          className="installation-required__logo"
          src="/icons/yape-192.png"
          width={96}
          height={96}
          alt="Yape"
        />
        <p className="installation-required__eyebrow">APLICACIÓN MÓVIL</p>
        <h1 id="installation-title">
          Esta aplicación solo funciona cuando está instalada
        </h1>
        <p className="installation-required__description">
          Para proteger tu cuenta, abre Yape desde el icono instalado en tu dispositivo.
        </p>

        {promptEvent ? (
          <button
            type="button"
            className="installation-required__install-button"
            onClick={onInstall}
          >
            Instalar aplicación
          </button>
        ) : null}

        {environment.isIos ? (
          <div className="installation-required__instructions">
            <h2>Cómo instalar en iPhone o iPad</h2>
            <ol>
              <li>Abre este enlace en Safari.</li>
              <li>Pulsa el botón Compartir.</li>
              <li>Selecciona Agregar a pantalla de inicio.</li>
              <li>Confirma la instalación y cierra Safari.</li>
              <li>Abre la aplicación desde el nuevo icono.</li>
            </ol>
          </div>
        ) : environment.isAndroid ? (
          <div className="installation-required__instructions">
            <h2>Cómo instalar en Android</h2>
            <p>
              {promptEvent
                ? "Pulsa «Instalar aplicación» y espera a que termine."
                : "Abre el menú de Chrome y selecciona «Instalar aplicación» o «Agregar a pantalla de inicio»."}
            </p>
          </div>
        ) : (
          <div className="installation-required__instructions">
            <h2>Abre la aplicación instalada</h2>
            <p>
              Instala la aplicación desde el menú de tu navegador y luego ábrela desde su icono.
            </p>
          </div>
        )}

        {installCompleted ? (
          <p className="installation-required__status" role="status">
            Aplicación instalada. Cierra esta pestaña y abre la aplicación desde su icono.
          </p>
        ) : null}
        {installError ? (
          <p className="installation-required__status" role="status">
            La instalación no se completó. Usa el menú del navegador para intentarlo nuevamente.
          </p>
        ) : null}
      </section>
    </main>
  );
}

/**
 * Gate de aplicación: el contenido funcional solo se monta en standalone,
 * fullscreen, iOS standalone o en el modo local de desarrollo explícito.
 * En navegador normal no se renderizan ni el login ni las rutas privadas.
 */
export function AppInstallGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [localEditMode, setLocalEditMode] = useState(false);
  const [environment, setEnvironment] = useState<InstallEnvironment>(
    EMPTY_ENVIRONMENT,
  );
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installCompleted, setInstallCompleted] = useState(false);
  const [installError, setInstallError] = useState(false);

  useEffect(() => {
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const fullscreenQuery = window.matchMedia("(display-mode: fullscreen)");

    const updateMode = () => {
      setEnvironment(getInstallEnvironment());
      setInstalled(isInstalledApp());
      setLocalEditMode(isLocalEditMode());
      setReady(true);
    };

    const installPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setInstallError(false);
    };

    const installedApp = () => {
      // Installing from this browser tab does not make the tab standalone.
      // Keep the gate closed until the user opens the new icon.
      setPromptEvent(null);
      setInstallCompleted(true);
      setInstallError(false);
    };

    updateMode();
    standaloneQuery.addEventListener("change", updateMode);
    fullscreenQuery.addEventListener("change", updateMode);
    window.addEventListener("beforeinstallprompt", installPrompt);
    window.addEventListener("appinstalled", installedApp);
    window.addEventListener("pageshow", updateMode);
    window.addEventListener("visibilitychange", updateMode);

    return () => {
      standaloneQuery.removeEventListener("change", updateMode);
      fullscreenQuery.removeEventListener("change", updateMode);
      window.removeEventListener("beforeinstallprompt", installPrompt);
      window.removeEventListener("appinstalled", installedApp);
      window.removeEventListener("pageshow", updateMode);
      window.removeEventListener("visibilitychange", updateMode);
    };
  }, []);

  async function installApp() {
    if (!promptEvent) return;
    setInstallError(false);
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === "dismissed") setInstallError(true);
  }

  if (ready && (installed || localEditMode)) return <>{children}</>;

  return (
    <InstallationRequiredScreen
      environment={environment}
      promptEvent={promptEvent}
      installCompleted={installCompleted}
      installError={installError}
      onInstall={() => void installApp()}
    />
  );
}
