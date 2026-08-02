import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { findActiveRecipientById, findActiveRecipientByPhone } from "@/app/lib/active-recipient-server";
import {
  dbBinding,
  enforceAuthRateLimits,
  isUniqueConstraintError,
  normalizePeruvianMobile,
  requestIpRateLimitSubject,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import { lookupGlobalRecipient } from "@/app/lib/global-recipient-directory";
import { maskPhone } from "@/app/lib/masked-phone";
import {
  maskRecipientName,
  tryMaskRecipientName,
} from "@/app/lib/recipient-lookup/name-masker";
import { normalizeRecipientPhone } from "@/app/lib/recipient-lookup/phone";
import { writeSecurityEvent } from "@/app/lib/security-log";

export const dynamic = "force-dynamic";

const MAX_TRANSFER_CENTS = 50_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALLOWED_DESTINATIONS = new Set([
  "Yape",
  "Banco Falabella",
  "Cmac Arequipa",
  "Dale",
  "Plin",
]);

type MovementRow = {
  id: string;
  recipient_name: string;
  recipient_reference: string;
  recipient_user_id: string | null;
  saved_recipient_id: string | null;
  destination: string;
  amount_cents: number;
  message: string;
  security_code: string;
  operation_number: string;
  created_at: string;
};

type ResolvedRecipient = {
  name: string;
  reference: string;
  recipientUserId: string | null;
  savedRecipientId: string | null;
};

function cleanText(value: unknown, maximum: number) {
  return asString(value).trim().replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, maximum);
}

