import { WebPlugin } from "@capacitor/core";
import { normalizeCapabilityError } from "./capability-errors";
import type { PwaBridgePlugin, PwaBridgeStatus } from "./pwa-bridge";

export class YapePwaBridgeWeb extends WebPlugin implements PwaBridgePlugin {
  async getStatus(): Promise<PwaBridgeStatus> {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return {
        supported: false,
        controlled: false,
        updateWaiting: false,
        activeScriptUrl: null,
      };
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      return {
        supported: true,
        controlled: Boolean(navigator.serviceWorker.controller),
        updateWaiting: Boolean(registration?.waiting),
        activeScriptUrl: registration?.active?.scriptURL ?? null,
      };
    } catch (error) {
      throw normalizeCapabilityError(error);
    }
  }

  async requestUpdate(): Promise<{ requested: boolean }> {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return { requested: false };
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      if (!registration?.waiting) return { requested: false };

      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      return { requested: true };
    } catch (error) {
      throw normalizeCapabilityError(error);
    }
  }
}
