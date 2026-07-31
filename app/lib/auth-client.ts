import { safeApiMessage, safeClientMessage } from "./client-error";

export type AuthRequestErrorKind =
  | "network"
  | "timeout"
  | "http"
  | "invalid-response";

export class AuthRequestError extends Error {
  readonly kind: AuthRequestErrorKind;
  readonly status: number;
  readonly code?: string;
  readonly referralCode?: string;
  readonly retryable: boolean;

  constructor(input: {
    message: string;
    kind: AuthRequestErrorKind;
    status?: number;
    code?: string;
    referralCode?: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "AuthRequestError";
    this.kind = input.kind;
    this.status = input.status ?? 0;
    this.code = input.code;
    this.referralCode = input.referralCode;
    this.retryable = input.retryable ?? (input.kind === "network" || input.kind === "timeout");
  }
}

export function createAuthAttemptId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function fallbackMessage(status: number) {
  if (status === 429) return "Demasiados intentos. Espera un momento antes de volver a intentarlo.";
  if (status >= 500) return "El servicio no está disponible temporalmente. Intenta nuevamente en unos segundos.";
  return "No se pudo completar la operación.";
}

export async function requestAuthJson(
  path: string,
  payload: Record<string, unknown>,
  options: { attemptId?: string; timeoutMs?: number } = {},
) {
  const attemptId = options.attemptId ?? createAuthAttemptId();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-auth-attempt": attemptId,
      },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new AuthRequestError({
      message: timedOut
        ? "El servidor está tardando demasiado. Revisa tu conexión e inténtalo nuevamente."
        : "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.",
      kind: timedOut ? "timeout" : "network",
      retryable: true,
      cause,
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }

  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  const ok = response.ok && data?.ok !== false;
  if (!ok) {
    const status = response.status;
    const serverMessage = safeApiMessage(data?.error, fallbackMessage(status));
    throw new AuthRequestError({
      message: serverMessage,
      kind: "http",
      status,
      code: typeof data?.code === "string" ? data.code : undefined,
      referralCode: typeof data?.referralCode === "string" ? data.referralCode : undefined,
      retryable: status === 408 || status === 425 || status === 429 || status >= 500,
    });
  }
  if (!data) {
    throw new AuthRequestError({
      message: "El servidor devolvió una respuesta incompleta. Inténtalo nuevamente.",
      kind: "invalid-response",
      status: response.status,
      retryable: true,
    });
  }
  return data;
}

export function authErrorMessage(error: unknown, fallback = "No se pudo completar la operación.") {
  if (!(error instanceof AuthRequestError)) {
    return safeClientMessage(error, fallback);
  }
  if (error.kind === "network") {
    return "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.";
  }
  if (error.kind === "timeout") {
    return "El servidor está tardando demasiado. Revisa tu conexión e inténtalo nuevamente.";
  }
  if (error.status === 429) {
    return safeClientMessage(error, "Demasiados intentos. Espera un momento antes de volver a intentarlo.");
  }
  if (error.status >= 500 || error.status === 0) {
    return safeClientMessage(error, "El servicio no está disponible temporalmente. Intenta nuevamente en unos segundos.");
  }
  return safeClientMessage(error, fallback);
}
