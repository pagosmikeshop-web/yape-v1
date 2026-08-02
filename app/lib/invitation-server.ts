import {
  dbBinding,
  ensureAuthSchema,
  hashSecret,
  validatePassword,
} from "@/app/lib/auth-server";
import { bytesToBase64Url } from "@/app/lib/base64url";

const INVITATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type AccountInvitation = {
  id: string;
  token: string;
  expiresAt: string;
  activationPath: string;
};

function generateInvitationToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

async function sha256(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded.buffer);
  return bytesToBase64Url(new Uint8Array(digest));
}

/**
 * Creates a one-time account invitation.
 *
 * The raw token is returned exactly once and is never stored. Issuing a new
 * invitation invalidates every unused invitation previously issued to the user.
 */
export async function createInvitation(userId: string): Promise<AccountInvitation> {
  await ensureAuthSchema();
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("A user is required to create an invitation.");

  const token = generateInvitationToken();
  const tokenHash = await sha256(token);
  const id = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS).toISOString();

  await dbBinding().batch([
    dbBinding().prepare(
      `UPDATE account_invitations
       SET used_at = ?, consumed_by = 'superseded'
       WHERE user_id = ? AND used_at IS NULL`,
    ).bind(createdAt, normalizedUserId),
    dbBinding().prepare(
      `INSERT INTO account_invitations (
        id, user_id, token_hash, created_at, expires_at, used_at, consumed_by
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
    ).bind(id, normalizedUserId, tokenHash, createdAt, expiresAt),
  ]);

  return {
    id,
    token,
    expiresAt,
    activationPath: `/activar-cuenta#token=${encodeURIComponent(token)}`,
  };
}

/**
 * Consumes an invitation and sets the password selected by its recipient.
 *
 * D1 executes batch statements atomically. The random consume marker makes all
 * subsequent statements no-ops unless the first statement consumed this exact,
 * unexpired token. No session is created by this operation.
 */
export async function redeemInvitation(token: string, newPassword: string) {
  await ensureAuthSchema();
  const normalizedToken = token.trim();
  if (!TOKEN_PATTERN.test(normalizedToken) || !validatePassword(newPassword)) return false;

  const [tokenHash, password] = await Promise.all([
    sha256(normalizedToken),
    hashSecret(newPassword),
  ]);
  const now = new Date().toISOString();
  const consumeMarker = crypto.randomUUID();
  const database = dbBinding();

  const results = await database.batch([
    database.prepare(
      `UPDATE account_invitations
       SET used_at = ?, consumed_by = ?
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
    ).bind(now, consumeMarker, tokenHash, now),
    database.prepare(
      `UPDATE users
       SET password_hash = ?, password_salt = ?, must_change_password = 0,
           pin_hash = NULL, pin_salt = NULL, must_set_pin = 1,
           device_id = NULL, device_public_key = NULL, updated_at = ?
       WHERE id = (
         SELECT user_id
         FROM account_invitations
         WHERE token_hash = ? AND consumed_by = ?
         LIMIT 1
       )`,
    ).bind(password.hash, password.salt, now, tokenHash, consumeMarker),
    database.prepare(
      `DELETE FROM sessions
       WHERE user_id = (
         SELECT user_id
         FROM account_invitations
         WHERE token_hash = ? AND consumed_by = ?
         LIMIT 1
       )`,
    ).bind(tokenHash, consumeMarker),
  ]);

  return Number(results[0]?.meta.changes ?? 0) === 1
    && Number(results[1]?.meta.changes ?? 0) === 1;
}
