import { RecipientLookupError } from "./errors";

const NAME_TOKEN = /^\p{L}+(?:['’\-]\p{L}+)*$/u;

function titleCase(value: string) {
  const lower = value.toLocaleLowerCase("es-PE");
  const characters = Array.from(lower);
  return characters.length === 0
    ? ""
    : `${characters[0].toLocaleUpperCase("es-PE")}${characters.slice(1).join("")}`;
}

/**
 * Reduce el titular antes de que cualquier dato abandone el servidor.
 * Para tres o más tokens se usa el penúltimo como primer apellido.
 */
export function protectRecipientName(value: string) {
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  const tokens = normalized.split(" ").filter(Boolean);
  if (!normalized || normalized.length > 120 || tokens.some((token) => !NAME_TOKEN.test(token))) {
    throw new RecipientLookupError("PROVIDER_INVALID_RESPONSE", "El proveedor no devolvió un titular válido.");
  }

  const firstName = titleCase(tokens[0]);
  if (tokens.length === 1) {
    const characters = Array.from(firstName);
    return `${characters.slice(0, Math.min(2, Math.max(1, characters.length - 1))).join("")}*`;
  }

  const surnameToken = tokens[tokens.length >= 3 ? tokens.length - 2 : 1];
  const surname = Array.from(titleCase(surnameToken)).slice(0, 3).join("");
  return `${firstName} ${surname}*`;
}

export function isProtectedRecipientName(value: string) {
  return /^[\p{L}]+(?:['’\-][\p{L}]+)* [\p{L}]{1,3}\*$/u.test(value.trim());
}

export function maskRecipientName(value: string) {
  const trimmed = value.trim();
  if (isProtectedRecipientName(trimmed)) return trimmed;
  try {
    return protectRecipientName(trimmed);
  } catch {
    return "";
  }
}

/**
 * Protege un nombre escrito manualmente sin convertir una entrada inválida en
 * un nombre aparentemente válido. El valor vacío indica que debe rechazarse.
 */
export function tryMaskRecipientName(value: string) {
  const trimmed = value.trim();
  if (isProtectedRecipientName(trimmed)) return trimmed;
  try {
    return protectRecipientName(trimmed);
  } catch {
    return "";
  }
}
