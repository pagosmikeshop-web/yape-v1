import {
  CapabilityError,
  normalizeCapabilityError,
} from "./capability-errors";
import { runtimePlatform } from "./platform";
import { subscribeToWebLifecycle } from "./web-lifecycle";

export type ConnectivityState = "online" | "offline" | "restored";

/** Suscripción única a los eventos de red del navegador. */
export function subscribeToNetworkState(
  listener: (state: ConnectivityState) => void,
): () => void {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return () => undefined;
  }

  let wasOnline = navigator.onLine;
  listener(wasOnline ? "online" : "offline");

  return subscribeToWebLifecycle((event) => {
    if (event.type !== "online" && event.type !== "offline") return;
    const online = event.type === "online";
    const state: ConnectivityState = online
      ? wasOnline ? "online" : "restored"
      : "offline";
    wasOnline = online;
    listener(state);
  });
}

export type BackendReachability = {
  reachable: boolean;
  status?: number;
  error?: CapabilityError;
};

/** Comprueba el backend de forma puntual; no crea polling ni cachea la respuesta. */
export async function checkBackendReachability(
  url = "/api/health",
  signal?: AbortSignal,
): Promise<BackendReachability> {
  if (typeof fetch === "undefined") {
    return {
      reachable: false,
      error: new CapabilityError("UNAVAILABLE", "Fetch no está disponible."),
    };
  }

  if (!runtimePlatform.get().isOnline) {
    return {
      reachable: false,
      error: new CapabilityError("OFFLINE", "No hay conexión de red."),
    };
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal,
    });
    return { reachable: response.ok, status: response.status };
  } catch (error) {
    const normalized = normalizeCapabilityError(error, "OFFLINE");
    return { reachable: false, error: normalized };
  }
}

export type ClipboardResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unavailable" | "denied" | "failed";
      error: CapabilityError;
    };

function clipboardFailure(error: CapabilityError): ClipboardResult {
  return {
    ok: false,
    reason: error.code === "PERMISSION_DENIED" ? "denied" : "failed",
    error,
  };
}

/** Copia texto sin leer el portapapeles automáticamente. */
export async function copyText(text: string): Promise<ClipboardResult> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return clipboardFailure(
      new CapabilityError("UNAVAILABLE", "El documento no está disponible."),
    );
  }

  let apiError: CapabilityError | undefined;
  if (runtimePlatform.get().capabilities.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch (error) {
      apiError = normalizeCapabilityError(error, "PERMISSION_DENIED");
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (copied) return { ok: true };
    return clipboardFailure(
      apiError ?? new CapabilityError("UNSUPPORTED", "El portapapeles no está disponible."),
    );
  } catch (error) {
    return clipboardFailure(apiError ?? normalizeCapabilityError(error));
  } finally {
    textarea.remove();
  }
}

export type ShareResult =
  | { ok: true; method: "native-share" | "clipboard" }
  | {
      ok: false;
      reason: "cancelled" | "unavailable" | "failed";
      error: CapabilityError;
    };

/** Comparte texto o usa el portapapeles cuando Web Share no está disponible. */
export async function shareText(input: {
  title?: string;
  text: string;
  url?: string;
}): Promise<ShareResult> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      ok: false,
      reason: "unavailable",
      error: new CapabilityError("UNAVAILABLE", "El navegador no está disponible."),
    };
  }

  if (runtimePlatform.get().capabilities.share) {
    try {
      await navigator.share({ title: input.title, text: input.text, url: input.url });
      return { ok: true, method: "native-share" };
    } catch (error) {
      const normalized = normalizeCapabilityError(error, "UNKNOWN");
      if (normalized.code === "CANCELLED") {
        return { ok: false, reason: "cancelled", error: normalized };
      }
    }
  }

  const copyResult = await copyText(
    input.url ? `${input.text}\n${input.url}` : input.text,
  );
  if (copyResult.ok) return { ok: true, method: "clipboard" };
  return {
    ok: false,
    reason: copyResult.reason === "denied" ? "failed" : copyResult.reason,
    error: copyResult.error,
  };
}
