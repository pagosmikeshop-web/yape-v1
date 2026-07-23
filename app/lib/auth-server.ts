import { assertTrustedMutation } from "@/app/lib/api-utils";
import { databaseForEnvironment } from "@/app/lib/database-server";

export type AppRole = "admin" | "seller" | "client";

type AuthEnv = {
  DB?: D1Database;
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  APP_ENV?: string;
  ADMIN_WEB_URL?: string;
  ADMIN_PROXY_SECRET?: string;
  PUBLIC_APP_URL?: string;
  AUTH_BOOTSTRAP_ENABLED?: string;
  AUTH_BOOTSTRAP_SECRET?: string;
  AUTH_OWNER_TELEGRAM_ID?: string;
  AUTH_RATE_LIMIT_PEPPER?: string;
  AUTH_SESSION_IDLE_MINUTES?: string;
  ACCOUNT_SMS_VALIDATION_TOKEN?: string;
  ACCOUNT_AUTO_VALIDATION_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ADMIN_IDS?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_SUPPORT_USERNAME?: string;
  TELEGRAM_SUPPORT_USER_ID?: string;
  TELEGRAM_REQUIRED_GROUP_ID?: string;
  TELEGRAM_GROUP_INVITE_URL?: string;
};

export type AuthUser = {
  id: string;
  sellerCode: string;
  username: string;
  displayName: string;
  email: string;
  role: AppRole;
  isOwner: boolean;
  ownerId: string | null;
  status: "pending" | "active" | "disabled";
  credits: number;
  deviceId: string | null;
  telegramUserId: string | null;
  referralCode: string | null;
  accessExpiresAt: string | null;
  mustChangePassword: boolean;
  mustSetPin: boolean;
  pinSet: boolean;
  unlocked: boolean;
};

type UserRow = {
  id: string;
  seller_code: string;
  username: string;
  display_name: string;
  email: string;
  role: AppRole;
  is_owner: number;
  owner_id: string | null;
  status: "pending" | "active" | "disabled";
  password_hash: string;
  password_salt: string;
  pin_hash: string | null;
  pin_salt: string | null;
  credits: number;
  device_id: string | null;
  device_public_key: string | null;
  fingerprint_id_hash: string | null;
  telegram_user_id: string | null;
  referral_code: string | null;
  referred_by_user_id: string | null;
  access_expires_at: string | null;
  must_change_password: number;
  must_set_pin: number;
  deleted_at: string | null;
};

type SessionRow = {
  session_id: string;
  token_hash: string;
  expires_at: string;
  last_seen_at: string;
  pin_verified_at: string | null;
  unlocked_until: string | null;
} & UserRow;

export type AuthRateLimitRule = {
  bucket: string;
  subject: string;
  limit: number;
  windowSeconds: number;
};

export type PasswordResetChallenge = {
  requestId: string;
  token: string;
  expiresAt: string;
};

const LOCAL_SESSION_COOKIE = "yape_session";
const SECURE_SESSION_COOKIE = "__Host-yape_session";
const LEGACY_PBKDF2_ITERATIONS = 120_000;
const CURRENT_PBKDF2_ITERATIONS = 600_000;
const HASH_FORMAT = "pbkdf2-sha256";
const SESSION_DAYS = 30;
const DEFAULT_SESSION_IDLE_MINUTES = 12 * 60;
const MAX_SESSIONS_PER_USER = 5;
const PIN_UNLOCK_MINUTES = 10;
const PASSWORD_RESET_MINUTES = 15;
export const SELF_REGISTRATION_SELLER_CODE = "YAPE";
export const TRIAL_DAYS = 3;
export const REFERRAL_EXTENSION_DAYS = 3;
export const REFERRAL_MONTHLY_LIMIT = 4;
const MIN_RATE_LIMIT_PEPPER_LENGTH = 32;
const DEVICE_PROOF_WINDOW_MS = 5 * 60 * 1000;
let schemaReady: Promise<void> | null = null;

function database() {
  const env = authEnv();
  return databaseForEnvironment(env);
}

export function authEnv() {
  const globals = globalThis as typeof globalThis & {
    __YAPE_ENV?: AuthEnv;
    __MI_BANCO_ENV?: AuthEnv;
    process?: { env?: Record<string, string | undefined> };
  };
  return globals.__YAPE_ENV ?? globals.__MI_BANCO_ENV ?? (globals.process?.env as AuthEnv | undefined) ?? {};
}

function isHostedEnvironment() {
  const environment = authEnv().APP_ENV?.trim().toLowerCase();
  return environment === "staging" || environment === "production";
}

export function configuredOwnerTelegramId() {
  const env = authEnv();
  const explicitOwnerId = env.AUTH_OWNER_TELEGRAM_ID?.trim() ?? "";
  const ownerId = explicitOwnerId
    || (!isHostedEnvironment() ? env.TELEGRAM_ADMIN_IDS?.split(",", 1)[0]?.trim() : "")
    || "";
  return /^\d{4,24}$/u.test(ownerId) ? ownerId : "";
}

