import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { dbBinding, normalizePeruvianMobile, requireUnlockedSession, routeError } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

type RecipientRow = {
  id: string;
  display_name: string;
};

type SavedRecipientRow = {
  id: string;
  display_name: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOOKUP_LIMIT_PER_HOUR = 60;

async function consumeLookupAttempt(requesterUserId: string) {
  const database = dbBinding();
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const usage = await database.prepare(
    "SELECT COUNT(*) AS total FROM recipient_lookup_attempts WHERE requester_user_id = ? AND created_at >= ?",
  ).bind(requesterUserId, cutoff).first<{ total: number }>();
  if (Number(usage?.total ?? 0) >= LOOKUP_LIMIT_PER_HOUR) return false;

  const now = new Date().toISOString();
  await database.batch([
    database.prepare(
      "INSERT INTO recipient_lookup_attempts (id, requester_user_id, created_at) VALUES (?, ?, ?)",
    ).bind(crypto.randomUUID(), requesterUserId, now),
    database.prepare("DELETE FROM recipient_lookup_attempts WHERE created_at < ?").bind(
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    ),
  ]);
  return true;
}

async function saveExternalRecipient(requesterUserId: string, phoneE164: string) {
  const now = new Date().toISOString();
  const existing = await dbBinding().prepare(
    "SELECT id, display_name FROM saved_payment_recipients WHERE user_id = ? AND phone_e164 = ? LIMIT 1",
  ).bind(requesterUserId, phoneE164).first<SavedRecipientRow>();

  if (existing) {
    await dbBinding().prepare(
      "UPDATE saved_payment_recipients SET updated_at = ? WHERE id = ?",
    ).bind(now, existing.id).run();
    return existing;
  }

  const id = crypto.randomUUID();
  await dbBinding().prepare(
    `INSERT INTO saved_payment_recipients (
      id, user_id, phone_e164, display_name, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, requesterUserId, phoneE164, "Número nuevo", "manual", now, now).run();

  return { id, display_name: "Número nuevo" };
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin", "seller", "client"]);
    const body = await readJson(request);
    const recipientId = asString(body.recipientId);
    const rawPhone = asString(body.phone);
    const phoneE164 = rawPhone ? normalizePeruvianMobile(rawPhone) : "";

    if (!recipientId && !rawPhone) return jsonError("Indica un QR o número de celular.");
    if (recipientId && !UUID_PATTERN.test(recipientId)) return jsonError("El QR no contiene un destinatario válido.");
    if (rawPhone && !phoneE164) return jsonError("Ingresa un celular peruano válido.");
    if (recipientId === user.id) return jsonError("No puedes transferirte a tu propia cuenta.", 409);
    if (!await consumeLookupAttempt(user.id)) return jsonError("Alcanzaste el límite temporal de consultas. Intenta más tarde.", 429);

    const recipient = recipientId
      ? await dbBinding().prepare(
        `SELECT id, display_name
         FROM users
         WHERE id = ? AND role = 'client' AND status = 'active'
         LIMIT 1`,
      ).bind(recipientId).first<RecipientRow>()
      : await dbBinding().prepare(
        `SELECT u.id, u.display_name
         FROM payment_directory d
         JOIN users u ON u.id = d.user_id
         WHERE d.phone_e164 = ? AND d.discoverable = 1
           AND u.role = 'client' AND u.status = 'active'
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
    if (recipient.id === user.id) return jsonError("No puedes transferirte a tu propia cuenta.", 409);

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
