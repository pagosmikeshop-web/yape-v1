import { RecipientLookupError } from "./errors";

const NAME_TOKEN = /^\p{L}+(?:['\u2019\u2018-]\p{L}+)*$/u;
const PROTECTED_NAME_TOKEN = "\\p{L}+(?:['\\u2019\\u2018-]\\p{L}+)*";
const LEGACY_PROTECTED_NAME_PATTERN = new RegExp(
  `^${PROTECTED_NAME_TOKEN} ${"\\p{L}"}{1,3}\\*$`,
  "u",
);
// Algunos registros (especialmente QR) llegan con el asterisco en medio,
// por ejemplo "Izi*Butri". Sigue siendo un valor protegido porque no expone
// el nombre completo; conservarlo evita que el movimiento quede sin titular.
const EMBEDDED_PROTECTED_NAME_PATTERN = new RegExp(
  `^${PROTECTED_NAME_TOKEN}(?:\\s+${PROTECTED_NAME_TOKEN})*\\*${PROTECTED_NAME_TOKEN}(?:\\s+${PROTECTED_NAME_TOKEN})*$`,
  "u",
);

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
  const trimmed = value.trim();
  return LEGACY_PROTECTED_NAME_PATTERN.test(trimmed)
    || EMBEDDED_PROTECTED_NAME_PATTERN.test(trimmed);
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

/**
 * Validates the display value supplied by a user without changing its form.
 * A global autocomplete/QR record may intentionally contain either a full
 * name or a user-authored protected form such as "Laura Qui*". Masking is
 * therefore never inferred here; the submitted value is the source of truth.
 */
export function validateRecipientDisplayName(value: string) {
  const nfcValue = value.normalize("NFC");
  if (/[\u0000-\u001f\u007f]/u.test(nfcValue)) return "";
  const normalized = nfcValue.replace(/\s+/gu, " ").trim();
  if (
    normalized.length < 2
    || normalized.length > 80
  ) {
    return "";
  }
  return normalized;
}
