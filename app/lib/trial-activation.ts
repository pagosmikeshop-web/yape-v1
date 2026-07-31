import {
  dbBinding,
  ensureAuthSchema,
  trialExpiresAt,
} from "@/app/lib/auth-server";

/** Identificador estable en activations.seller_id para trials por membresía Telegram. */
export const TELEGRAM_TRIAL_SELLER_ID = "system-telegram-trial";

export type ActivateClientTrialResult =
  | {
    ok: true;
    activated: true;
    accessExpiresAt: string;
    activatedAt: string;
  }
  | {
    ok: true;
    activated: false;
    reason: "already-active" | "already-activated";
    accessExpiresAt: string | null;
    activatedAt: string | null;
  }
  | {
    ok: false;
    reason: "not-found" | "not-pending" | "disabled" | "conflict";
  };

/**
 * Activa un cliente pending con prueba gratuita (72h vía trialExpiresAt).
 * Idempotente: activations.user_id es UNIQUE; no reinicia fechas si ya hay activation.
 */
export async function activateClientTrial(input: {
  userId: string;
  sellerId: string;
  updatedBy: string;
}): Promise<ActivateClientTrialResult> {
  await ensureAuthSchema();
  const database = dbBinding();
  const client = await database.prepare(
    `SELECT id, status, activated_at, access_expires_at
     FROM users
     WHERE id = ? AND (role = 'client' OR EXISTS (
       SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client'
     )) AND deleted_at IS NULL
     LIMIT 1`,
  ).bind(input.userId).first<{
    id: string;
    status: string;
    activated_at: string | null;
    access_expires_at: string | null;
  }>();

  if (!client) return { ok: false, reason: "not-found" };
  if (client.status === "disabled") return { ok: false, reason: "disabled" };

  const existingActivation = await database.prepare(
    "SELECT id, created_at FROM activations WHERE user_id = ? LIMIT 1",
  ).bind(client.id).first<{ id: string; created_at: string }>();

  if (existingActivation) {
    return {
      ok: true,
      activated: false,
      reason: "already-activated",
      accessExpiresAt: client.access_expires_at,
      activatedAt: client.activated_at ?? existingActivation.created_at,
    };
  }

  if (client.status === "active") {
    return {
      ok: true,
      activated: false,
      reason: "already-active",
      accessExpiresAt: client.access_expires_at,
      activatedAt: client.activated_at,
    };
  }

  if (client.status !== "pending") {
    return { ok: false, reason: "not-pending" };
  }

  const now = new Date().toISOString();
  const accessExpiresAt = trialExpiresAt();
  const activationId = crypto.randomUUID();

  const results = await database.batch([
    database.prepare(
      `INSERT INTO activations (id, user_id, seller_id, credits_charged, created_at)
       SELECT ?, id, ?, 0, ? FROM users
     WHERE id = ? AND (role = 'client' OR EXISTS (
       SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client'
     )) AND status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM activations WHERE user_id = ?)`,
    ).bind(activationId, input.sellerId, now, client.id, client.id),
    database.prepare(
      `UPDATE users SET status = 'active', activated_at = ?, access_expires_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'
         AND EXISTS (SELECT 1 FROM activations WHERE id = ? AND user_id = ?)`,
    ).bind(now, accessExpiresAt, now, client.id, activationId, client.id),
    database.prepare(
      `INSERT INTO client_crm_profiles
         (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
       VALUES (?, 'new', 'individual', 'general', '[]', '', ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         crm_status = 'new',
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    ).bind(client.id, now, input.updatedBy, now),
  ]);

  if (
    Number(results[0]?.meta.changes ?? 0) !== 1
    || Number(results[1]?.meta.changes ?? 0) !== 1
  ) {
    const again = await database.prepare(
      `SELECT u.status, u.activated_at, u.access_expires_at, a.id AS activation_id
       FROM users u
       LEFT JOIN activations a ON a.user_id = u.id
       WHERE u.id = ? LIMIT 1`,
    ).bind(client.id).first<{
      status: string;
      activated_at: string | null;
      access_expires_at: string | null;
      activation_id: string | null;
    }>();

    if (again?.activation_id) {
      return {
        ok: true,
        activated: false,
        reason: "already-activated",
        accessExpiresAt: again.access_expires_at,
        activatedAt: again.activated_at,
      };
    }
    if (again?.status === "active") {
      return {
        ok: true,
        activated: false,
        reason: "already-active",
        accessExpiresAt: again.access_expires_at,
        activatedAt: again.activated_at,
      };
    }
    return { ok: false, reason: "conflict" };
  }

  return {
    ok: true,
    activated: true,
    accessExpiresAt,
    activatedAt: now,
  };
}

export function isTelegramTrialSellerId(sellerId: string | null | undefined) {
  return sellerId === TELEGRAM_TRIAL_SELLER_ID;
}
