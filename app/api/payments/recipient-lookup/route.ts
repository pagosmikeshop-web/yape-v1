import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { findActiveRecipientById, findActiveRecipientByPhone } from "@/app/lib/active-recipient-server";
import {
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
import { normalizeRecipientPhone } from "@/app/lib/recipient-lookup/phone";
import { lookupRecipientPhone } from "@/app/lib/recipient-lookup/service";
import {
  lookupErrorResponse,
  protectedRecipientName,
  saveExternalRecipient,
  type SavedRecipientRow,
} from "@/app/lib/recipient-lookup/route-support";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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
    if (Object.keys(body).some((key) => !["recipientId", "phone", "configuredOnly"].includes(key))) {
      return jsonError("La solicitud contiene campos no permitidos.", 400);
    }
    if (body.configuredOnly !== undefined && typeof body.configuredOnly !== "boolean") {
      return jsonError("El modo de consulta configurada no es válido.", 400);
    }
    const configuredOnly = body.configuredOnly === true;
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
          displayName: protectedRecipientName(recipient.display_name),
          phone: recipient.phone_e164,
          provider: "Yape",
          providers: ["Yape"],
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

    const globalRecipient = await lookupGlobalRecipient(normalized.e164);
    if (globalRecipient) {
      return jsonOk({
        recipient: {
          displayName: globalRecipient.displayName,
          provider: globalRecipient.provider,
          providers: globalRecipient.providers,
          phone: normalized.e164,
        },
      });
    }

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
          displayName: protectedRecipientName(saved.display_name),
          provider: "Yape",
          providers: ["Yape"],
          phone: normalized.e164,
        },
      });
    }

    const internal = await findActiveRecipientByPhone(dbBinding(), normalized.e164);
    if (internal) {
      if (internal.id === user.id) return jsonError("No puedes transferirte a tu propia cuenta.", 409);
      return jsonOk({
        recipient: {
          displayName: protectedRecipientName(internal.display_name),
          provider: "Yape",
          providers: ["Yape"],
          phone: normalized.e164,
        },
      });
    }

    const freeRecipientResponse = async () => {
      // El directorio Free se consulta sin gastar créditos. Sus datos ya se
      // guardaron con consentimiento y se devuelve el formato elegido por su creador.
      const globalRecipient = await lookupGlobalRecipient(normalized.e164);
      return globalRecipient
        ? jsonOk({
            recipient: {
              displayName: globalRecipient.displayName,
              provider: globalRecipient.provider,
              providers: globalRecipient.providers,
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
            provider: "Yape",
            providers: ["Yape"],
            phone: result.phone,
          },
        });
      } catch (error) {
        await refundAutocompleteCredit(reservation);
        throw error;
      }
    };

    // El registro Free es la configuración explícita del usuario para ese
    // número (incluido Plin u otro banco), por lo que debe ganar a cualquier
    // consulta externa que no conoce ese destino.
    const free = await freeRecipientResponse();
    if (free) return free;

    // Frecuentes solo debe usar configuraciones explícitas guardadas en la
    // cuenta/directorio. Nunca debe consumir un crédito de autocompletado para
    // convertir un contacto frecuente en un destinatario Yape por defecto.
    if (configuredOnly) {
      return jsonError("No hay un proveedor configurado para este número.", 404);
    }

    const external = await externalRecipientResponse();
    if (external) return external;

    return jsonError("El autocompletado no tiene créditos disponibles.", 403);
  } catch (error) {
    if (error instanceof RecipientLookupError) return lookupErrorResponse(error);
    return routeError(error);
  }
}
