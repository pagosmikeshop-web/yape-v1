import {
  AuthUser,
  bindDevice,
  dbBinding,
  findLoginUser,
  userHasRole,
  hashSecret,
  publicSha256,
  secretHashNeedsUpgrade,
  verifyDeviceProof,
  verifySecret,
} from "@/app/lib/auth-server";
import { requireManagedAccount } from "@/app/lib/management-server";
import { hasPermission, requirePermission } from "@/app/lib/rbac";
import { decryptIssuedToken, encryptIssuedToken } from "@/app/lib/token-vault";
import { randomTokenPart } from "./random-token";

export type AccessCredentialInput = {
  sellerId: string;
  username: string;
  password: string;
  deviceId: string;
  publicKey: JsonWebKey;
  proof: string;
  proofTimestamp: number;
};

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
  if (!user || !userHasRole(user, "client") || user.status !== "active") return null;
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
  // The primary role is kept for backwards compatibility, while additional
  // roles are stored in user_roles. Always derive the effective staff role so
  // a seller granted through that table is not treated as an owner override.
  const isSeller = userHasRole(actor, "seller") && !userHasRole(actor, "admin") && !actor.isOwner;
  const isAdmin = userHasRole(actor, "admin") && !actor.isOwner;
  if (isAdmin) {
    const managed = await requireManagedAccount(actor, clientId);
    if (managed.role !== "client") {
      throw Response.json({ ok: false, error: "Cliente no encontrado." }, { status: 404 });
    }
  }
  const client = await database.prepare(
    `SELECT id, owner_id, display_name, status, access_expires_at
     FROM users
     WHERE id = ? AND (role = 'client' OR EXISTS (
       SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client'
     )) AND deleted_at IS NULL LIMIT 1`,
  ).bind(clientId).first<{
    id: string;
    owner_id: string | null;
    display_name: string;
    status: string;
    access_expires_at: string | null;
  }>();

  if (!client || (isSeller && client.owner_id !== actor.id)) {
    throw Response.json({ ok: false, error: "Cliente no encontrado." }, { status: 404 });
  }
  if (client.status !== "active") {
    throw Response.json({ ok: false, error: "Primero activa la prueba gratuita del cliente." }, { status: 409 });
  }
  if (!client.access_expires_at) {
    throw Response.json({ ok: false, error: "Este cliente ya tiene acceso permanente." }, { status: 409 });
  }

  const sellerPays = isSeller;
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
          WHERE id = ? AND (role = 'seller' OR EXISTS (
            SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'seller'
          )) AND status = 'active' AND credits > 0`,
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

/**
 * Creates a single-use key that is intentionally not assigned to a client.
 * The first authenticated client account that redeems it becomes permanent.
 * Sellers spend one of their allocated credits when issuing these keys. The
 * first client redemption can then be linked to the issuing seller.
 */
export async function issueGlobalPermanentAccessToken(actor: AuthUser) {
  await requirePermission(actor, "keys:create");

  const raw = `YAPE${randomTokenPart(12)}`;
  const formattedToken = formatPermanentAccessToken(raw);
  const tokenHash = await permanentTokenHash(raw);
  const tokenCiphertext = encryptIssuedToken(formattedToken);
  const tokenId = crypto.randomUUID();
  const now = new Date().toISOString();
  const database = dbBinding();
  const sellerPays = userHasRole(actor, "seller") && !userHasRole(actor, "admin") && !actor.isOwner;
  if (sellerPays) {
    const ledgerId = crypto.randomUUID();
    const results = await database.batch([
      database.prepare(
        `INSERT INTO global_permanent_access_tokens (
           id, token_hash, token_hint, created_by, created_at, redeemed_at, redeemed_by_user_id, token_ciphertext
         ) SELECT ?, ?, ?, id, ?, NULL, NULL, ?
         FROM users
         WHERE id = ? AND (role = 'seller' OR EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'seller'
         )) AND status = 'active' AND credits > 0`,
      ).bind(tokenId, tokenHash, raw.slice(-4), now, tokenCiphertext, actor.id),
      database.prepare(
        `UPDATE users SET credits = credits - 1, updated_at = ?
         WHERE id = ? AND (role = 'seller' OR EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'seller'
         )) AND status = 'active' AND credits > 0
           AND EXISTS (
             SELECT 1 FROM global_permanent_access_tokens
             WHERE id = ? AND created_by = ?
           )`,
      ).bind(now, actor.id, tokenId, actor.id),
      database.prepare(
        `INSERT INTO credit_ledger (
           id, seller_id, delta, balance_after, reason, reference_id, created_by, created_at
         ) SELECT ?, id, -1, credits, 'global_permanent_access_token', ?, ?, ?
         FROM users WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM global_permanent_access_tokens
             WHERE id = ? AND created_by = ?
           )`,
      ).bind(ledgerId, tokenId, actor.id, now, actor.id, tokenId, actor.id),
    ]);
    if (
      Number(results[0]?.meta.changes ?? 0) !== 1
      || Number(results[1]?.meta.changes ?? 0) !== 1
      || Number(results[2]?.meta.changes ?? 0) !== 1
    ) {
      throw Response.json({ ok: false, error: "No tienes créditos disponibles para generar esta key." }, { status: 409 });
    }
  } else {
    const result = await database.prepare(
      `INSERT INTO global_permanent_access_tokens (
         id, token_hash, token_hint, created_by, created_at, redeemed_at, redeemed_by_user_id, token_ciphertext
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    ).bind(tokenId, tokenHash, raw.slice(-4), actor.id, now, tokenCiphertext).run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw Response.json({ ok: false, error: "No se pudo generar la key global." }, { status: 409 });
    }
  }

  const issuer = await database.prepare("SELECT credits FROM users WHERE id = ? LIMIT 1")
    .bind(actor.id).first<{ credits: number }>();
  await database.prepare(
    `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
     VALUES (?, ?, 'web_global_key_create', ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    actor.telegramUserId ?? actor.id,
    `${tokenId}:${actor.isOwner ? "owner" : sellerPays ? "seller" : actor.role}`,
    now,
  ).run();

  return {
    token: formattedToken,
    credits: Number(issuer?.credits ?? 0),
    chargedCredits: sellerPays ? 1 : 0,
    issuerRole: actor.isOwner ? "owner" : sellerPays ? "seller" : actor.role,
  };
}

export async function listGlobalPermanentAccessTokens(actor: AuthUser) {
  // Creating a key necessarily requires seeing the key workspace. This also
  // supports older seller sessions that carry `keys:create` but have not yet
  // refreshed the derived `keys:view` permission. Scope the query below to
  // the caller unless they explicitly have the all-keys permission.
  const canView = await hasPermission(actor, "keys:view") || await hasPermission(actor, "keys:create");
  if (!canView) await requirePermission(actor, "keys:view");
  const database = dbBinding();
  const select = `SELECT t.id, t.token_hint, t.token_ciphertext, t.created_at, t.redeemed_at,
                         issuer.display_name AS created_by_name,
                         redeemer.display_name AS redeemed_by_name,
                         CASE WHEN issuer.is_owner = 1 THEN 'owner' ELSE issuer.role END AS issuer_role
                  FROM global_permanent_access_tokens t
                  JOIN users issuer ON issuer.id = t.created_by
                  LEFT JOIN users redeemer ON redeemer.id = t.redeemed_by_user_id`;
  const canViewAll = actor.isOwner || await hasPermission(actor, "keys:view_all");
  const result = canViewAll
    ? await database.prepare(`${select} ORDER BY t.created_at DESC LIMIT 100`).all()
    : await database.prepare(
      `${select} WHERE t.created_by = ? ORDER BY t.created_at DESC LIMIT 100`,
    ).bind(actor.id).all();
  return (result.results ?? []).map((key) => ({
    ...key,
    token: decryptIssuedToken((key as { token_ciphertext?: string | null }).token_ciphertext),
  }));
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

  if (row) {
    if (row.user_id !== userId || row.redeemed_at) {
      throw Response.json({ ok: false, error: "El token no corresponde a esta cuenta o ya fue utilizado." }, { status: 403 });
    }
    if (!row.access_expires_at) {
      const now = new Date().toISOString();
      await database.prepare(
        `INSERT INTO client_crm_profiles
           (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
         VALUES (?, 'vip', 'individual', 'general', '[]', '', ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           crm_status = 'vip',
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      ).bind(userId, now, userId, now).run();
      return { alreadyPermanent: true };
    }

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
      database.prepare(
        `INSERT INTO client_crm_profiles
           (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
         VALUES (?, 'vip', 'individual', 'general', '[]', '', ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           crm_status = 'vip',
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      ).bind(userId, now, userId, now),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1 || Number(results[1]?.meta.changes ?? 0) !== 1) {
      throw Response.json({ ok: false, error: "El token ya fue utilizado." }, { status: 409 });
    }
    return { alreadyPermanent: false };
  }

  const global = await database.prepare(
    `SELECT t.id, t.redeemed_at, t.created_by,
            CASE
              WHEN issuer.is_owner = 1 THEN 'owner'
              WHEN issuer.role = 'seller' OR EXISTS (
                SELECT 1 FROM user_roles issuer_role_grant
                WHERE issuer_role_grant.user_id = issuer.id
                  AND issuer_role_grant.role = 'seller'
              ) THEN 'seller'
              ELSE issuer.role
            END AS issuer_role,
            issuer.seller_code AS issuer_seller_code
     FROM global_permanent_access_tokens t
     JOIN users issuer ON issuer.id = t.created_by
     WHERE t.token_hash = ? LIMIT 1`,
  ).bind(tokenHash).first<{
    id: string;
    redeemed_at: string | null;
    created_by: string;
    issuer_role: string;
    issuer_seller_code: string;
  }>();
  if (!global || global.redeemed_at) {
    throw Response.json({ ok: false, error: "El token no corresponde a esta cuenta o ya fue utilizado." }, { status: 403 });
  }

  const currentUser = await database.prepare(
    "SELECT access_expires_at FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1",
  ).bind(userId).first<{ access_expires_at: string | null }>();
  if (!currentUser) {
    throw Response.json({ ok: false, error: "No se pudo validar la cuenta." }, { status: 403 });
  }

  const now = new Date().toISOString();
  const globalResults = await database.batch([
    database.prepare(
      `UPDATE global_permanent_access_tokens
       SET redeemed_at = ?, redeemed_by_user_id = ?
       WHERE id = ? AND redeemed_at IS NULL`,
    ).bind(now, userId, global.id),
    database.prepare(
      `UPDATE users SET access_expires_at = NULL,
         owner_id = CASE WHEN owner_id IS NULL AND ? = 'seller' THEN ? ELSE owner_id END,
         seller_code = CASE WHEN owner_id IS NULL AND ? = 'seller' THEN ? ELSE seller_code END,
         updated_at = ?
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM global_permanent_access_tokens
         WHERE id = ? AND redeemed_by_user_id = ? AND redeemed_at = ?
       )`,
    ).bind(
      global.issuer_role,
      global.created_by,
      global.issuer_role,
      global.issuer_seller_code,
      now,
      userId,
      global.id,
      userId,
      now,
    ),
    database.prepare(
      `INSERT INTO client_crm_profiles
         (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
       SELECT ?, 'vip', 'individual', 'general', '[]', '', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM global_permanent_access_tokens
         WHERE id = ? AND redeemed_by_user_id = ? AND redeemed_at = ?
       )
       ON CONFLICT(user_id) DO UPDATE SET
         crm_status = 'vip',
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    ).bind(userId, now, userId, now, global.id, userId, now),
  ]);
  if (Number(globalResults[0]?.meta.changes ?? 0) !== 1 || Number(globalResults[1]?.meta.changes ?? 0) !== 1) {
    throw Response.json({ ok: false, error: "El token ya fue utilizado." }, { status: 409 });
  }
  return { alreadyPermanent: !currentUser.access_expires_at };
}
