import { publicSha256, dbBinding } from "@/app/lib/auth-server";
import {
  type InfobipSmsDelivery,
  InfobipSmsError,
  buildPaymentSmsText,
  getInfobipSmsDelivery,
  sendInfobipSms,
} from "@/app/lib/infobip-sms";
import { maskPhone } from "@/app/lib/masked-phone";
import { normalizeSmsCreditToken } from "@/app/lib/sms-credit-tokens";

const DEFAULT_SMS_SETTINGS = {
  enabled: false,
  displayName: "",
  credits: 0,
};

type SmsSettingsRow = {
  enabled: number;
  display_name: string;
  credit_balance: number;
};

type SmsNotificationRow = {
  id: string;
  status: "pending" | "reserved" | "accepted" | "sent" | "delivered" | "failed" | "skipped";
  reservation_id: string | null;
};

export type SmsSettings = typeof DEFAULT_SMS_SETTINGS;

export type SmsSettingsPatch = {
  enabled?: boolean;
  displayName?: string;
};

type SmsReservation = {
  notificationId: string;
  displayName: string;
  deliveryCallbackData: string;
};

type SmsDeliveryCandidate = {
  id: string;
  provider_message_id: string;
  created_at: string;
};

const SMS_DELIVERY_LOOKUP_LIMIT = 50;
const SMS_DELIVERY_TIMEOUT_MS = 47 * 60 * 60 * 1_000;

function asSettings(row: SmsSettingsRow | null): SmsSettings {
  if (!row) return { ...DEFAULT_SMS_SETTINGS };
  return {
    enabled: Boolean(row.enabled),
    displayName: row.display_name,
    credits: Math.max(0, Number(row.credit_balance)),
  };
}

async function ensureSmsSettings(userId: string) {
  const now = new Date().toISOString();
  await dbBinding().prepare(
    `INSERT OR IGNORE INTO account_sms_settings (
      user_id, enabled, display_name, credit_balance, last_reservation_id, created_at, updated_at
    ) VALUES (?, 0, '', 0, NULL, ?, ?)`,
  ).bind(userId, now, now).run();
}

export async function getSmsSettings(userId: string): Promise<SmsSettings> {
  await ensureSmsSettings(userId);
  const row = await dbBinding().prepare(
    `SELECT enabled, display_name, credit_balance
     FROM account_sms_settings WHERE user_id = ? LIMIT 1`,
  ).bind(userId).first<SmsSettingsRow>();
  return asSettings(row);
}

export function normalizeSmsDisplayName(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
}

export async function updateSmsSettings(userId: string, patch: SmsSettingsPatch) {
  await ensureSmsSettings(userId);
  if (patch.enabled === undefined && patch.displayName === undefined) return getSmsSettings(userId);

  const assignments = ["updated_at = ?"];
  const values: unknown[] = [new Date().toISOString()];
  if (patch.enabled !== undefined) {
    assignments.push("enabled = ?");
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.displayName !== undefined) {
    assignments.push("display_name = ?");
    values.push(patch.displayName);
  }
  values.push(userId);
  await dbBinding().prepare(
    `UPDATE account_sms_settings SET ${assignments.join(", ")} WHERE user_id = ?`,
  ).bind(...values).run();
  return getSmsSettings(userId);
}

export async function smsCreditTokenHash(value: string) {
  return publicSha256(`sms-credit-token-v1\n${normalizeSmsCreditToken(value)}`);
}