export function bootstrapIsEnabled() {
  const configured = authEnv().AUTH_BOOTSTRAP_ENABLED?.trim().toLowerCase();
  if (isHostedEnvironment()) return configured === "true";
  return configured !== "false";
}

export function publicAppBaseUrl(request: Request) {
  const configured = authEnv().PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || isLocalUrl(url)) return url.origin;
    } catch {
      // La respuesta genérica se genera debajo.
    }
    throw Response.json(
      { ok: false, error: "La URL pública de la aplicación no está configurada correctamente." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const requestUrl = new URL(request.url);
  if (!isHostedEnvironment() && isLocalUrl(requestUrl)) return requestUrl.origin;
  throw Response.json(
    { ok: false, error: "La URL pública de la aplicación no está disponible." },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

function isLocalUrl(url: URL) {
  return url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
}

function sessionIdleMinutes() {
  const configured = authEnv().AUTH_SESSION_IDLE_MINUTES?.trim();
  if (!configured) return DEFAULT_SESSION_IDLE_MINUTES;
  const minutes = Number(configured);
  if (!Number.isSafeInteger(minutes) || minutes < 5 || minutes > 7 * 24 * 60) {
    throw new Error("Invalid AUTH_SESSION_IDLE_MINUTES configuration.");
  }
  return minutes;
}

function sessionCookieName(request: Request) {
  return new URL(request.url).protocol === "https:" ? SECURE_SESSION_COOKIE : LOCAL_SESSION_COOKIE;
}

export function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase("es-PE");
}

export function normalizeSellerCode(value: string) {
  return value.trim().toUpperCase();
}

export function normalizePeruvianMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  const localNumber = digits.startsWith("51") && digits.length === 11 ? digits.slice(2) : digits;
  if (!/^9\d{8}$/u.test(localNumber)) return "";
  return `+51${localNumber}`;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string | Uint8Array) {
  const source = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", source.buffer)));
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function randomToken(size = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function publicSha256(value: string) {
  return sha256(value);
}

function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function secureCompare(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  return constantTimeEqual(leftHash, rightHash);
}

function rateLimitPepper() {
  const pepper = authEnv().AUTH_RATE_LIMIT_PEPPER?.trim() ?? "";
  if (pepper.length < MIN_RATE_LIMIT_PEPPER_LENGTH) {
    throw Response.json(
      { ok: false, error: "El servicio de autenticacion no esta disponible." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return pepper;
}

export function accountRateLimitSubject(sellerCode: string, username: string) {
  return `${normalizeSellerCode(sellerCode)}\n${normalizeUsername(username)}`.slice(0, 160);
}

async function verifiedAdminProxyIp(request: Request) {
  const secret = authEnv().ADMIN_PROXY_SECRET?.trim() ?? "";
  if (secret.length < 32) return "";
  const clientIp = request.headers.get("x-yape-admin-client-ip")?.trim() ?? "";
  const timestamp = request.headers.get("x-yape-admin-proxy-timestamp")?.trim() ?? "";
  const signature = request.headers.get("x-yape-admin-proxy-signature")?.trim() ?? "";
  if (
    !/^[0-9A-Fa-f:.]{3,64}$/u.test(clientIp)
    || !/^\d{10,13}$/u.test(timestamp)
    || !/^[A-Za-z0-9_-]{40,64}$/u.test(signature)
    || Math.abs(Date.now() - Number(timestamp)) > 2 * 60_000
  ) {
    return "";
  }
  const payload = [
    "yape-admin-proxy-v1",
    timestamp,
    request.method.toUpperCase(),
    new URL(request.url).pathname,
    clientIp,
  ].join("\n");
  const expected = await hmacSha256(secret, payload);
  return constantTimeEqual(expected, signature) ? clientIp : "";
}

export async function requestIpRateLimitSubject(request: Request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp.slice(0, 128);
  const adminProxyIp = await verifiedAdminProxyIp(request);
  if (adminProxyIp) return adminProxyIp;
  const vercelIp = request.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim();
  if (vercelIp) return vercelIp.slice(0, 128);
  if (isHostedEnvironment()) return "unavailable";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return (
    request.headers.get("x-real-ip")?.trim()
    || forwarded
    || "unknown"
  ).slice(0, 128);
}

export async function authRateLimitSubjectHash(bucket: string, subject: string) {
  return hmacSha256(rateLimitPepper(), `mi-banco-auth-rate-v1\n${bucket}\n${subject}`);
}

export async function enforceAuthRateLimits(rules: AuthRateLimitRule[]) {
  await ensureAuthSchema();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const now = new Date(nowSeconds * 1000).toISOString();

  for (const rule of rules) {
    if (!/^[a-z0-9:_-]{3,64}$/u.test(rule.bucket) || rule.limit < 1 || rule.windowSeconds < 1) {
      throw new Error("Invalid authentication rate-limit policy.");
    }
    const subjectHash = await authRateLimitSubjectHash(rule.bucket, rule.subject);
    const cutoff = nowSeconds - rule.windowSeconds;
    const state = await database().prepare(
      `INSERT INTO auth_rate_limits (
        bucket, subject_hash, window_started_at, attempt_count, updated_at
      ) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(bucket, subject_hash) DO UPDATE SET
        window_started_at = CASE
          WHEN auth_rate_limits.window_started_at <= ? THEN excluded.window_started_at
          ELSE auth_rate_limits.window_started_at
        END,
        attempt_count = CASE
          WHEN auth_rate_limits.window_started_at <= ? THEN 1
          ELSE auth_rate_limits.attempt_count + 1
        END,
        updated_at = excluded.updated_at
      RETURNING window_started_at, attempt_count`,
    ).bind(rule.bucket, subjectHash, nowSeconds, now, cutoff, cutoff).first<{
      window_started_at: number;
      attempt_count: number;
    }>();
    const attempts = Number(state?.attempt_count ?? rule.limit + 1);
    if (attempts > rule.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Number(state?.window_started_at ?? nowSeconds) + rule.windowSeconds - nowSeconds,
      );
      throw Response.json(
        {
          ok: false,
          error: "Demasiados intentos. Espera antes de volver a intentarlo.",
          code: "RATE_LIMITED",
          retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "cache-control": "no-store",
            "retry-after": String(retryAfterSeconds),
          },
        },
      );
    }
  }
}

export async function clearAuthRateLimit(bucket: string, subject: string) {
  await ensureAuthSchema();
  const subjectHash = await authRateLimitSubjectHash(bucket, subject);
  await database().prepare(
    "DELETE FROM auth_rate_limits WHERE bucket = ? AND subject_hash = ?",
  ).bind(bucket, subjectHash).run();
}

async function deriveSecret(secret: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64UrlToBytes(salt), iterations },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function parseStoredSecretHash(value: string) {
  const match = /^pbkdf2-sha256\$(\d{5,7})\$([A-Za-z0-9_-]{32,64})$/u.exec(value);
  if (!match) {
    return { iterations: LEGACY_PBKDF2_ITERATIONS, digest: value, versioned: false };
  }
  const iterations = Number(match[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) {
    return null;
  }
  return { iterations, digest: match[2], versioned: true };
}

export async function hashSecret(secret: string, salt = randomToken(16)) {
  const digest = await deriveSecret(secret, salt, CURRENT_PBKDF2_ITERATIONS);
  return { salt, hash: `${HASH_FORMAT}$${CURRENT_PBKDF2_ITERATIONS}$${digest}` };
}

export async function verifySecret(secret: string, salt: string, expected: string) {
  const stored = parseStoredSecretHash(expected);
  if (!stored) return false;
  const actual = await deriveSecret(secret, salt, stored.iterations);
  return constantTimeEqual(actual, stored.digest);
}

export function secretHashNeedsUpgrade(expected: string) {
  const stored = parseStoredSecretHash(expected);
  return Boolean(!stored || !stored.versioned || stored.iterations < CURRENT_PBKDF2_ITERATIONS);
}

export async function ensureAuthSchema() {
  if (schemaReady) return schemaReady;
  const db = database();
  schemaReady = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        seller_code TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL CHECK (role IN ('admin','seller','client')),
        is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
        owner_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        pin_hash TEXT,
        pin_salt TEXT,
        credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
        device_id TEXT,
        device_public_key TEXT,
        fingerprint_id_hash TEXT,
        telegram_user_id TEXT,
        referral_code TEXT,
        referred_by_user_id TEXT,
        access_expires_at TEXT,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        must_set_pin INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        activated_at TEXT,
        deleted_at TEXT,
        FOREIGN KEY (owner_id) REFERENCES users(id)
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS users_login_unique ON users(seller_code, username)",
      "CREATE UNIQUE INDEX IF NOT EXISTS users_device_unique ON users(device_id) WHERE device_id IS NOT NULL",
      `CREATE TABLE IF NOT EXISTS payment_directory (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        phone_e164 TEXT NOT NULL UNIQUE,
        discoverable INTEGER NOT NULL DEFAULT 1,
        verified_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS payment_directory_user_unique ON payment_directory(user_id)",
      "CREATE UNIQUE INDEX IF NOT EXISTS payment_directory_phone_unique ON payment_directory(phone_e164)",
      `CREATE TABLE IF NOT EXISTS recipient_lookup_attempts (
        id TEXT PRIMARY KEY,
        requester_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS recipient_lookup_requester_idx ON recipient_lookup_attempts(requester_user_id, created_at)",
      `CREATE TABLE IF NOT EXISTS saved_payment_recipients (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        phone_e164 TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT 'Número nuevo',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS saved_payment_recipients_user_phone_unique ON saved_payment_recipients(user_id, phone_e164)",
      "CREATE INDEX IF NOT EXISTS saved_payment_recipients_user_updated_idx ON saved_payment_recipients(user_id, updated_at)",
      `CREATE TABLE IF NOT EXISTS account_balances (
        user_id TEXT PRIMARY KEY,
        balance_cents INTEGER NOT NULL DEFAULT 3913 CHECK (balance_cents >= 0 AND balance_cents <= 99999999999),
        is_configured INTEGER NOT NULL DEFAULT 0 CHECK (is_configured IN (0, 1)),
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS account_movements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        recipient_name TEXT NOT NULL,
        recipient_reference TEXT NOT NULL,
        recipient_user_id TEXT,
        saved_recipient_id TEXT,
        destination TEXT NOT NULL DEFAULT 'Yape',
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        message TEXT NOT NULL DEFAULT '',
        security_code TEXT NOT NULL,
        operation_number TEXT NOT NULL UNIQUE,
        idempotency_key TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (saved_recipient_id) REFERENCES saved_payment_recipients(id) ON DELETE SET NULL
      )`,
      "CREATE INDEX IF NOT EXISTS account_movements_user_created_idx ON account_movements(user_id, created_at)",
      `CREATE TABLE IF NOT EXISTS account_history_state (
        user_id TEXT PRIMARY KEY,
        cleared_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        pin_verified_at TEXT,
        unlocked_until TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)",
      "CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)",
      `CREATE TABLE IF NOT EXISTS auth_rate_limits (
        bucket TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        window_started_at INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (bucket, subject_hash)
      )`,
      "CREATE INDEX IF NOT EXISTS auth_rate_limits_updated_idx ON auth_rate_limits(updated_at)",
      `CREATE TABLE IF NOT EXISTS credit_ledger (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        delta INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        reason TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (seller_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id),
        UNIQUE(reason, reference_id)
      )`,
      `CREATE TABLE IF NOT EXISTS activations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        seller_id TEXT NOT NULL,
        credits_charged INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (seller_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS permanent_access_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        token_hint TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        redeemed_at TEXT,
        FOREIGN KEY (seller_id) REFERENCES users(id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,
      "CREATE INDEX IF NOT EXISTS permanent_access_tokens_seller_idx ON permanent_access_tokens(seller_id, created_at)",
      "CREATE INDEX IF NOT EXISTS permanent_access_tokens_user_idx ON permanent_access_tokens(user_id, created_at)",
      `CREATE TABLE IF NOT EXISTS password_reset_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','cancelled')),
        price_credits INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        approved_by TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (seller_id) REFERENCES users(id),
        FOREIGN KEY (approved_by) REFERENCES users(id)
      )`,
      "CREATE INDEX IF NOT EXISTS password_reset_seller_idx ON password_reset_requests(seller_id, status)",
      `CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        subject_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        consumed_by TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens(user_id, created_at)",
      "CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens(expires_at)",
      `CREATE TABLE IF NOT EXISTS account_invitations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        consumed_by TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS account_invitations_user_idx ON account_invitations(user_id, created_at)",
      "CREATE INDEX IF NOT EXISTS account_invitations_expiry_idx ON account_invitations(expires_at)",
      `CREATE TABLE IF NOT EXISTS telegram_identities (
        telegram_user_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS telegram_identity_user_idx ON telegram_identities(user_id)",
      `CREATE TABLE IF NOT EXISTS telegram_updates (
        update_id TEXT PRIMARY KEY,
        received_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS telegram_group_members (
        telegram_user_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        username TEXT,
        display_name TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS telegram_group_members_chat_idx ON telegram_group_members(chat_id, last_seen_at)",
      `CREATE TABLE IF NOT EXISTS referral_redemptions (
        id TEXT PRIMARY KEY,
        referrer_user_id TEXT NOT NULL,
        redeemer_telegram_user_id TEXT NOT NULL,
        redeemed_by_user_id TEXT,
        month_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (redeemed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS referral_redemptions_unique ON referral_redemptions(referrer_user_id, redeemer_telegram_user_id, month_key)",
      "CREATE INDEX IF NOT EXISTS referral_redemptions_referrer_month_idx ON referral_redemptions(referrer_user_id, month_key)",
      `CREATE TABLE IF NOT EXISTS manager_audit_log (
        id TEXT PRIMARY KEY,
        telegram_user_id TEXT NOT NULL,
        command TEXT NOT NULL,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ];
    await db.batch(statements.map((sql) => db.prepare(sql)));

    const balanceColumns = await db.prepare("PRAGMA table_info(account_balances)").all<{ name: string }>();
    const knownBalanceColumns = new Set((balanceColumns.results ?? []).map((column) => column.name));
    if (!knownBalanceColumns.has("is_configured")) {
      try {
        await db.prepare("ALTER TABLE account_balances ADD COLUMN is_configured INTEGER NOT NULL DEFAULT 0 CHECK (is_configured IN (0, 1))").run();
      } catch (error) {
        if (!/duplicate column name/iu.test(error instanceof Error ? error.message : "")) throw error;
      }
    }

    const movementColumns = await db.prepare("PRAGMA table_info(account_movements)").all<{ name: string }>();
    const knownMovementColumns = new Set((movementColumns.results ?? []).map((column) => column.name));
    for (const [column, definition] of [
      ["recipient_user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL"],
      ["saved_recipient_id", "TEXT REFERENCES saved_payment_recipients(id) ON DELETE SET NULL"],
      ["idempotency_key", "TEXT"],
    ] as const) {
      if (knownMovementColumns.has(column)) continue;
      try {
        await db.prepare(`ALTER TABLE account_movements ADD COLUMN ${column} ${definition}`).run();
      } catch (error) {
        if (!/duplicate column name/iu.test(error instanceof Error ? error.message : "")) throw error;
      }
    }
    await db.batch([
      db.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS account_movements_user_idempotency_unique ON account_movements(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
      ),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS account_movements_recipient_user_idx ON account_movements(recipient_user_id)",
      ),
    ]);

    await db.prepare(
      `CREATE TRIGGER IF NOT EXISTS account_movements_deduct_balance
       BEFORE INSERT ON account_movements
       FOR EACH ROW
       BEGIN
         UPDATE account_balances
         SET balance_cents = balance_cents - NEW.amount_cents,
             updated_at = NEW.created_at
         WHERE user_id = NEW.user_id
           AND is_configured = 1
           AND balance_cents >= NEW.amount_cents;
         SELECT CASE WHEN changes() = 0 THEN RAISE(ABORT, 'INSUFFICIENT_BALANCE') END;
       END`,
    ).run();

    const sessionColumns = await db.prepare("PRAGMA table_info(sessions)").all<{ name: string }>();
    const knownSessionColumns = new Set((sessionColumns.results ?? []).map((column) => column.name));
    for (const [column, definition] of [
      ["pin_verified_at", "TEXT"],
      ["unlocked_until", "TEXT"],
    ] as const) {
      if (knownSessionColumns.has(column)) continue;
      try {
        await db.prepare(`ALTER TABLE sessions ADD COLUMN ${column} ${definition}`).run();
      } catch (error) {
        if (!/duplicate column name/iu.test(error instanceof Error ? error.message : "")) throw error;
      }
    }
    const userColumns = await db.prepare("PRAGMA table_info(users)").all<{ name: string }>();
    const knownUserColumns = new Set((userColumns.results ?? []).map((column) => column.name));
    for (const [column, definition] of [
      ["fingerprint_id_hash", "TEXT"],
      ["telegram_user_id", "TEXT"],
      ["referral_code", "TEXT"],
      ["referred_by_user_id", "TEXT"],
      ["access_expires_at", "TEXT"],
      ["is_owner", "INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1))"],
      ["deleted_at", "TEXT"],
    ] as const) {
      if (knownUserColumns.has(column)) continue;
      try {
        await db.prepare(`ALTER TABLE users ADD COLUMN ${column} ${definition}`).run();
      } catch (error) {
        if (!/duplicate column name/iu.test(error instanceof Error ? error.message : "")) throw error;
      }
    }
    const postMigrationStatements = [
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_fingerprint_unique ON users(fingerprint_id_hash) WHERE fingerprint_id_hash IS NOT NULL"),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_user_unique ON users(telegram_user_id) WHERE telegram_user_id IS NOT NULL"),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_unique ON users(referral_code) WHERE referral_code IS NOT NULL"),
      db.prepare("CREATE INDEX IF NOT EXISTS users_owner_role_idx ON users(owner_id, role, deleted_at)"),
    ];
    const ownerTelegramId = configuredOwnerTelegramId();
    if (ownerTelegramId) {
      postMigrationStatements.push(
        db.prepare(
          "UPDATE users SET is_owner = 1 WHERE role = 'admin' AND telegram_user_id = ? AND deleted_at IS NULL",
        ).bind(ownerTelegramId),
      );
    }
    await db.batch(postMigrationStatements);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    sellerCode: row.seller_code,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    isOwner: Boolean(row.is_owner),
    ownerId: row.owner_id,
    status: row.status,
    credits: Number(row.credits),
    deviceId: row.device_id,
    telegramUserId: row.telegram_user_id,
    referralCode: row.referral_code,
    accessExpiresAt: row.access_expires_at,
    mustChangePassword: Boolean(row.must_change_password),
    mustSetPin: Boolean(row.must_set_pin),
    pinSet: Boolean(row.pin_hash),
    unlocked: false,
  };
}

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
  const accessCondition = includeExpiredAccess
    ? ""
    : "AND (u.access_expires_at IS NULL OR u.access_expires_at > ?)";
  const now = new Date().toISOString();
  const idleCutoff = new Date(Date.now() - sessionIdleMinutes() * 60_000).toISOString();
  await database().prepare(
    "DELETE FROM sessions WHERE token_hash = ? AND (expires_at <= ? OR last_seen_at <= ?)",
  ).bind(tokenHash, now, idleCutoff).run();
  const statement = database().prepare(
    `SELECT s.id AS session_id, s.token_hash, s.expires_at,
      s.last_seen_at, s.pin_verified_at, s.unlocked_until,
      u.id, u.seller_code, u.username, u.display_name, u.email, u.role, u.is_owner, u.owner_id,
     u.status, u.password_hash, u.password_salt, u.pin_hash, u.pin_salt, u.credits,
      u.device_id, u.device_public_key, u.fingerprint_id_hash, u.telegram_user_id,
      u.referral_code, u.referred_by_user_id, u.access_expires_at, u.must_change_password, u.must_set_pin,
      u.deleted_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND s.last_seen_at > ?
       AND u.status = 'active' AND u.deleted_at IS NULL
       ${accessCondition}
     LIMIT 1`,
  );
  const row = includeExpiredAccess
    ? await statement.bind(tokenHash, now, idleCutoff).first<SessionRow>()
    : await statement.bind(tokenHash, now, idleCutoff, now).first<SessionRow>();
  if (!row || (roles && !roles.includes(row.role))) return null;
  await database().prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(now, row.session_id).run();
  return {
    user: {
      ...mapUser(row),
      unlocked: Boolean(row.unlocked_until && Date.parse(row.unlocked_until) > Date.now()),
    },
    row,
    sessionId: row.session_id,
    pinVerifiedAt: row.pin_verified_at,
    unlockedUntil: row.unlocked_until,
  };
}

export async function getSessionUser(request: Request, roles?: AppRole[]) {
  return findSessionUser(request, roles, false);
}

export async function getSessionUserIncludingExpired(request: Request, roles?: AppRole[]) {
  return findSessionUser(request, roles, true);
}

export async function requireSession(request: Request, roles?: AppRole[]) {
  assertTrustedMutation(request);
  const session = await getSessionUser(request, roles);
  if (!session) throw new Response(JSON.stringify({ error: "Acceso no autorizado." }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  return session;
}

export async function requireUnlockedSession(request: Request, roles?: AppRole[]) {
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

export async function rotateAndUnlockSession(request: Request, sessionId: string) {
  const token = randomToken(36);
  const tokenHash = await sha256(token);
  const now = new Date();
  const unlockedUntil = new Date(now.getTime() + PIN_UNLOCK_MINUTES * 60_000);
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
  const cookie = `${sessionCookieName(request)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86_400}${secure}`;
  return { unlockedUntil: unlockedUntil.toISOString(), cookie };
}

export async function createSession(request: Request, userId: string, options: { unlocked?: boolean } = {}) {
  await ensureAuthSchema();
  const token = randomToken(36);
  const tokenHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  const unlockedUntil = options.unlocked ? new Date(now.getTime() + PIN_UNLOCK_MINUTES * 60_000).toISOString() : null;
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
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'client' AND deleted_at IS NULL)
         AND id IN (
         SELECT id FROM sessions WHERE user_id = ?
         ORDER BY created_at DESC LIMIT -1 OFFSET ?
       )`,
    ).bind(userId, userId, userId, MAX_SESSIONS_PER_USER),
  ]);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${sessionCookieName(request)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86_400}${secure}`;
}

export async function destroySession(request: Request) {
  assertTrustedMutation(request);
  const token = cookieValue(request, sessionCookieName(request));
  if (token) {
    await ensureAuthSchema();
    await database().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${sessionCookieName(request)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function canonicalPublicKey(key: JsonWebKey) {
  return JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y });
}

function generateReferralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = "";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

export function trialExpiresAt(days = TRIAL_DAYS) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export async function createUniqueReferralCode() {
  await ensureAuthSchema();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateReferralCode();
    const existing = await database().prepare("SELECT id FROM users WHERE referral_code = ? LIMIT 1").bind(code).first();
    if (!existing) return code;
  }
  throw new Error("No se pudo generar un codigo de invitacion.");
}

export async function ensureReferralCodeForUser(userId: string) {
  await ensureAuthSchema();
  const current = await database().prepare(
    "SELECT role, referral_code FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1",
  ).bind(userId).first<{ role: AppRole; referral_code: string | null }>();
  if (!current || current.role !== "client") return null;
  if (current.referral_code) return current.referral_code;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = await createUniqueReferralCode();
    try {
      const result = await database().prepare(
        "UPDATE users SET referral_code = ?, updated_at = ? WHERE id = ? AND role = 'client' AND referral_code IS NULL",
      ).bind(code, new Date().toISOString(), userId).run();
      if (Number(result.meta.changes ?? 0) === 1) return code;
    } catch (error) {
      if (!/UNIQUE constraint failed/iu.test(error instanceof Error ? error.message : "")) throw error;
    }
    const assigned = await database().prepare(
      "SELECT referral_code FROM users WHERE id = ? AND role = 'client' LIMIT 1",
    ).bind(userId).first<{ referral_code: string | null }>();
    if (assigned?.referral_code) return assigned.referral_code;
  }
  throw new Error("No se pudo asignar el código de promoción.");
}

export async function ensureClientReferralCodes(limit = 250) {
  await ensureAuthSchema();
  const missing = await database().prepare(
    `SELECT id FROM users
     WHERE role = 'client' AND referral_code IS NULL AND deleted_at IS NULL
     ORDER BY created_at LIMIT ?`,
  ).bind(Math.max(1, Math.min(500, Math.trunc(limit)))).all<{ id: string }>();
  for (const row of missing.results ?? []) {
    await ensureReferralCodeForUser(row.id);
  }
}

export async function verifyDeviceProof(input: {
  sellerId: string;
  username: string;
  deviceId: string;
  publicKey: JsonWebKey;
  proof: string;
  proofTimestamp: number;
}) {
  if (!Number.isFinite(input.proofTimestamp) || Math.abs(Date.now() - input.proofTimestamp) > DEVICE_PROOF_WINDOW_MS) {
    return false;
  }
  if (input.publicKey.kty !== "EC" || input.publicKey.crv !== "P-256" || !input.publicKey.x || !input.publicKey.y) return false;
  const canonical = canonicalPublicKey(input.publicKey);
  if (!constantTimeEqual(await sha256(canonical), input.deviceId)) return false;
  try {
    const key = await crypto.subtle.importKey("jwk", input.publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const payload = new TextEncoder().encode(
      `mi-banco-device-proof-v1\n${normalizeSellerCode(input.sellerId)}\n${normalizeUsername(input.username)}\n${input.deviceId}\n${input.proofTimestamp}`,
    );
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64UrlToBytes(input.proof), payload);
  } catch {
    return false;
  }
}

export async function findLoginUser(sellerCode: string, username: string) {
  await ensureAuthSchema();
  return database().prepare(
    "SELECT * FROM users WHERE seller_code = ? AND username = ? AND deleted_at IS NULL LIMIT 1",
  ).bind(normalizeSellerCode(sellerCode), normalizeUsername(username)).first<UserRow>();
}

export async function bindDevice(user: UserRow, deviceId: string, publicKey: JsonWebKey) {
  if (user.device_id && user.device_id !== deviceId) return false;
  if (!user.device_id) {
    try {
      await database().prepare(
        "UPDATE users SET device_id = ?, device_public_key = ?, updated_at = ? WHERE id = ? AND device_id IS NULL",
      ).bind(deviceId, JSON.stringify(publicKey), new Date().toISOString(), user.id).run();
    } catch {
      return false;
    }
  }
  return true;
}

export async function createUser(input: {
  sellerCode: string;
  username: string;
  displayName: string;
  email?: string;
  password: string;
  role: AppRole;
  isOwner?: boolean;
  ownerId?: string | null;
  status?: "pending" | "active";
  credits?: number;
  phone?: string;
  pin?: string;
  fingerprintIdHash?: string;
  telegramUserId?: string;
  referralCode?: string;
  referredByUserId?: string | null;
  accessExpiresAt?: string | null;
  mustChangePassword?: boolean;
}) {
  await ensureAuthSchema();
  const phoneE164 = input.phone ? normalizePeruvianMobile(input.phone) : "";
  if (input.phone && !phoneE164) throw new Error("El número de celular debe tener 9 dígitos y comenzar con 9.");
  const referralCode = input.referralCode?.trim()
    || (input.role === "client" ? await createUniqueReferralCode() : null);
  const password = await hashSecret(input.password);
  const pin = input.pin ? await hashSecret(input.pin) : null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [database().prepare(
    `INSERT INTO users (
      id, seller_code, username, display_name, email, role, is_owner, owner_id, status,
      password_hash, password_salt, pin_hash, pin_salt, credits,
      device_id, device_public_key, fingerprint_id_hash, telegram_user_id,
      referral_code, referred_by_user_id, access_expires_at,
      must_change_password, must_set_pin,
      created_at, updated_at, activated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    normalizeSellerCode(input.sellerCode),
    normalizeUsername(input.username),
    input.displayName.trim(),
    input.email?.trim().toLocaleLowerCase("es-PE") ?? "",
    input.role,
    input.isOwner ? 1 : 0,
    input.ownerId ?? null,
    input.status ?? "pending",
    password.hash,
    password.salt,
    pin?.hash ?? null,
    pin?.salt ?? null,
    Math.max(0, Math.trunc(input.credits ?? 0)),
    null,
    null,
    input.fingerprintIdHash ?? null,
    input.telegramUserId ?? null,
    referralCode,
    input.referredByUserId ?? null,
    input.accessExpiresAt ?? null,
    input.mustChangePassword ? 1 : 0,
    pin ? 0 : 1,
    now,
    now,
    (input.status ?? "pending") === "active" ? now : null,
    null,
  )];
  if (phoneE164) {
    statements.push(database().prepare(
      `INSERT INTO payment_directory (
        id, user_id, phone_e164, discoverable, verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, phoneE164, now, now, now));
  }
  await database().batch(statements);
  return id;
}

export function createDecoyPasswordResetChallenge(): PasswordResetChallenge {
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_MINUTES * 60_000).toISOString();
  return {
    requestId: crypto.randomUUID(),
    token: randomToken(32),
    expiresAt,
  };
}

export async function issuePasswordResetChallenge(userId: string, subjectHash: string): Promise<PasswordResetChallenge> {
  await ensureAuthSchema();
  const challenge = createDecoyPasswordResetChallenge();
  const tokenHash = await sha256(challenge.token);
  const now = new Date().toISOString();
  await database().batch([
    database().prepare(
      `UPDATE password_reset_tokens
       SET used_at = ?, consumed_by = 'superseded'
       WHERE user_id = ? AND used_at IS NULL`,
    ).bind(now, userId),
    database().prepare(
      `INSERT INTO password_reset_tokens (
        id, user_id, token_hash, subject_hash, created_at, expires_at, used_at, consumed_by
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).bind(challenge.requestId, userId, tokenHash, subjectHash, now, challenge.expiresAt),
  ]);
  return challenge;
}

export async function completePasswordReset(input: {
  requestId: string;
  token: string;
  newPassword: string;
}) {
  await ensureAuthSchema();
  const tokenHash = await sha256(input.token);
  const password = await hashSecret(input.newPassword);
  const now = new Date().toISOString();
  const consumeMarker = crypto.randomUUID();
  const results = await database().batch([
    database().prepare(
      `UPDATE password_reset_tokens
       SET used_at = ?, consumed_by = ?
       WHERE id = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ?`,
    ).bind(now, consumeMarker, input.requestId, tokenHash, now),
    database().prepare(
      `UPDATE users
       SET password_hash = ?, password_salt = ?, must_change_password = 0,
           pin_hash = NULL, pin_salt = NULL, must_set_pin = 1,
           device_id = NULL, device_public_key = NULL, updated_at = ?
       WHERE id = (
         SELECT user_id FROM password_reset_tokens WHERE id = ? AND consumed_by = ? LIMIT 1
       )`,
    ).bind(password.hash, password.salt, now, input.requestId, consumeMarker),
    database().prepare(
      `DELETE FROM sessions
       WHERE user_id = (
         SELECT user_id FROM password_reset_tokens WHERE id = ? AND consumed_by = ? LIMIT 1
       )`,
    ).bind(input.requestId, consumeMarker),
  ]);
  return Number(results[0]?.meta.changes ?? 0) === 1;
}

export async function revokeUserSessions(userId: string) {
  await database().prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

export async function revokeOtherUserSessions(userId: string, currentSessionId: string) {
  await database().prepare(
    "DELETE FROM sessions WHERE user_id = ? AND id <> ?",
  ).bind(userId, currentSessionId).run();
}

export async function linkTelegramIdentity(userId: string, telegramUserId: string) {
  await ensureAuthSchema();
  await database().prepare(
    "INSERT INTO telegram_identities (telegram_user_id, user_id, created_at) VALUES (?, ?, ?)",
  ).bind(telegramUserId.trim(), userId, new Date().toISOString()).run();
}

export function safeUser(row: UserRow) {
  return mapUser(row);
}

export function dbBinding() {
  return database();
}

export function routeError(error: unknown) {
  if (error instanceof Response) return error;
  const message = error instanceof Error ? error.message : "No se pudo completar la operaciÃ³n.";
  const duplicate = /UNIQUE constraint failed/i.test(message);
  console.error("[auth] Error interno de ruta", {
    name: error instanceof Error ? error.name : typeof error,
    duplicate,
  });
  return Response.json(
    {
      ok: false,
      error: duplicate
        ? "Ese usuario, dispositivo o registro ya existe."
        : "No se pudo completar la operacion.",
    },
    { status: duplicate ? 409 : 500, headers: { "cache-control": "no-store" } },
  );
}

export function validatePassword(password: string) {
  if (password.length < 8 || password.length > 128) return false;
  const normalized = password.normalize("NFKC").toLocaleLowerCase("en-US");
  return !new Set([
    "12345678",
    "123456789",
    "password",
    "password1",
    "qwerty123",
    "contraseña",
    "contrasena",
  ]).has(normalized);
}

export function validateDisplayName(displayName: string) {
  const normalized = displayName.trim();
  return normalized.length >= 2
    && normalized.length <= 80
    && !/[\u0000-\u001f\u007f]/u.test(normalized);
}

export function validateOptionalEmail(email: string) {
  const normalized = email.trim();
  return !normalized || (
    normalized.length <= 254
    && /^[^\s@]{1,64}@[^\s@]{1,189}$/u.test(normalized)
  );
}

export function validateUsername(username: string) {
  return /^[a-zA-Z0-9._-]{3,40}$/u.test(username);
}

export function validateSellerCode(code: string) {
  return /^\d{4,20}$/u.test(code);
}

export function generateTemporaryPassword() {
  return `Mb-${randomToken(9)}`;
}
