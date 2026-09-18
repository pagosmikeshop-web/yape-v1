import { assertTrustedMutation } from "../api-utils";
import type { AppRole, AuthUser, SessionRow, UserRow } from "./types";

export function createSessionService({
  database,
  ensureAuthSchema,
  getUserRoles,
  mapUser,
  sessionCookieName,
  sha256,
  randomToken,
  unlockIdleMinutes,
  sessionDays,
  maxSessionsPerUser,
  sessionCleanupLimit,
}: {
  database: () => D1Database;
  ensureAuthSchema: () => Promise<void>;
  getUserRoles: (userId: string) => Promise<AppRole[]>;
  mapUser: (row: UserRow) => AuthUser;
  sessionCookieName: (request: Request) => string;
  sha256: (value: string | Uint8Array) => Promise<string>;
  randomToken: (size?: number) => string;
  unlockIdleMinutes: () => number;
  sessionDays: number;
  maxSessionsPerUser: number;
  sessionCleanupLimit: number;
}) {
  function cookieValue(request: Request, name: string) {
    const cookie = request.headers.get("cookie") ?? "";
    for (const part of cookie.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === name) return decodeURIComponent(rest.join("="));
    }
    return null;
  }

  async function findSessionUser(request: Request, roles?: AppRole[], includeExpiredAccess = false) {
    await ensureAuthSchema();
    const token = cookieValue(request, sessionCookieName(request));
    if (!token) return null;
    const tokenHash = await sha256(token);
    const now = new Date().toISOString();
    const unlockIdleMs = unlockIdleMinutes() * 60_000;
    const unlockCutoff = new Date(Date.now() - unlockIdleMs).toISOString();
    const statement = database().prepare(
      `SELECT s.id AS session_id, s.token_hash, s.expires_at,
      s.last_seen_at, s.pin_verified_at, s.unlocked_until,
      u.id, u.seller_code, u.username, u.display_name, u.email, u.role, u.is_owner, u.owner_id,
     u.status, u.password_hash, u.password_salt, u.pin_hash, u.pin_salt, u.credits,
      u.device_id, u.device_public_key, u.fingerprint_id_hash, u.telegram_user_id,
      u.referral_code, u.referred_by_user_id, u.access_expires_at, u.referral_redemption_count,
      u.must_change_password, u.must_set_pin,
      u.deleted_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?
        AND u.status = 'active' AND u.deleted_at IS NULL
     LIMIT 1`,
    );
    const row = await statement.bind(tokenHash, now).first<SessionRow>();
    if (!row) return null;
    const unlocked = Boolean(
      row.unlocked_until
        && Date.parse(row.unlocked_until) > Date.now()
        && row.last_seen_at > unlockCutoff,
    );
    const shouldTouchSession = Date.parse(row.last_seen_at) <= Date.now() - 60_000;
    const refreshedUnlockUntil = unlocked
      ? (shouldTouchSession ? new Date(Date.now() + unlockIdleMs).toISOString() : row.unlocked_until)
      : null;
    const unlockChanged = row.unlocked_until !== refreshedUnlockUntil;
    const [userRoles] = await Promise.all([
      getUserRoles(row.id),
      shouldTouchSession || unlockChanged
        ? database().prepare(
          "UPDATE sessions SET last_seen_at = ?, unlocked_until = ? WHERE id = ?",
        ).bind(now, refreshedUnlockUntil, row.session_id).run()
        : Promise.resolve(),
    ]);
    row.roles = userRoles;
    const effectiveRoles = new Set<AppRole>([row.role, ...(row.roles ?? [])]);
    if (roles && !roles.some((role) => effectiveRoles.has(role))) return null;
    const hasStaffRole = effectiveRoles.has("admin") || effectiveRoles.has("seller");
    if (!includeExpiredAccess && !hasStaffRole && row.access_expires_at && Date.parse(row.access_expires_at) <= Date.now()) {
      return null;
    }
    return {
      user: {
        ...mapUser(row),
        unlocked,
      },
      row,
      sessionId: row.session_id,
      pinVerifiedAt: row.pin_verified_at,
      unlockedUntil: refreshedUnlockUntil,
    };
  }

  async function getSessionUser(request: Request, roles?: AppRole[]) {
    return findSessionUser(request, roles, false);
  }

  async function getSessionUserIncludingExpired(request: Request, roles?: AppRole[]) {
    return findSessionUser(request, roles, true);
  }

  async function requireSession(request: Request, roles?: AppRole[]) {
    assertTrustedMutation(request);
    const session = await getSessionUser(request, roles);
    if (!session) throw new Response(JSON.stringify({ error: "Acceso no autorizado." }), {
      status: 401,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/json; charset=utf-8",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
      },
    });
    return session;
  }

  async function requireSessionIncludingExpired(request: Request, roles?: AppRole[]) {
    assertTrustedMutation(request);
    const session = await getSessionUserIncludingExpired(request, roles);
    if (!session) throw new Response(JSON.stringify({ error: "Acceso no autorizado." }), {
      status: 401,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/json; charset=utf-8",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
      },
    });
    return session;
  }

  async function requireUnlockedSession(request: Request, roles?: AppRole[]) {
    const session = await requireSession(request, roles);
    if (session.user.mustChangePassword) {
      throw Response.json(
        { ok: false, error: "Debes cambiar tu contraseña antes de continuar.", code: "PASSWORD_CHANGE_REQUIRED" },
        { status: 428, headers: { "cache-control": "no-store" } },
      );
    }
    if (session.user.mustSetPin || !session.user.pinSet) {
      throw Response.json(
        { ok: false, error: "Configura tu clave antes de continuar.", code: "PIN_SETUP_REQUIRED" },
        { status: 428, headers: { "cache-control": "no-store" } },
      );
    }
    if (!session.unlockedUntil || Date.parse(session.unlockedUntil) <= Date.now()) {
      throw Response.json(
        { ok: false, error: "Confirma tu clave para continuar.", code: "PIN_REQUIRED" },
        { status: 423, headers: { "cache-control": "no-store" } },
      );
    }
    return session;
  }

  async function rotateAndUnlockSession(request: Request, sessionId: string) {
    const token = randomToken(36);
    const tokenHash = await sha256(token);
    const now = new Date();
    const unlockedUntil = new Date(now.getTime() + unlockIdleMinutes() * 60_000);
    const result = await database().prepare(
      `UPDATE sessions
     SET token_hash = ?, pin_verified_at = ?, unlocked_until = ?, last_seen_at = ?
     WHERE id = ? AND expires_at > ?`,
    ).bind(
      tokenHash,
      now.toISOString(),
      unlockedUntil.toISOString(),
      now.toISOString(),
      sessionId,
      now.toISOString(),
    ).run();
    const changes = Number(result.meta.changes ?? 0);
    if (changes !== 1) {
      throw Response.json(
        { ok: false, error: "La sesion ya no esta disponible." },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    const cookie = `${sessionCookieName(request)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionDays * 86_400}${secure}`;
    return { unlockedUntil: unlockedUntil.toISOString(), cookie };
  }

  async function createSession(request: Request, userId: string, options: { unlocked?: boolean } = {}) {
    await ensureAuthSchema();
    const token = randomToken(36);
    const tokenHash = await sha256(token);
    const now = new Date();
    const expires = new Date(now.getTime() + sessionDays * 86_400_000);
    const unlockedUntil = options.unlocked
      ? new Date(now.getTime() + unlockIdleMinutes() * 60_000).toISOString()
      : null;
    await database().batch([
      database().prepare(
        `INSERT INTO sessions (
        id, user_id, token_hash, created_at, expires_at, last_seen_at, pin_verified_at, unlocked_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        userId,
        tokenHash,
        now.toISOString(),
        expires.toISOString(),
        now.toISOString(),
        options.unlocked ? now.toISOString() : null,
        unlockedUntil,
      ),
      database().prepare(
        `DELETE FROM sessions
       WHERE user_id = ?
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND (role = 'client' OR EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client'
         )) AND deleted_at IS NULL)
         AND id IN (
         SELECT id FROM sessions WHERE user_id = ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?
       )`,
      ).bind(userId, userId, userId, sessionCleanupLimit, maxSessionsPerUser),
    ]);
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return `${sessionCookieName(request)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionDays * 86_400}${secure}`;
  }

  async function destroySession(request: Request) {
    assertTrustedMutation(request);
    const token = cookieValue(request, sessionCookieName(request));
    if (token) {
      await ensureAuthSchema();
      await database().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    }
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return `${sessionCookieName(request)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  }

  return {
    createSession,
    destroySession,
    getSessionUser,
    getSessionUserIncludingExpired,
    requireSession,
    requireSessionIncludingExpired,
    requireUnlockedSession,
    rotateAndUnlockSession,
  };
}