export async function redeemSmsCreditToken(userId: string, rawToken: string) {
  const tokenHash = await smsCreditTokenHash(rawToken);
  const now = new Date().toISOString();
  const ledgerId = crypto.randomUUID();
  const database = dbBinding();
  const results = await database.batch([
    database.prepare(
      `UPDATE sms_credit_tokens
       SET redeemed_at = ?, redeemed_by_user_id = ?, redeemed_ledger_id = ?
       WHERE token_hash = ? AND revoked_at IS NULL AND redeemed_at IS NULL`,
    ).bind(now, userId, ledgerId, tokenHash),
    database.prepare(
      `INSERT INTO sms_credit_ledger (
        id, user_id, delta, reason, reference_id, created_at
      ) SELECT ?, ?, credits, 'token_redeem', id, ?
        FROM sms_credit_tokens
       WHERE token_hash = ? AND redeemed_ledger_id = ?`,
    ).bind(ledgerId, userId, now, tokenHash, ledgerId),
    database.prepare(
      `INSERT OR IGNORE INTO account_sms_settings (
        user_id, enabled, display_name, credit_balance, last_reservation_id, created_at, updated_at
      ) VALUES (?, 0, '', 0, NULL, ?, ?)`,
    ).bind(userId, now, now),
    database.prepare(
      `UPDATE account_sms_settings
       SET credit_balance = credit_balance + COALESCE((
             SELECT delta FROM sms_credit_ledger WHERE id = ?
           ), 0),
           enabled = CASE WHEN EXISTS (
             SELECT 1 FROM sms_credit_ledger WHERE id = ?
           ) THEN 1 ELSE enabled END,
           updated_at = ?
       WHERE user_id = ? AND EXISTS (
         SELECT 1 FROM sms_credit_ledger WHERE id = ?
       )`,
    ).bind(ledgerId, ledgerId, now, userId, ledgerId),
  ]);
  if (Number(results[1]?.meta.changes ?? 0) !== 1) return null;
  return getSmsSettings(userId);
}

async function recordSkippedSms(userId: string, movementId: string, phoneE164: string | null) {
  const now = new Date().toISOString();
  await dbBinding().prepare(
    `INSERT OR IGNORE INTO transfer_sms_notifications (
      id, movement_id, user_id, status, reservation_id, refund_ledger_id,
      recipient_reference, provider_message_id, failure_code, created_at, updated_at
    ) VALUES (?, ?, ?, 'skipped', NULL, NULL, ?, NULL, NULL, ?, ?)`,
  ).bind(crypto.randomUUID(), movementId, userId, phoneE164 ? maskPhone(phoneE164) : "", now, now).run();
}

async function reserveSmsForMovement(input: {
  userId: string;
  movementId: string;
  phoneE164: string | null;
}): Promise<SmsReservation | null> {
  if (!input.phoneE164) {
    await recordSkippedSms(input.userId, input.movementId, null);
    return null;
  }

  const now = new Date().toISOString();
  const notificationId = crypto.randomUUID();
  const reservationId = crypto.randomUUID();
  const deliveryCallbackData = crypto.randomUUID();
  const deliveryCallbackHash = await publicSha256(`infobip-delivery-v1\n${deliveryCallbackData}`);
  const database = dbBinding();
  const results = await database.batch([
    database.prepare(
      `INSERT OR IGNORE INTO transfer_sms_notifications (
        id, movement_id, user_id, status, reservation_id, refund_ledger_id,
        recipient_reference, provider_message_id, failure_code, delivery_callback_hash,
        provider_delivery_status, delivery_checked_at, delivery_finalized_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', NULL, NULL, ?, NULL, NULL, ?, NULL, NULL, NULL, ?, ?)`,
    ).bind(
      notificationId,
      input.movementId,
      input.userId,
      maskPhone(input.phoneE164),
      deliveryCallbackHash,
      now,
      now,
    ),
    database.prepare(
      `INSERT OR IGNORE INTO account_sms_settings (
        user_id, enabled, display_name, credit_balance, last_reservation_id, created_at, updated_at
      ) VALUES (?, 0, '', 0, NULL, ?, ?)`,
    ).bind(input.userId, now, now),
    database.prepare(
      `UPDATE account_sms_settings
       SET credit_balance = credit_balance - 1,
           last_reservation_id = ?,
           updated_at = ?
       WHERE user_id = ? AND enabled = 1 AND credit_balance > 0
         AND length(trim(display_name)) >= 2
         AND EXISTS (
           SELECT 1 FROM transfer_sms_notifications
           WHERE movement_id = ? AND status = 'pending'
         )`,
    ).bind(reservationId, now, input.userId, input.movementId),
    database.prepare(
      `INSERT INTO sms_credit_ledger (
        id, user_id, delta, reason, reference_id, created_at
      ) SELECT ?, ?, -1, 'send_debit', ?, ?
        FROM account_sms_settings
       WHERE user_id = ? AND last_reservation_id = ?`,
    ).bind(reservationId, input.userId, input.movementId, now, input.userId, reservationId),
    database.prepare(
      `UPDATE transfer_sms_notifications
       SET status = 'reserved', reservation_id = ?, updated_at = ?
       WHERE movement_id = ? AND status = 'pending' AND EXISTS (
         SELECT 1 FROM sms_credit_ledger WHERE id = ?
       )`,
    ).bind(reservationId, now, input.movementId, reservationId),
    database.prepare(
      `UPDATE transfer_sms_notifications
       SET status = 'skipped', updated_at = ?
       WHERE movement_id = ? AND status = 'pending'`,
    ).bind(now, input.movementId),
  ]);
  if (Number(results[4]?.meta.changes ?? 0) !== 1) return null;

  const settings = await getSmsSettings(input.userId);
  return { notificationId, displayName: settings.displayName, deliveryCallbackData };
}

