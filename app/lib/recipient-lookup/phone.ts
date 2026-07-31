import { RecipientLookupError } from "./errors";

export type NormalizedRecipientPhone = {
  e164: string;
  local: string;
};

/** Acepta un celular peruano de 9 dígitos, con un prefijo +51 opcional. */
export function normalizeRecipientPhone(value: string): NormalizedRecipientPhone {
  const digits = value.replace(/\D/gu, "");
  const local = digits.startsWith("51") && digits.length === 11 ? digits.slice(2) : digits;
  if (!/^9\d{8}$/u.test(local)) {
    throw new RecipientLookupError(
      "INVALID_PHONE",
      "Ingresa un número de celular válido de 9 dígitos.",
    );
  }
  return { e164: `+51${local}`, local };
}
