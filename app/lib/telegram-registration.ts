import {
  dbBinding,
  ensureAuthSchema,
  publicSha256,
} from "@/app/lib/auth-server";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const CODE_PATTERN = /^[A-Za-z0-9_-]{32,96}$/u;

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

async function codeHash(code: string) {
  return publicSha256(`telegram-registration\n${code}`);
}

export async function createTelegramRegistrationChallenge(
  telegramUserId: string,
  fingerprintHash: string,
) {
  await ensureAuthSchema();
  const code = randomCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
  const database = dbBinding();
  await database.batch([
    database.prepare(
      `DELETE FROM telegram_registration_challenges
       WHERE expires_at <= ? OR (
         telegram_user_id = ? AND fingerprint_hash = ? AND consumed_at IS NULL
       )`,
    ).bind(now.toISOString(), telegramUserId, fingerprintHash),
    database.prepare(
      `INSERT INTO telegram_registration_challenges (
        id, code_hash, telegram_user_id, fingerprint_hash,
        created_at, expires_at, verified_at, consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).bind(
      crypto.randomUUID(),
      await codeHash(code),
      telegramUserId,
      fingerprintHash,
      now.toISOString(),
      expiresAt,
    ),
  ]);
  return { code, expiresAt, command: `/verify ${code}` };
}

export async function verifyTelegramRegistrationChallenge(
  telegramUserId: string,
  code: string,
) {
  if (!CODE_PATTERN.test(code)) return false;
  await ensureAuthSchema();
  const result = await dbBinding().prepare(
    `UPDATE telegram_registration_challenges
     SET verified_at = COALESCE(verified_at, ?)
     WHERE code_hash = ?
       AND telegram_user_id = ?
       AND expires_at > ?
       AND consumed_at IS NULL`,
  ).bind(
    new Date().toISOString(),
    await codeHash(code),
    telegramUserId,
    new Date().toISOString(),
  ).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function telegramRegistrationChallengeIsVerified(input: {
  telegramUserId: string;
  fingerprintHash: string;
  code: string;
}) {
  if (!CODE_PATTERN.test(input.code)) return false;
  await ensureAuthSchema();
  const row = await dbBinding().prepare(
    `SELECT 1 AS valid
     FROM telegram_registration_challenges
     WHERE code_hash = ?
       AND telegram_user_id = ?
       AND fingerprint_hash = ?
       AND verified_at IS NOT NULL
       AND consumed_at IS NULL
       AND expires_at > ?
     LIMIT 1`,
  ).bind(
    await codeHash(input.code),
    input.telegramUserId,
    input.fingerprintHash,
    new Date().toISOString(),
  ).first<{ valid: number }>();
  return Boolean(row?.valid);
}

export async function consumeTelegramRegistrationChallenge(input: {
  telegramUserId: string;
  fingerprintHash: string;
  code: string;
}) {
  if (!CODE_PATTERN.test(input.code)) return false;
  await ensureAuthSchema();
  const now = new Date().toISOString();
  const result = await dbBinding().prepare(
    `UPDATE telegram_registration_challenges
     SET consumed_at = ?
     WHERE code_hash = ?
       AND telegram_user_id = ?
       AND fingerprint_hash = ?
       AND verified_at IS NOT NULL
       AND consumed_at IS NULL
       AND expires_at > ?`,
  ).bind(
    now,
    await codeHash(input.code),
    input.telegramUserId,
    input.fingerprintHash,
    now,
  ).run();
  return Number(result.meta.changes ?? 0) === 1;
}