async function markSmsAccepted(notificationId: string, messageId: string) {
  await dbBinding().prepare(
    `UPDATE transfer_sms_notifications
     SET status = 'accepted', provider_message_id = ?, provider_delivery_status = 'ACCEPTED', updated_at = ?
     WHERE id = ? AND status = 'reserved'`,
  ).bind(messageId.slice(0, 256), new Date().toISOString(), notificationId).run();
}

async function failSmsAndRefund(notificationId: string, failureCode: string, providerStatus = "FAILED") {
  const now = new Date().toISOString();
  const refundLedgerId = crypto.randomUUID();
  const database = dbBinding();
  const results = await database.batch([
    database.prepare(
      `UPDATE transfer_sms_notifications
       SET status = 'failed', failure_code = ?, refund_ledger_id = ?,
           provider_delivery_status = ?, delivery_checked_at = ?, delivery_finalized_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('reserved', 'accepted', 'sent')`,
    ).bind(failureCode.slice(0, 48), refundLedgerId, providerStatus.slice(0, 64), now, now, now, notificationId),
    database.prepare(
      `INSERT INTO sms_credit_ledger (
        id, user_id, delta, reason, reference_id, created_at
      ) SELECT ?, user_id, 1, 'send_refund', movement_id, ?
        FROM transfer_sms_notifications
       WHERE id = ? AND refund_ledger_id = ?`,
    ).bind(refundLedgerId, now, notificationId, refundLedgerId),
    database.prepare(
      `UPDATE account_sms_settings
       SET credit_balance = credit_balance + 1, updated_at = ?
       WHERE user_id = (SELECT user_id FROM sms_credit_ledger WHERE id = ?)
         AND EXISTS (SELECT 1 FROM sms_credit_ledger WHERE id = ?)`,
    ).bind(now, refundLedgerId, refundLedgerId),
  ]);
  return Number(results[1]?.meta.changes ?? 0) === 1;
}

async function markSmsDelivered(notificationId: string, providerStatus: string) {
  const now = new Date().toISOString();
  const result = await dbBinding().prepare(
    `UPDATE transfer_sms_notifications
     SET status = 'delivered', failure_code = NULL, provider_delivery_status = ?,
         delivery_checked_at = ?, delivery_finalized_at = ?, updated_at = ?
     WHERE id = ? AND status IN ('accepted', 'sent')`,
  ).bind(providerStatus.slice(0, 64), now, now, now, notificationId).run();
  return Number(result.meta.changes ?? 0) === 1;
}

async function recordSmsDeliveryCheck(notificationId: string, providerStatus: string) {
  const now = new Date().toISOString();
  await dbBinding().prepare(
    `UPDATE transfer_sms_notifications
     SET provider_delivery_status = ?, delivery_checked_at = ?, updated_at = ?
     WHERE id = ? AND status IN ('accepted', 'sent')`,
  ).bind(providerStatus.slice(0, 64), now, now, notificationId).run();
}

async function applySmsDelivery(notificationId: string, delivery: InfobipSmsDelivery) {
  if (delivery.state === "delivered") {
    return { delivered: await markSmsDelivered(notificationId, delivery.providerStatus), refunded: false };
  }
  if (delivery.state === "failed") {
    return {
      delivered: false,
      refunded: await failSmsAndRefund(
        notificationId,
        delivery.failureCode ?? "delivery_failed",
        delivery.providerStatus,
      ),
    };
  }
  await recordSmsDeliveryCheck(notificationId, delivery.providerStatus);
  return { delivered: false, refunded: false };
}

