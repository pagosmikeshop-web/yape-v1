/**
 * Cliente WebAuthn (Face ID / huella).
 * El PIN permanece siempre como alternativa: si el usuario cancela o falla, se muestra aviso y puede teclear la clave.
 */

import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { safeApiMessage, safeClientMessage } from "./client-error";

export type WebAuthnClientErrorCode =
  | "UNSUPPORTED"
  | "CANCELLED"
  | "NOT_REGISTERED"
  | "FAILED";

export class WebAuthnClientError extends Error {
  code: WebAuthnClientErrorCode;

  constructor(message: string, code: WebAuthnClientErrorCode) {
    super(message);
    this.name = "WebAuthnClientError";
    this.code = code;
  }
}

async function postJson<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    ok?: boolean;
    error?: string;
    code?: string;
  };
  if (!response.ok || data.ok === false) {
    const message = safeApiMessage(data.error, "No se pudo completar la operación biométrica.");
    if (data.code === "WEBAUTHN_NOT_REGISTERED" || response.status === 404) {
      throw new WebAuthnClientError(message, "NOT_REGISTERED");
    }
    throw new WebAuthnClientError(message, "FAILED");
  }
  return data as T;
}

function mapBrowserError(error: unknown): WebAuthnClientError {
  if (error instanceof WebAuthnClientError) return error;
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return new WebAuthnClientError(
      "Cancelaste el biométrico. Puedes ingresar con tu clave de 6 dígitos.",
      "CANCELLED",
    );
  }
  if (error instanceof Error && error.message) {
    return new WebAuthnClientError(
      `${safeClientMessage(error, "No pudimos usar Face ID o huella.")} Puedes usar tu clave.`,
      "FAILED",
    );
  }
  return new WebAuthnClientError(
    "No pudimos usar Face ID o huella. Puedes ingresar con tu clave.",
    "FAILED",
  );
}

export function webAuthnSupported() {
  return typeof window !== "undefined" && browserSupportsWebAuthn();
}

/** Registra Face ID / huella del dispositivo para el usuario de la sesión. */
export async function registerPlatformBiometric() {
  if (!webAuthnSupported()) {
    throw new WebAuthnClientError(
      "Este dispositivo no admite Face ID o huella en el navegador.",
      "UNSUPPORTED",
    );
  }

  try {
    const data = await postJson<{ options: PublicKeyCredentialCreationOptionsJSON }>(
      "/api/auth/webauthn/register/options",
    );
    const credential: RegistrationResponseJSON = await startRegistration({
      optionsJSON: data.options,
    });
    await postJson("/api/auth/webauthn/register/verify", { credential });
  } catch (error) {
    throw mapBrowserError(error);
  }
}

/** Desbloquea la sesión con biométrico (mismo efecto que el PIN). */
export async function unlockWithPlatformBiometric() {
  if (!webAuthnSupported()) {
    throw new WebAuthnClientError(
      "Este dispositivo no admite Face ID o huella. Usa tu clave de 6 dígitos.",
      "UNSUPPORTED",
    );
  }

  try {
    const data = await postJson<{ options: PublicKeyCredentialRequestOptionsJSON }>(
      "/api/auth/webauthn/authenticate/options",
    );
    const credential: AuthenticationResponseJSON = await startAuthentication({
      optionsJSON: data.options,
    });
    await postJson("/api/auth/webauthn/authenticate/verify", { credential });
  } catch (error) {
    throw mapBrowserError(error);
  }
}

export async function fetchWebAuthnStatus() {
  const response = await fetch("/api/auth/webauthn/status", { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    enabled?: boolean;
    error?: string;
  };
  if (!response.ok || data.ok === false) {
    throw new Error(safeApiMessage(data.error, "No se pudo consultar la biometría."));
  }
  return Boolean(data.enabled);
}

export async function disablePlatformBiometric() {
  const response = await fetch("/api/auth/webauthn/status", {
    method: "DELETE",
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(safeApiMessage(data.error, "No se pudo desactivar la biometría."));
  }
}
