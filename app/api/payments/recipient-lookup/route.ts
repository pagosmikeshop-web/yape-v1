import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requireUnlockedSession,
  requestIpRateLimitSubject,
  routeError,
} from "@/app/lib/auth-server";
import { RecipientLookupError } from "@/app/lib/recipient-lookup/errors";
import { maskRecipientName } from "@/app/lib/recipient-lookup/name-masker";
import { normalizeRecipientPhone } from "@/app/lib/recipient-lookup/phone";
import { lookupRecipientPhone } from "@/app/lib/recipient-lookup/service";

export const dynamic = "force-dynamic";

type RecipientRow = { id: string; display_name: string; phone_e164?: string | null };
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
      const recipient = await dbBinding().prepare(
        `SELECT u.id, u.display_name, d.phone_e164
         FROM users u
         LEFT JOIN payment_directory d ON d.user_id = u.id AND d.discoverable = 1
         WHERE u.id = ? AND (u.role = 'client' OR EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'client'
         )) AND u.status = 'active' AND u.deleted_at IS NULL
         LIMIT 1`,
      ).bind(recipientId).first<RecipientRow>();
      if (!recipient) return jsonError("No encontramos un destinatario activo con esos datos.", 404);
      return jsonOk({
        recipient: {
          id: recipient.id,
          displayName: protectedName(recipient.display_name),
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

    const result = await lookupRecipientPhone({
      rawPhone,
    });
    const internal = await dbBinding().prepare(
      `SELECT u.id
       FROM payment_directory d
       JOIN users u ON u.id = d.user_id
       WHERE d.phone_e164 = ? AND d.discoverable = 1
         AND (u.role = 'client' OR EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'client'
         )) AND u.status = 'active' AND u.deleted_at IS NULL
       LIMIT 1`,
    ).bind(normalized.e164).first<{ id: string }>();

    if (!internal) await saveExternalRecipient(user.id, normalized.e164, result.displayName);
    return jsonOk({
      recipient: {
        displayName: result.displayName,
        phone: result.phone,
      },
    });
  } catch (error) {
    if (error instanceof RecipientLookupError) return lookupErrorResponse(error);
    return routeError(error);
  }
}
