import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  normalizePeruvianMobile,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

type RecipientRow = { id: string; display_name: string };
type SavedRecipientRow = { id: string; display_name: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOOKUP_LIMIT_PER_HOUR = 60;

async function consumeLookupAttempt(requesterUserId: string) {
  const database = dbBinding();
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const results = await database.batch([
    database.prepare(
      `INSERT INTO recipient_lookup_attempts (id, requester_user_id, created_at)
       SELECT ?, ?, ?
       WHERE (
         SELECT COUNT(*) FROM recipient_lookup_attempts
         WHERE requester_user_id = ? AND created_at >= ?
       ) < ?`,
    ).bind(
      crypto.randomUUID(),
      requesterUserId,
      now,
      requesterUserId,
      cutoff,
      LOOKUP_LIMIT_PER_HOUR,
    ),
    database.prepare(
      "DELETE FROM recipient_lookup_attempts WHERE created_at < ?",
    ).bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  return Number(results[0]?.meta.changes ?? 0) === 1;
}

async function saveExternalRecipient(requesterUserId: string, phoneE164: string) {
  const now = new Date().toISOString();
  const saved = await dbBinding().prepare(
    `INSERT INTO saved_payment_recipients (
      id, user_id, phone_e164, display_name, source, created_at, updated_at
    ) VALUES (?, ?, ?, 'Número nuevo', 'manual', ?, ?)
    ON CONFLICT(user_id, phone_e164) DO UPDATE SET
      updated_at = excluded.updated_at
    RETURNING id, display_name`,
  ).bind(
    crypto.randomUUID(),
    requesterUserId,
    phoneE164,
    now,
    now,
  ).first<SavedRecipientRow>();
  if (!saved) throw new Error("No se pudo guardar el destinatario.");
  return saved;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin", "seller", "client"]);
    const body = await readJson(request);
    const recipientId = asString(body.recipientId);
    const rawPhone = asString(body.phone);
    const phoneE164 = rawPhone ? normalizePeruvianMobile(rawPhone) : "";

    if (!recipientId && !rawPhone) return jsonError("Indica un QR o número de celular.");
    if (recipientId && !UUID_PATTERN.test(recipientId)) {
      return jsonError("El QR no contiene un destinatario válido.");
    }
    if (rawPhone && !phoneE164) return jsonError("Ingresa un celular peruano válido.");
    if (recipientId === user.id) {
      return jsonError("No puedes transferirte a tu propia cuenta.", 409);
    }
    if (!(await consumeLookupAttempt(user.id))) {
      return jsonError("Alcanzaste el límite temporal de consultas. Intenta más tarde.", 429);
    }

    const recipient = recipientId
      ? await dbBinding().prepare(
        `SELECT id, display_name
         FROM users
         WHERE id = ? AND role = 'client' AND status = 'active' AND deleted_at IS NULL
         LIMIT 1`,
      ).bind(recipientId).first<RecipientRow>()
      : await dbBinding().prepare(
        `SELECT u.id, u.display_name
         FROM payment_directory d
         JOIN users u ON u.id = d.user_id
         WHERE d.phone_e164 = ? AND d.discoverable = 1
           AND u.role = 'client' AND u.status = 'active' AND u.deleted_at IS NULL
         LIMIT 1`,
      ).bind(phoneE164).first<RecipientRow>();

    if (!recipient) {
      if (phoneE164) {
        const savedRecipient = await saveExternalRecipient(user.id, phoneE164);
        return jsonOk({
          found: false,
          recipient: null,
          savedRecipient: {
            id: savedRecipient.id,
            displayName: savedRecipient.display_name,
            phone: phoneE164.replace(/^\+51/u, ""),
          },
        });
      }
      return jsonError("No encontramos un destinatario activo con esos datos.", 404);
    }
    if (recipient.id === user.id) {
      return jsonError("No puedes transferirte a tu propia cuenta.", 409);
    }
    return jsonOk({
      recipient: {
        id: recipient.id,
        displayName: recipient.display_name,
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
