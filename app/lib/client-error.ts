/**
 * Convierte errores internos o respuestas de red en mensajes aptos para la
 * interfaz. Los detalles técnicos se conservan en el flujo interno, pero no
 * se muestran al usuario final.
 */
const TECHNICAL_ERROR_PATTERNS = [
  /(?:failed to fetch|fetch failed|networkerror|notimplemented|not supported)/iu,
  /(?:cannot read properties|is not a function|undefined|null reference)/iu,
  /(?:syntaxerror|typeerror|referenceerror|domexception|aborterror)/iu,
  /(?:econn|enotfound|etimedout|err_[a-z0-9_-]+)/iu,
  /(?:sql|sqlite|database|query failed|stack trace|turbopack|webpack|hydration)/iu,
  /(?:\bat\s+(?:[a-z_$][\w$]*\.)+[a-z_$][\w$]*\s*\()/iu,
];

function rawErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

export function safeClientMessage(error: unknown, fallback: string): string {
  const message = rawErrorMessage(error).replace(/\s+/gu, " ").trim();
  if (!message || message.length > 180 || TECHNICAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return fallback;
  }
  return message;
}

export function safeApiMessage(value: unknown, fallback: string): string {
  return safeClientMessage(typeof value === "string" ? value : "", fallback);
}
