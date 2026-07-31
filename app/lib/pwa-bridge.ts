import { registerPlugin } from "@capacitor/core";

export type PwaBridgeStatus = {
  supported: boolean;
  controlled: boolean;
  updateWaiting: boolean;
  activeScriptUrl: string | null;
};

export type PwaBridgePlugin = {
  getStatus(): Promise<PwaBridgeStatus>;
  requestUpdate(): Promise<{ requested: boolean }>;
};

/**
 * Contrato interno para que la UI pueda comunicarse con el Service Worker.
 * La implementación web se carga únicamente cuando se invoca un método.
 * Android/iOS podrán proporcionar una implementación nativa más adelante.
 */
export const PwaBridge = registerPlugin<PwaBridgePlugin>("YapePwaBridge", {
  web: () =>
    import("./pwa-bridge.web").then(({ YapePwaBridgeWeb }) => new YapePwaBridgeWeb()),
});