async function persistSavedRecipientName(savedRecipientId: string, displayName: string) {
  await dbBinding().prepare(
    `UPDATE saved_payment_recipients
     SET display_name = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(displayName, new Date().toISOString(), savedRecipientId).run();
}

async function resolveRecipient(
  requesterUserId: string,
  recipientId: string,
  rawPhone: string,
  displayName = "",
  recipientSource = "claro",
): Promise<ResolvedRecipient | null> {
  const database = dbBinding();
  if (recipientId) {
    if (!UUID_PATTERN.test(recipientId) || recipientId === requesterUserId) return null;
    const row = await findActiveRecipientById(database, recipientId);
    if (!row) return null;
    const displayName = maskRecipientName(row.display_name);
    return {
      name: displayName,
      reference: row.phone_e164 ? maskPhone(row.phone_e164) : "QR Yape",
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
      recipientUserId: internal.id,
      savedRecipientId: null,
    };
  }

  const globalRecipient = await lookupGlobalRecipient(phoneE164);
  if (globalRecipient) {
    return {
      name: globalRecipient.displayName,
      reference: maskPhone(phoneE164),
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
    recipientUserId: null,
    savedRecipientId: saved.id,
  };
}

async function findIdempotentMovement(userId: string, idempotencyKey: string) {
  return dbBinding().prepare(
    `SELECT id, recipient_name, recipient_reference, recipient_user_id, saved_recipient_id,
      destination, amount_cents, message, security_code, operation_number, created_at
     FROM account_movements
     WHERE user_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(userId, idempotencyKey).first<MovementRow>();
}

async function currentBalance(userId: string) {
  const row = await dbBinding().prepare(
    "SELECT balance_cents FROM account_balances WHERE user_id = ? LIMIT 1",
  ).bind(userId).first<{ balance_cents: number }>();
  return Number(row?.balance_cents ?? 0);
}

function movementPayload(row: MovementRow) {
  let recipientName = "Destinatario verificado";
  try {
    recipientName = maskRecipientName(row.recipient_name);
  } catch {
    // Mantener el fallback defensivo para datos históricos malformados.
  }
  return {
    id: row.id,
    recipientName,
    recipientReference: row.recipient_reference,
    destination: row.destination,
    amountCents: Number(row.amount_cents),
    message: row.message,
    securityCode: row.security_code,
    operationNumber: row.operation_number,
    createdAt: row.created_at,
  };
}

function sameOperation(
  row: MovementRow,
  recipient: ResolvedRecipient,
  amountCents: number,
  destination: string,
  message: string,
) {
  return Number(row.amount_cents) === amountCents
    && row.destination === destination
    && row.message === message
    && row.recipient_name === recipient.name
    && row.recipient_user_id === recipient.recipientUserId
    && row.saved_recipient_id === recipient.savedRecipientId;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin", "seller", "client"]);
    await enforceAuthRateLimits([
      {
        bucket: "transfer-user",
        subject: user.id,
        limit: 60,
        windowSeconds: 60 * 60,
      },
      {
        bucket: "transfer-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 120,
        windowSeconds: 60 * 60,
      },
    ]);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!UUID_PATTERN.test(idempotencyKey)) {
      return jsonError("Falta una clave de idempotencia válida.", 400);
    }

    const body = await readJson(request);
    const amountCents = typeof body.amountCents === "number" ? body.amountCents : Number.NaN;
    const recipientId = asString(body.recipientId).trim();
    const recipientPhone = asString(body.recipientPhone).trim();
    const recipientManualName = asString(body.recipientManualName).trim();
    const destination = cleanText(body.destination, 48) || "Yape";
    const message = cleanText(body.message, 120);

    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_TRANSFER_CENTS) {
      return jsonError("Ingresa un monto válido de hasta S/ 500.");
    }
    if (!ALLOWED_DESTINATIONS.has(destination)) return jsonError("Selecciona un destino permitido.");
    if (!recipientId && !recipientPhone) return jsonError("Verifica el destinatario antes de continuar.", 400);
    if (recipientId && recipientPhone) return jsonError("Indica un solo destinatario.", 400);
    let recipientDisplayName = "";
    const recipientSource = "manual";
    if (!recipientId) {
      normalizeRecipientPhone(recipientPhone);
      recipientDisplayName = tryMaskRecipientName(recipientManualName);
      if (!recipientDisplayName) {
        return jsonError("Escribe un nombre válido para el destinatario.", 409);
      }
    }
    const recipient = await resolveRecipient(
      user.id,
      recipientId,
      recipientPhone,
      recipientDisplayName,
      recipientSource,
    );
    if (!recipient) return jsonError("No se pudo verificar el destinatario.", 400);

    const existing = await findIdempotentMovement(user.id, idempotencyKey);
    if (existing) {
      if (!sameOperation(existing, recipient, amountCents, destination, message)) {
        return jsonError("La clave de idempotencia ya fue usada para otra operación.", 409);
      }
      const balanceCents = await currentBalance(user.id);
      writeSecurityEvent(request, "payment.transfer", "success", {
        actorId: user.id,
        movementId: existing.id,
        replayed: true,
      });
      return jsonOk({
        replayed: true,
        balanceCents,
        balance: balanceCents / 100,
        movement: movementPayload(existing),
      });
    }

    const database = dbBinding();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const securityCode = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000).padStart(3, "0");
    let inserted: MovementRow | null = null;

    for (let attempt = 0; attempt < 4 && !inserted; attempt += 1) {
      const operationNumber = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000).padStart(8, "0");
      try {
        const statements = [
          database.prepare(
            `INSERT INTO account_movements (
              id, user_id, recipient_name, recipient_reference, recipient_user_id,
              saved_recipient_id, destination, amount_cents, message, security_code,
              operation_number, idempotency_key, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            id,
            user.id,
            recipient.name,
            recipient.reference,
            recipient.recipientUserId,
            recipient.savedRecipientId,
            destination,
            amountCents,
            message,
            securityCode,
            operationNumber,
            idempotencyKey,
            createdAt,
          ),
        ];
        if (recipient.recipientUserId) {
          statements.push(database.prepare(
            `INSERT INTO account_balances (user_id, balance_cents, is_configured, updated_at)
             VALUES (?, ?, 1, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               balance_cents = balance_cents + excluded.balance_cents,
               is_configured = 1,
               updated_at = excluded.updated_at`,
          ).bind(recipient.recipientUserId, amountCents, createdAt));
        }
        await database.batch(statements);
        inserted = {
          id,
          recipient_name: recipient.name,
          recipient_reference: recipient.reference,
          recipient_user_id: recipient.recipientUserId,
          saved_recipient_id: recipient.savedRecipientId,
          destination,
          amount_cents: amountCents,
          message,
          security_code: securityCode,
          operation_number: operationNumber,
          created_at: createdAt,
        };
      } catch (error) {
        const concurrent = await findIdempotentMovement(user.id, idempotencyKey);
        if (concurrent) {
          if (!sameOperation(concurrent, recipient, amountCents, destination, message)) {
            return jsonError("La clave de idempotencia ya fue usada para otra operación.", 409);
          }
          const balanceCents = await currentBalance(user.id);
          writeSecurityEvent(request, "payment.transfer", "success", {
            actorId: user.id,
            movementId: concurrent.id,
            replayed: true,
          });
          return jsonOk({
            replayed: true,
            balanceCents,
            balance: balanceCents / 100,
            movement: movementPayload(concurrent),
          });
        }
        const messageText = error instanceof Error ? error.message : "";
        if (/INSUFFICIENT_BALANCE/iu.test(messageText)) {
          writeSecurityEvent(request, "payment.transfer", "denied", {
            actorId: user.id,
            reason: "insufficient_balance",
          });
          return jsonError("Saldo insuficiente", 409);
        }
        if (/DAILY_LIMIT_EXCEEDED/iu.test(messageText)) {
          writeSecurityEvent(request, "payment.transfer", "denied", {
            actorId: user.id,
            reason: "daily_limit",
          });
          return jsonError("Alcanzaste el límite diario de S/ 2,000.", 409);
        }
        if (/operation_number|account_movements\.operation_number/iu.test(messageText)) continue;
        throw error;
      }
    }
    if (!inserted) throw new Error("Could not allocate a unique operation number.");

    const balanceCents = await currentBalance(user.id);
    writeSecurityEvent(request, "payment.transfer", "success", {
      actorId: user.id,
      movementId: inserted.id,
      replayed: false,
    });
    return jsonOk({
      replayed: false,
      balanceCents,
      balance: balanceCents / 100,
      movement: movementPayload(inserted),
    }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
