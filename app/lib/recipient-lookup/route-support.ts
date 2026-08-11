import { jsonError } from "@/app/lib/api-utils";
import {
  dbBinding,
} from "@/app/lib/auth-server";
import { RecipientLookupError } from "@/app/lib/recipient-lookup/errors";
import { maskRecipientName } from "@/app/lib/recipient-lookup/name-masker";

export type SavedRecipientRow = {
  id: string;
  display_name: string;
};

export function protectedRecipientName(value: string) {
  return maskRecipientName(value);
}

export async function saveExternalRecipient(
  requesterUserId: string,
  phoneE164: string,
  displayName: string,
) {
  const now = new Date().toISOString();
  const saved = await dbBinding().prepare(
    `INSERT INTO saved_payment_recipients (
      id, user_id, phone_e164, display_name, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'claro', ?, ?)
    ON CONFLICT(user_id, phone_e164) DO UPDATE SET
      display_name = excluded.display_name,
      source = excluded.source,
      updated_at = excluded.updated_at
    RETURNING id, display_name`,
  ).bind(
    crypto.randomUUID(),
    requesterUserId,
    phoneE164,
    displayName,
    now,
    now,
  ).first<SavedRecipientRow>();
  if (!saved) throw new Error("No se pudo guardar el destinatario verificado.");
  return saved;
}

export function lookupErrorResponse(error: RecipientLookupError) {
  switch (error.code) {
    case "INVALID_PHONE":
      return jsonError("Ingresa un número de celular válido de 9 dígitos.", 400);
    case "RECIPIENT_NOT_FOUND":
      return jsonError("No encontramos un titular para ese número.", 404);
    case "RATE_LIMITED":
      return jsonError("La consulta no está disponible temporalmente. Intenta más tarde.", 429);
    case "PROVIDER_TIMEOUT":
      return jsonError("La consulta tardó demasiado. Puedes intentarlo nuevamente.", 504);
    case "PROVIDER_INVALID_RESPONSE":
    case "PROVIDER_UNAVAILABLE":
      return jsonError("No pudimos verificar el titular en este momento.", 503);
    default:
      return jsonError("No pudimos verificar el destinatario.", 503);
  }
}
