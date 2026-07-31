export type CapabilityErrorCode =
  | "UNAVAILABLE"
  | "UNSUPPORTED"
  | "PERMISSION_DENIED"
  | "CANCELLED"
  | "OFFLINE"
  | "TIMEOUT"
  | "INVALID_RESULT"
  | "STORAGE_FULL"
  | "SECURITY_RESTRICTION"
  | "UNKNOWN";

export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode;
  readonly cause?: unknown;

  constructor(code: CapabilityErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "CapabilityError";
    this.code = code;
    this.cause = cause;
  }
}

export function normalizeCapabilityError(
  error: unknown,
  fallback: CapabilityErrorCode = "UNKNOWN",
): CapabilityError {
  if (error instanceof CapabilityError) return error;

  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "AbortError") {
      return new CapabilityError("CANCELLED", "La operación fue cancelada.", error);
    }
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return new CapabilityError(
        error.name === "SecurityError" ? "SECURITY_RESTRICTION" : "PERMISSION_DENIED",
        "El navegador no permitió esta operación.",
        error,
      );
    }
    if (error.name === "NotSupportedError") {
      return new CapabilityError("UNSUPPORTED", "Esta capacidad no está disponible.", error);
    }
    if (error.name === "TimeoutError") {
      return new CapabilityError("TIMEOUT", "La operación tardó demasiado.", error);
    }
  }

  return new CapabilityError(fallback, "No se pudo completar la operación.", error);
}

/** Mensajes públicos sin detalles del navegador, permisos ni backend. */
export function capabilityErrorMessage(error: CapabilityError): string {
  switch (error.code) {
    case "CANCELLED":
      return "Operación cancelada.";
    case "OFFLINE":
      return "Sin conexión. Inténtalo cuando vuelvas a estar conectado.";
    case "PERMISSION_DENIED":
      return "El permiso necesario fue rechazado.";
    case "SECURITY_RESTRICTION":
      return "Esta función requiere una conexión segura y una acción del usuario.";
    case "STORAGE_FULL":
      return "No hay espacio disponible para guardar este recurso.";
    case "TIMEOUT":
      return "La operación tardó demasiado. Inténtalo nuevamente.";
    case "UNSUPPORTED":
      return "Esta función no está disponible en este dispositivo.";
    case "UNAVAILABLE":
      return "Esta función no está disponible en este momento.";
    case "INVALID_RESULT":
      return "El resultado recibido no es válido.";
    default:
      return "No se pudo completar la operación.";
  }
}
