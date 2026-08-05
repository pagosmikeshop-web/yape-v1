import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { findActiveRecipientById, findActiveRecipientByPhone } from "@/app/lib/active-recipient-server";
import {
  getAutocompleteStatus,
  refundAutocompleteCredit,
  reserveAutocompleteCredit,
} from "@/app/lib/autocomplete-credits-server";
import {
  dbBinding,
  enforceAuthRateLimits,
  requireUnlockedSession,
  requestIpRateLimitSubject,
  routeError,
} from "@/app/lib/auth-server";
import { lookupGlobalRecipient } from "@/app/lib/global-recipient-directory";
import { RecipientLookupError } from "@/app/lib/recipient-lookup/errors";
import { maskRecipientName } from "@/app/lib/recipient-lookup/name-masker";
import { normalizeRecipientPhone } from "@/app/lib/recipient-lookup/phone";
import { lookupRecipientPhone } from "@/app/lib/recipient-lookup/service";

export const dynamic = "force-dynamic";

type SavedRecipientRow = { id: string; display_name: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function protectedName(value: string) {
  return maskRecipientName(value);
}

async function saveExternalRecipient(requesterUserId: string, phoneE164: string, displayName: string) {
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

function lookupErrorResponse(error: RecipientLookupError) {
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

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin", "seller", "client"]);
    await enforceAuthRateLimits([
      {
        bucket: "recipient-lookup-user",
        subject: user.id,
        limit: 60,
        windowSeconds: 60 * 60,
      },
      {
        bucket: "recipient-lookup-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 120,
        windowSeconds: 60 * 60,
      },
    ]);

    const body = await readJson(request);
    if (Object.keys(body).some((key) => !["recipientId", "phone"].includes(key))) {
      return jsonError("La solicitud contiene campos no permitidos.", 400);
    }
    const recipientId = asString(body.recipientId).trim();
    const rawPhone = asString(body.phone).trim();
    if (!recipientId && !rawPhone) return jsonError("Indica un QR o número de celular.");
    if (recipientId && rawPhone) return jsonError("Indica un solo destinatario.");

    if (recipientId) {
      if (!UUID_PATTERN.test(recipientId)) return jsonError("El QR no contiene un destinatario válido.");
      if (recipientId === user.id) return jsonError("No puedes transferirte a tu propia cuenta.", 409);
      const recipient = await findActiveRecipientById(dbBinding(), recipientId);
      if (!recipient) return jsonError("No encontramos un destinatario activo con esos datos.", 404);
      return jsonOk({
        recipient: {
          id: recipient.id,
          displayName: protectedName(recipient.display_name),
          phone: recipient.phone_e164,
        },
      });
    }

    const normalized = normalizeRecipientPhone(rawPhone);
    const ownRecipient = await dbBinding().prepare(
      `SELECT u.id
       FROM payment_directory d
       JOIN users u ON u.id = d.user_id
       WHERE d.phone_e164 = ? AND u.id = ? AND d.discoverable = 1
       LIMIT 1`,
    ).bind(normalized.e164, user.id).first<{ id: string }>();
    if (ownRecipient) return jsonError("No puedes transferirte a tu propia cuenta.", 409);

    // Los contactos guardados por la propia cuenta son privados y no gastan
    // créditos: sirven como autocompletado local, sin volver a consultar al
    // proveedor externo cada vez que se inicia una transferencia.
    const saved = await dbBinding().prepare(
      `SELECT id, display_name
       FROM saved_payment_recipients
       WHERE user_id = ? AND phone_e164 = ?
       LIMIT 1`,
    ).bind(user.id, normalized.e164).first<SavedRecipientRow>();
    if (saved) {
      return jsonOk({
        recipient: {
          displayName: protectedName(saved.display_name),
          phone: normalized.e164,
        },
      });
    }

    const internal = await findActiveRecipientByPhone(dbBinding(), normalized.e164);
    if (internal) {
      if (internal.id === user.id) return jsonError("No puedes transferirte a tu propia cuenta.", 409);
      return jsonOk({
        recipient: {
          displayName: protectedName(internal.display_name),
          phone: normalized.e164,
        },
      });
    }

    const freeRecipientResponse = async () => {
      // El directorio Free se consulta sin gastar créditos. Sus datos ya se
      // guardaron con consentimiento y el nombre se devuelve protegido.
      const globalRecipient = await lookupGlobalRecipient(normalized.e164);
      return globalRecipient
        ? jsonOk({
            recipient: {
              displayName: globalRecipient.displayName,
              phone: normalized.e164,
            },
          })
        : null;
    };

    const externalRecipientResponse = async () => {
      const reservation = await reserveAutocompleteCredit(user.id);
      if (!reservation) return null;
      try {
        const result = await lookupRecipientPhone({ rawPhone });
        // El proveedor externo solo se persiste como contacto privado de quien
        // consultó, para que la siguiente consulta no vuelva a gastar crédito.
        await saveExternalRecipient(user.id, normalized.e164, result.displayName);
        return jsonOk({
          recipient: {
            displayName: result.displayName,
            phone: result.phone,
          },
        });
      } catch (error) {
        await refundAutocompleteCredit(reservation);
        throw error;
      }
    };

    const autocompleteStatus = await getAutocompleteStatus(user.id);
    const hasCreditKey = autocompleteStatus.keyClaimed
      && Number(autocompleteStatus.credits ?? 0) > 0;

    if (hasCreditKey) {
      // Con una key con saldo se prioriza la API externa. Si no resuelve el
      // titular, se devuelve el registro Free sin volver a cobrar crédito.
      try {
        const external = await externalRecipientResponse();
        if (external) return external;
      } catch (error) {
        if (error instanceof RecipientLookupError) {
          const free = await freeRecipientResponse();
          if (free) return free;
        }
        throw error;
      }
    }

    // Sin una key con saldo, Free es siempre la primera y única consulta sin
    // coste. Esto permite usar registros globales aunque la cuenta no tenga
    // créditos disponibles.
    const free = await freeRecipientResponse();
    if (free) return free;

    const external = await externalRecipientResponse();
    if (external) return external;

    return jsonError("El autocompletado no tiene créditos disponibles.", 403);
  } catch (error) {
    if (error instanceof RecipientLookupError) return lookupErrorResponse(error);
    return routeError(error);
  }
}