export async function processInfobipDeliveryReport(input: {
  messageId: string;
  callbackData: string;
  delivery: InfobipSmsDelivery;
}) {
  const messageId = input.messageId.trim();
  const callbackData = input.callbackData.trim();
  if (!messageId || messageId.length > 256 || callbackData.length < 16 || callbackData.length > 256) return false;
  const callbackHash = await publicSha256(`infobip-delivery-v1\n${callbackData}`);
  const row = await dbBinding().prepare(
    `SELECT id, status, reservation_id
     FROM transfer_sms_notifications
     WHERE provider_message_id = ? AND delivery_callback_hash = ? LIMIT 1`,
  ).bind(messageId, callbackHash).first<SmsNotificationRow>();
  if (!row) return false;
  await applySmsDelivery(row.id, input.delivery);
  return true;
}

function deliveryTimedOut(createdAt: string, now: number) {
  const startedAt = Date.parse(createdAt);
  return Number.isFinite(startedAt) && now - startedAt >= SMS_DELIVERY_TIMEOUT_MS;
}

export async function reconcileSmsDeliveries(input: { limit?: number } = {}) {
  const limit = Math.max(1, Math.min(SMS_DELIVERY_LOOKUP_LIMIT, Math.floor(input.limit ?? SMS_DELIVERY_LOOKUP_LIMIT)));
  const rows = await dbBinding().prepare(
    `SELECT id, provider_message_id, created_at
     FROM transfer_sms_notifications
     WHERE status = 'accepted' AND provider_message_id IS NOT NULL
     ORDER BY created_at ASC LIMIT ?`,
  ).bind(limit).all<SmsDeliveryCandidate>();
  const summary = { checked: 0, delivered: 0, refunded: 0, pending: 0, deferred: 0 };
  const now = Date.now();

  for (const row of rows.results ?? []) {
    try {
      const delivery = await getInfobipSmsDelivery(row.provider_message_id);
      summary.checked += 1;
      if (!delivery) {
        if (deliveryTimedOut(row.created_at, now)) {
          if (await failSmsAndRefund(row.id, "delivery_status_timeout", "STATUS_TIMEOUT")) summary.refunded += 1;
        } else {
          summary.pending += 1;
        }
        continue;
      }

      const outcome = await applySmsDelivery(row.id, delivery);
      if (outcome.delivered) summary.delivered += 1;
      else if (outcome.refunded) summary.refunded += 1;
      else summary.pending += 1;
    } catch {
      // Un fallo transitorio de consulta no debe dar por perdido un SMS válido.
      summary.deferred += 1;
    }
  }

  return summary;
}

function failureCode(error: unknown) {
  if (error instanceof InfobipSmsError) return error.code;
  return "internal";
}

/** El fallo del proveedor nunca interrumpe una transferencia ya persistida. */
export async function dispatchPaymentSms(input: {
  userId: string;
  movementId: string;
  phoneE164: string | null;
  amountCents: number;
  securityCode: string;
}) {
  let reservation: SmsReservation | null = null;
  try {
    reservation = await reserveSmsForMovement(input);
    if (!reservation) return;
    const response = await sendInfobipSms({
      to: input.phoneE164 as string,
      text: buildPaymentSmsText({
        displayName: reservation.displayName,
        amountCents: input.amountCents,
        securityCode: input.securityCode,
      }),
      deliveryCallbackData: reservation.deliveryCallbackData,
    });
    await markSmsAccepted(reservation.notificationId, response.messageId);
  } catch (error) {
    if (reservation) {
      try {
        await failSmsAndRefund(reservation.notificationId, failureCode(error));
      } catch {
        // El registro queda reservado para impedir un reenvío duplicado.
      }
    }
  }
}

export async function listSmsCreditTokens() {
  const result = await dbBinding().prepare(
    `SELECT t.id, t.token_hint, t.credits, t.created_at, t.revoked_at,
            t.redeemed_at, u.display_name AS created_by_name,
            r.display_name AS redeemed_by_name
     FROM sms_credit_tokens t
     JOIN users u ON u.id = t.created_by
     LEFT JOIN users r ON r.id = t.redeemed_by_user_id
     ORDER BY t.created_at DESC LIMIT 100`,
  ).all();
  return result.results ?? [];
}
