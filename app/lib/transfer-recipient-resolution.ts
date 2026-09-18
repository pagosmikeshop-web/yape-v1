import { findActiveRecipientById, findActiveRecipientByPhone } from "@/app/lib/active-recipient-server";
import {
  dbBinding,
  isUniqueConstraintError,
  normalizePeruvianMobile,
} from "@/app/lib/auth-server";
import { lookupGlobalRecipient } from "@/app/lib/global-recipient-directory";
import { maskPhone } from "@/app/lib/masked-phone";
import { normalizePaymentProvider } from "@/app/lib/payment-providers";
import { maskRecipientName } from "@/app/lib/recipient-lookup/name-masker";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ResolvedRecipient = {
  name: string;
  reference: string;
  /** Solo para servicios del servidor; nunca se serializa al cliente. */
  phoneE164: string | null;
  provider: string | null;
  providers: string[];
  recipientUserId: string | null;
  savedRecipientId: string | null;
};

type GlobalQrRecipientRow = {
  holder_name: string;
  phone_e164: string | null;
  provider: string;
  recipient_user_id: string | null;
};

async function persistSavedRecipientName(
  savedRecipientId: string,
  displayName: string,
) {
  await dbBinding().prepare(
    `UPDATE saved_payment_recipients
     SET display_name = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(displayName, new Date().toISOString(), savedRecipientId).run();
}

export async function resolveTransferRecipient(
  requesterUserId: string,
  recipientId: string,
  recipientQrId: string,
  rawPhone: string,
  displayName = "",
  recipientSource = "claro",
): Promise<ResolvedRecipient | null> {
  const database = dbBinding();
  if (recipientQrId) {
    if (!UUID_PATTERN.test(recipientQrId)) return null;
    const qr = await database.prepare(
      `SELECT holder_name, phone_e164, provider, recipient_user_id
       FROM global_qr_directory
       WHERE id = ? AND status = 'active'
         AND (expires_at IS NULL OR expires_at > ?)
       LIMIT 1`,
    ).bind(recipientQrId, new Date().toISOString()).first<GlobalQrRecipientRow>();
    if (!qr || qr.recipient_user_id === requesterUserId) return null;
    return {
      // El titular de un QR global es un valor introducido por su creador.
      // Se conserva exactamente como fue registrado (puede ser nombre completo
      // o una versión protegida escrita por el propio usuario).
      name: qr.holder_name,
      reference: qr.phone_e164 ? maskPhone(qr.phone_e164) : "",
      phoneE164: qr.phone_e164,
      provider: normalizePaymentProvider(qr.provider),
      providers: [normalizePaymentProvider(qr.provider)],
      recipientUserId: qr.recipient_user_id,
      savedRecipientId: null,
    };
  }
  if (recipientId) {
    if (!UUID_PATTERN.test(recipientId) || recipientId === requesterUserId) return null;
    const row = await findActiveRecipientById(database, recipientId);
    if (!row) return null;
    const maskedName = maskRecipientName(row.display_name);
    return {
      name: maskedName,
      reference: row.phone_e164 ? maskPhone(row.phone_e164) : "",
      phoneE164: row.phone_e164,
      provider: "Yape",
      providers: ["Yape"],
      recipientUserId: row.id,
      savedRecipientId: null,
    };
  }

  const phoneE164 = normalizePeruvianMobile(rawPhone);
  if (!phoneE164 || !displayName) return null;
  const internal = await findActiveRecipientByPhone(database, phoneE164);
  if (internal) {
    if (internal.id === requesterUserId) return null;
    return {
      name: displayName,
      reference: maskPhone(phoneE164),
      phoneE164,
      provider: "Yape",
      providers: ["Yape"],
      recipientUserId: internal.id,
      savedRecipientId: null,
    };
  }

  const globalRecipient = await lookupGlobalRecipient(phoneE164);
  if (globalRecipient) {
    return {
      name: globalRecipient.displayName,
      reference: maskPhone(phoneE164),
      phoneE164,
      provider: globalRecipient.provider,
      providers: globalRecipient.providers,
      recipientUserId: null,
      savedRecipientId: null,
    };
  }

  let saved = await database.prepare(
    `SELECT id, display_name FROM saved_payment_recipients
     WHERE user_id = ? AND phone_e164 = ? LIMIT 1`,
  ).bind(requesterUserId, phoneE164).first<{ id: string; display_name: string }>();
  if (!saved) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    try {
      await database.prepare(
        `INSERT INTO saved_payment_recipients (
          id, user_id, phone_e164, display_name, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, requesterUserId, phoneE164, displayName, recipientSource, now, now).run();
      saved = { id, display_name: displayName };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      saved = await database.prepare(
        `SELECT id, display_name FROM saved_payment_recipients
         WHERE user_id = ? AND phone_e164 = ? LIMIT 1`,
      ).bind(requesterUserId, phoneE164).first<{ id: string; display_name: string }>();
    }
  }
  if (!saved) return null;
  if (displayName !== saved.display_name) {
    await persistSavedRecipientName(saved.id, displayName);
  }
  return {
    name: displayName,
    reference: maskPhone(phoneE164),
    phoneE164,
    provider: null,
    providers: [],
    recipientUserId: null,
    savedRecipientId: saved.id,
  };
}
