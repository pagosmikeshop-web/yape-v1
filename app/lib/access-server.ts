import {
  AuthUser,
  bindDevice,
  dbBinding,
  findLoginUser,
  hashSecret,
  publicSha256,
  secretHashNeedsUpgrade,
  verifyDeviceProof,
  verifySecret,
} from "@/app/lib/auth-server";
import { requireManagedAccount } from "@/app/lib/management-server";
import { requirePermission } from "@/app/lib/rbac";

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type AccessCredentialInput = {
  sellerId: string;
  username: string;
  password: string;
  deviceId: string;
  publicKey: JsonWebKey;
  proof: string;
  proofTimestamp: number;
};

function randomTokenPart(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let value = "";
  for (const byte of bytes) value += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return value;
}

export function normalizePermanentAccessToken(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

function formatPermanentAccessToken(value: string) {
  return value.match(/.{1,4}/gu)?.join("-") ?? value;
}

async function permanentTokenHash(value: string) {
  return publicSha256(`permanent-access-v1\n${normalizePermanentAccessToken(value)}`);
}

export async function authenticateAccessCredentials(input: AccessCredentialInput) {
  if (!input.sellerId || !input.username || !input.password || !input.deviceId || !input.proof || !input.publicKey) return null;
  const validDevice = await verifyDeviceProof(input);
  if (!validDevice) return null;
  const user = await findLoginUser(input.sellerId, input.username);
  if (!user || user.role !== "client" || user.status !== "active") return null;
  const validPassword = await verifySecret(input.password, user.password_salt, user.password_hash);
  if (!validPassword) return null;
  if (secretHashNeedsUpgrade(user.password_hash)) {
    const upgraded = await hashSecret(input.password);
    await dbBinding().prepare(
      "UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?",
    ).bind(upgraded.hash, upgraded.salt, new Date().toISOString(), user.id).run();
  }
  const bound = await bindDevice(user, input.deviceId, input.publicKey);
  return bound ? user : null;
}

export async function issuePermanentAccessToken(actor: AuthUser, clientId: string) {
  await requirePermission(actor, "keys:create");
  const database = dbBinding();
  if (actor.role === "admin") {
    const managed = await requireManagedAccount(actor, clientId);
    if (managed.role !== "client") {
      throw Response.json({ ok: false, error: "Cliente no encontrado." }, { status: 404 });
    }
  }
  const client = await database.prepare(
    `SELECT id, owner_id, display_name, status, access_expires_at
     FROM users WHERE id = ? AND role = 'client' AND deleted_at IS NULL LIMIT 1`,
  ).bind(clientId).first<{
    id: string;
    owner_id: string | null;
    display_name: string;
    status: string;
    access_expires_at: string | null;
  }>();

  if (!client || (actor.role === "seller" && client.owner_id !== actor.id)) {
    throw Response.json({ ok: false, error: "Cliente no encontrado." }, { status: 404 });
  }
  if (client.status !== "active") {
    throw Response.json({ ok: false, error: "Primero activa la prueba gratuita del cliente." }, { status: 409 });
  }
  if (!client.access_expires_at) {
    throw Response.json({ ok: false, error: "Este cliente ya tiene acceso permanente." }, { status: 409 });
  }

  const sellerPays = actor.role === "seller";
  const raw = `YAPE${randomTokenPart(12)}`;
  const formattedToken = formatPermanentAccessToken(raw);
  const tokenHash = await permanentTokenHash(raw);
  const tokenId = crypto.randomUUID();
  const now = new Date().toISOString();

  if (sellerPays) {
    const ledgerId = crypto.randomUUID();
    const results = await database.batch([
      database.prepare(
        `INSERT INTO permanent_access_tokens (
          id, token_hash, token_hint, seller_id, user_id, created_by, created_at, redeemed_at
        ) SELECT ?, ?, ?, id, ?, ?, ?, NULL
          FROM users
          WHERE id = ? AND role = 'seller' AND status = 'active' AND credits > 0`,
      ).bind(tokenId, tokenHash, raw.slice(-4), client.id, actor.id, now, actor.id),
      database.prepare(
        `UPDATE users SET credits = credits - 1, updated_at = ?
         WHERE id = ? AND credits > 0
           AND EXISTS (SELECT 1 FROM permanent_access_tokens WHERE id = ?)`,
      ).bind(now, actor.id, tokenId),
      database.prepare(
        `INSERT INTO credit_ledger (
          id, seller_id, delta, balance_after, reason, reference_id, created_by, created_at
        ) SELECT ?, id, -1, credits, 'permanent_access_token', ?, ?, ?
          FROM users WHERE id = ?
            AND EXISTS (SELECT 1 FROM permanent_access_tokens WHERE id = ?)`,
      ).bind(ledgerId, tokenId, actor.id, now, actor.id, tokenId),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1 || Number(results[1]?.meta.changes ?? 0) !== 1) {
      throw Response.json({ ok: false, error: "No tienes créditos disponibles para generar esta key." }, { status: 409 });
    }
  } else {
    const result = await database.prepare(
      `INSERT INTO permanent_access_tokens (
        id, token_hash, token_hint, seller_id, user_id, created_by, created_at, redeemed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(tokenId, tokenHash, raw.slice(-4), actor.id, client.id, actor.id, now).run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw Response.json({ ok: false, error: "No se pudo generar la key." }, { status: 409 });
    }
  }

  const issuer = await database.prepare("SELECT credits FROM users WHERE id = ? LIMIT 1")
    .bind(actor.id).first<{ credits: number }>();
  await database.prepare(
    `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
     VALUES (?, ?, 'web_key_create', ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    actor.telegramUserId ?? actor.id,
    `${client.id}:${tokenId}:${sellerPays ? "seller-credit" : "staff-override"}`,
    now,
  ).run();
  return {
    token: formattedToken,
    clientName: client.display_name,
    credits: Number(issuer?.credits ?? 0),
    chargedCredits: sellerPays ? 1 : 0,
    issuerRole: actor.isOwner ? "owner" : actor.role,
  };
}

export async function redeemPermanentAccessToken(userId: string, token: string) {
  const normalized = normalizePermanentAccessToken(token);
  if (!/^YAPE[A-Z0-9]{12}$/u.test(normalized)) {
    throw Response.json({ ok: false, error: "El token permanente no es válido." }, { status: 400 });
  }
  const database = dbBinding();
  const tokenHash = await permanentTokenHash(normalized);
  const row = await database.prepare(
    `SELECT t.id, t.user_id, t.redeemed_at, u.access_expires_at
     FROM permanent_access_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? LIMIT 1`,
  ).bind(tokenHash).first<{
    id: string;
    user_id: string;
    redeemed_at: string | null;
    access_expires_at: string | null;
  }>();

  if (!row || row.user_id !== userId || row.redeemed_at) {
    throw Response.json({ ok: false, error: "El token no corresponde a esta cuenta o ya fue utilizado." }, { status: 403 });
  }
  if (!row.access_expires_at) return { alreadyPermanent: true };

  const now = new Date().toISOString();
  const results = await database.batch([
    database.prepare(
      "UPDATE permanent_access_tokens SET redeemed_at = ? WHERE id = ? AND user_id = ? AND redeemed_at IS NULL",
    ).bind(now, row.id, userId),
    database.prepare(
      `UPDATE users SET access_expires_at = NULL, updated_at = ?
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM permanent_access_tokens WHERE id = ? AND user_id = ? AND redeemed_at = ?
       )`,
    ).bind(now, userId, row.id, userId, now),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1 || Number(results[1]?.meta.changes ?? 0) !== 1) {
    throw Response.json({ ok: false, error: "El token ya fue utilizado." }, { status: 409 });
  }
  return { alreadyPermanent: false };
}
