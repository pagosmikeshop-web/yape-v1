import { base64UrlToBytes } from "@/app/lib/base64url";
import { databaseForEnvironment, isSupabaseDatabase } from "@/app/lib/database-server";
import { canonicalPublicKey } from "@/app/lib/webauthn-utils";
import {
  constantTimeEqual,
  hashSecret,
  hmacSha256,
  randomToken,
  sha256,
} from "@/app/lib/auth-server/crypto";
import {
  authEnv,
  configuredOwnerTelegramId,
  isHostedEnvironment,
  sessionCookieName,
  SESSION_DAYS,
  unlockIdleMinutes,
} from "@/app/lib/auth-server/environment";
import { createSessionService } from "@/app/lib/auth-server/session";
import type {
  AppRole,
  AuthRateLimitRule,
  AuthUser,
  PasswordResetChallenge,
  UserRow,
} from "@/app/lib/auth-server/types";

export {
  hashSecret,
  publicSha256,
  secretHashNeedsUpgrade,
  secureCompare,
  verifySecret,
} from "@/app/lib/auth-server/crypto";
export {
  authEnv,
  bootstrapIsEnabled,
  configuredOwnerTelegramId,
  publicAppBaseUrl,
} from "@/app/lib/auth-server/environment";
export type {
  AppRole,
  AuthRateLimitRule,
  AuthUser,
  PasswordResetChallenge,
  UserRow,
} from "@/app/lib/auth-server/types";
export type { AuthEnv } from "@/app/lib/auth-server/environment";

// Inactivity only locks the UI again; it must not delete the authenticated
// session. The session itself remains valid for SESSION_DAYS.
const MAX_SESSIONS_PER_USER = 5;
// PostgreSQL rejects SQLite's `LIMIT -1` syntax. A positive upper bound keeps
// the cleanup portable while still deleting every session beyond the cap.
const SESSION_CLEANUP_LIMIT = 2_147_483_647;
const PASSWORD_RESET_MINUTES = 15;
export const SELF_REGISTRATION_SELLER_CODE = "YAPE";
export const TRIAL_DAYS = 30;
export const REFERRAL_EXTENSION_DAYS = 3;
/** Lifetime limit for /redeem extensions per account. */
export const REFERRAL_REDEMPTION_LIMIT = 3;
const MIN_RATE_LIMIT_PEPPER_LENGTH = 32;
const DEVICE_PROOF_WINDOW_MS = 5 * 60 * 1000;
let schemaReady: Promise<void> | null = null;

export function isUniqueConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|duplicate key value violates unique constraint|\b23505\b/iu.test(message);
}

function database() {
  const env = authEnv();
  return databaseForEnvironment(env);
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
    `${new URL(request.url).pathname}${new URL(request.url).search}`,
    clientIp,
  ].join("\n");
  const expected = await hmacSha256(secret, payload);
  return constantTimeEqual(expected, signature) ? clientIp : "";
}

export async function requestIpRateLimitSubject(request: Request) {
  const adminProxyIp = await verifiedAdminProxyIp(request);
  if (adminProxyIp) return adminProxyIp;

  // En producción Vercel entrega esta cabecera. No se acepta
  // `cf-connecting-ip` como fuente primaria: un cliente directo podría
  // enviarla si Cloudflare no es el proxy verificado delante de Vercel.
  const vercelIp = request.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim() ?? "";
  if (/^[0-9A-Fa-f:.]{3,64}$/u.test(vercelIp)) return vercelIp;
  if (isHostedEnvironment()) return "unavailable";

  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (/^[0-9A-Fa-f:.]{3,64}$/u.test(cloudflareIp)) return cloudflareIp;
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

type DistributedRateLimitState = {
  attempts: number;
  retryAfterSeconds: number;
};

const REDIS_RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return { current, ttl }
`;

function redisRateLimitConfig() {
  const environment = authEnv();
  const endpoint = environment.RATE_LIMIT_REDIS_URL?.trim() || environment.KV_REST_API_URL?.trim() || "";
  const token = environment.RATE_LIMIT_REDIS_TOKEN?.trim() || environment.KV_REST_API_TOKEN?.trim() || "";
  if (!endpoint || !token) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return { endpoint: url.toString().replace(/\/$/u, ""), token };
  } catch {
    return null;
  }
}

async function tryDistributedRateLimit(
  rule: AuthRateLimitRule,
  subjectHash: string,
): Promise<DistributedRateLimitState | null> {
  const config = redisRateLimitConfig();
  if (!config) return null;
  const key = `yape:auth-rate:v1:${rule.bucket}:${subjectHash}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        REDIS_RATE_LIMIT_SCRIPT,
        "1",
        key,
        String(rule.windowSeconds),
      ]),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json() as { result?: unknown };
    const result = Array.isArray(payload.result) ? payload.result : [];
    const attempts = Number(result[0]);
    const ttl = Number(result[1]);
    if (!Number.isSafeInteger(attempts) || attempts < 1 || !Number.isFinite(ttl)) return null;
    return {
      attempts,
      retryAfterSeconds: Math.max(1, Math.min(rule.windowSeconds, Math.trunc(ttl))),
    };
  } catch {
    // El backend distribuido es opcional: si no responde, se conserva el
    // limitador transaccional de Supabase como fallback seguro.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function enforceAuthRateLimits(rules: AuthRateLimitRule[]) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const now = new Date(nowSeconds * 1000).toISOString();

  for (const rule of rules) {
    if (!/^[a-z0-9:_-]{3,64}$/u.test(rule.bucket) || rule.limit < 1 || rule.windowSeconds < 1) {
      throw new Error("Invalid authentication rate-limit policy.");
    }
  }

  const hashedRules = await Promise.all(rules.map(async (rule) => ({
    rule,
    subjectHash: await authRateLimitSubjectHash(rule.bucket, rule.subject),
  })));
  const distributedStates = await Promise.all(hashedRules.map(async ({ rule, subjectHash }) => ({
    rule,
    subjectHash,
    state: await tryDistributedRateLimit(rule, subjectHash),
  })));
  const distributedResults = distributedStates.filter((entry): entry is {
    rule: AuthRateLimitRule;
    subjectHash: string;
    state: DistributedRateLimitState;
  } => entry.state !== null);
  const distributedKeys = new Set(distributedResults.map((entry) => `${entry.rule.bucket}\n${entry.subjectHash}`));
  const fallbackRules = hashedRules.filter(({ rule, subjectHash }) => !distributedKeys.has(`${rule.bucket}\n${subjectHash}`));
  const states: Array<{ rule: AuthRateLimitRule; attempts: number; retryAfterSeconds: number }> = distributedResults.map(({ rule, state }) => ({
    rule,
    attempts: state.attempts,
    retryAfterSeconds: state.retryAfterSeconds,
  }));

  if (fallbackRules.length) {
    await ensureAuthSchema();
    const fallbackStates = await Promise.all(fallbackRules.map(async ({ rule, subjectHash }) => {
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
      return {
        rule,
        attempts: Number(state?.attempt_count ?? rule.limit + 1),
        retryAfterSeconds: Math.max(
          1,
          Number(state?.window_started_at ?? nowSeconds) + rule.windowSeconds - nowSeconds,
        ),
      };
    }));
    states.push(...fallbackStates);
  }

  for (const { rule, attempts, retryAfterSeconds } of states) {
    if (attempts > rule.limit) {
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

export async function ensureAuthSchema() {
  if (schemaReady) return schemaReady;
  const db = database();
  if (isSupabaseDatabase(authEnv())) {
    schemaReady = (async () => {
      const requiredTables = [
        "users",
        "sessions",
        "account_balances",
        "account_movements",
        "account_sms_settings",
        "sms_credit_tokens",
        "sms_credit_ledger",
        "transfer_sms_notifications",
        "account_payment_profiles",
        "global_recipient_directory",
        "global_qr_directory",
        "referral_redemptions",
        "referral_redeemer_claims",
        "account_blacklist",
      ];
      // Una sola consulta de metadatos evita siete viajes de red en cada
      // instancia fría de Supabase antes de validar la sesión.
      const placeholders = requiredTables.map(() => "?").join(", ");
      const rows = await db.prepare(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN (${placeholders})`,
      ).bind(...requiredTables).all<{ table_name: string }>();
      const found = new Set((rows.results ?? []).map((row) => row.table_name));
      const missing = requiredTables.filter((table) => !found.has(table));
      if (missing.length) {
        throw new Error(`El esquema de Supabase no estÃ¡ aplicado. Faltan tablas: ${missing.join(", ")}. Ejecuta la migraciÃ³n SQL antes de cambiar DATABASE_PROVIDER.`);
      }
      await db.exec(
        `DROP INDEX IF EXISTS public.global_recipient_directory_phone_unique;
         CREATE UNIQUE INDEX IF NOT EXISTS global_recipient_directory_phone_provider_unique
           ON public.global_recipient_directory(phone_e164, provider);`,
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
    return schemaReady;
  }
  schemaReady = (async () => {
    await db.exec("PRAGMA foreign_keys = ON");
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
        referral_redemption_count INTEGER NOT NULL DEFAULT 0 CHECK (referral_redemption_count >= 0),
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
      `CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'seller', 'client')),
        granted_by TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, role),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
      )`,
      "CREATE INDEX IF NOT EXISTS user_roles_role_idx ON user_roles(role, user_id)",
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
      `CREATE TABLE IF NOT EXISTS account_payment_profiles (
        user_id TEXT PRIMARY KEY,
        phone_e164 TEXT,
        qr_payload_ciphertext TEXT,
        qr_payload_iv TEXT,
        accuracy_confirmed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (phone_e164 IS NOT NULL OR qr_payload_ciphertext IS NOT NULL),
        CHECK ((qr_payload_ciphertext IS NULL AND qr_payload_iv IS NULL) OR (qr_payload_ciphertext IS NOT NULL AND qr_payload_iv IS NOT NULL)),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS account_payment_profiles_phone_unique ON account_payment_profiles(phone_e164) WHERE phone_e164 IS NOT NULL",
      "CREATE INDEX IF NOT EXISTS account_payment_profiles_updated_idx ON account_payment_profiles(updated_at)",
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
      `CREATE TABLE IF NOT EXISTS global_recipient_directory (
        id TEXT PRIMARY KEY,
        phone_e164 TEXT NOT NULL,
        display_name TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'Yape' CHECK (provider IN (
          'Yape','Plin','BCP','BBVA','Interbank','Scotiabank','Bim',
          'Banco Falabella','Banco Pichincha','Dale!','Izipay','Agora / Oh!','Tunki'
        )),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','qr')),
        submitted_by_user_id TEXT NOT NULL,
        terms_version TEXT NOT NULL,
        terms_accepted_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_reason TEXT,
        FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS global_recipient_directory_phone_provider_unique ON global_recipient_directory(phone_e164, provider)",
      "CREATE INDEX IF NOT EXISTS global_recipient_directory_submitter_idx ON global_recipient_directory(submitted_by_user_id, updated_at)",
      "CREATE INDEX IF NOT EXISTS global_recipient_directory_active_idx ON global_recipient_directory(phone_e164, status)",
      `CREATE TABLE IF NOT EXISTS global_qr_directory (
        id TEXT PRIMARY KEY,
        holder_name TEXT NOT NULL,
        phone_e164 TEXT,
        provider TEXT NOT NULL CHECK (provider IN (
          'Yape','Plin','BCP','BBVA','Interbank','Scotiabank','Bim',
          'Banco Falabella','Banco Pichincha','Dale!','Izipay','Agora / Oh!','Tunki'
        )),
        recipient_user_id TEXT,
        submitted_by_user_id TEXT NOT NULL,
        qr_payload_ciphertext TEXT NOT NULL,
        qr_payload_iv TEXT NOT NULL,
        payload_hash TEXT NOT NULL UNIQUE,
        encryption_version INTEGER NOT NULL DEFAULT 1 CHECK (encryption_version = 1),
        terms_version TEXT NOT NULL,
        terms_accepted_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_reason TEXT,
        FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS global_qr_directory_submitter_idx ON global_qr_directory(submitted_by_user_id, updated_at)",
      "CREATE INDEX IF NOT EXISTS global_qr_directory_phone_idx ON global_qr_directory(phone_e164, status)",
      "CREATE INDEX IF NOT EXISTS global_qr_directory_recipient_idx ON global_qr_directory(recipient_user_id)",
      `CREATE TABLE IF NOT EXISTS account_balances (
        user_id TEXT PRIMARY KEY,
        balance_cents INTEGER NOT NULL DEFAULT 3913 CHECK (balance_cents >= 0 AND balance_cents <= 100000000),
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
      `CREATE TABLE IF NOT EXISTS account_feature_entitlements (
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('sms','auto')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        validated_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, kind),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS account_feature_entitlements_user_idx ON account_feature_entitlements(user_id, kind)",
      `CREATE TABLE IF NOT EXISTS account_sms_settings (
        user_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        display_name TEXT NOT NULL DEFAULT '',
        credit_balance INTEGER NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
        last_reservation_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS sms_credit_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        token_hint TEXT NOT NULL,
        credits INTEGER NOT NULL CHECK (credits > 0),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        redeemed_at TEXT,
        redeemed_by_user_id TEXT,
        redeemed_ledger_id TEXT,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (redeemed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
      "CREATE INDEX IF NOT EXISTS sms_credit_tokens_created_idx ON sms_credit_tokens(created_at)",
      `CREATE TABLE IF NOT EXISTS sms_credit_ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(reason, reference_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS sms_credit_ledger_user_created_idx ON sms_credit_ledger(user_id, created_at)",
      `CREATE TABLE IF NOT EXISTS transfer_sms_notifications (
        id TEXT PRIMARY KEY,
        movement_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','reserved','sent','failed','skipped')),
        reservation_id TEXT,
        refund_ledger_id TEXT,
        recipient_reference TEXT NOT NULL DEFAULT '',
        provider_message_id TEXT,
        failure_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (movement_id) REFERENCES account_movements(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS transfer_sms_notifications_user_created_idx ON transfer_sms_notifications(user_id, created_at)",
      `CREATE TABLE IF NOT EXISTS autocomplete_keys (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        token_hint TEXT NOT NULL,
        credits_total INTEGER NOT NULL CHECK (credits_total > 0),
        credits_remaining INTEGER NOT NULL CHECK (credits_remaining >= 0),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,
      "CREATE INDEX IF NOT EXISTS autocomplete_keys_created_idx ON autocomplete_keys(created_at)",
      `CREATE TABLE IF NOT EXISTS autocomplete_key_claims (
        key_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        FOREIGN KEY (key_id) REFERENCES autocomplete_keys(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS autocomplete_key_claims_user_idx ON autocomplete_key_claims(user_id, claimed_at)",
      "DELETE FROM autocomplete_key_claims WHERE rowid NOT IN (SELECT MIN(rowid) FROM autocomplete_key_claims GROUP BY key_id)",
      "CREATE UNIQUE INDEX IF NOT EXISTS autocomplete_key_claims_key_unique ON autocomplete_key_claims(key_id)",
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
      `CREATE TABLE IF NOT EXISTS global_permanent_access_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        token_hint TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        redeemed_at TEXT,
        redeemed_by_user_id TEXT,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,
      "CREATE INDEX IF NOT EXISTS global_permanent_access_tokens_created_idx ON global_permanent_access_tokens(created_at)",
      "CREATE INDEX IF NOT EXISTS global_permanent_access_tokens_redeemed_idx ON global_permanent_access_tokens(redeemed_at)",
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
      "CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_requests(user_id, status, created_at)",
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
      `CREATE TABLE IF NOT EXISTS telegram_registration_challenges (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        telegram_user_id TEXT NOT NULL,
        fingerprint_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        verified_at TEXT,
        consumed_at TEXT
      )`,
      "CREATE INDEX IF NOT EXISTS telegram_registration_challenges_lookup_idx ON telegram_registration_challenges(telegram_user_id, fingerprint_hash, expires_at)",
      "CREATE INDEX IF NOT EXISTS telegram_registration_challenges_expiry_idx ON telegram_registration_challenges(expires_at)",
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
      `CREATE TABLE IF NOT EXISTS referral_redeemer_claims (
        telegram_user_id TEXT PRIMARY KEY,
        referrer_user_id TEXT NOT NULL,
        redemption_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS referral_redeemer_claims_referrer_idx ON referral_redeemer_claims(referrer_user_id)",
      `CREATE TABLE IF NOT EXISTS account_blacklist (
        id TEXT PRIMARY KEY,
        telegram_user_id TEXT NOT NULL UNIQUE,
        reason TEXT,
        banned_by_user_id TEXT,
        banned_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS account_blacklist_telegram_user_id_idx ON account_blacklist(telegram_user_id)",
      `CREATE TABLE IF NOT EXISTS manager_audit_log (
        id TEXT PRIMARY KEY,
        telegram_user_id TEXT NOT NULL,
        command TEXT NOT NULL,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rbac_permission_overrides (
        user_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        effect TEXT NOT NULL CHECK (effect IN ('allow','deny')),
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, permission),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES users(id)
      )`,
      "CREATE INDEX IF NOT EXISTS rbac_permission_overrides_user_idx ON rbac_permission_overrides(user_id)",
      `CREATE TABLE IF NOT EXISTS client_crm_profiles (
        user_id TEXT PRIMARY KEY,
        crm_status TEXT NOT NULL DEFAULT 'new'
          CHECK (crm_status IN ('new','vip')),
        client_type TEXT NOT NULL DEFAULT 'individual'
          CHECK (client_type IN ('individual','business')),
        category TEXT NOT NULL DEFAULT 'general',
        tags_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        last_activity_at TEXT,
        updated_by TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES users(id)
      )`,
      "CREATE INDEX IF NOT EXISTS client_crm_profiles_status_idx ON client_crm_profiles(crm_status, category)",
      "CREATE INDEX IF NOT EXISTS client_crm_profiles_activity_idx ON client_crm_profiles(last_activity_at)",
      `CREATE TABLE IF NOT EXISTS client_crm_activities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        activity_type TEXT NOT NULL
          CHECK (activity_type IN ('purchase','payment','conversation','quote','note','status')),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`,
      "CREATE INDEX IF NOT EXISTS client_crm_activities_user_idx ON client_crm_activities(user_id, created_at)",
      "CREATE INDEX IF NOT EXISTS client_crm_activities_type_idx ON client_crm_activities(activity_type, created_at)",
      `CREATE TABLE IF NOT EXISTS webauthn_credentials (
        credential_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports TEXT,
        device_type TEXT,
        backed_up INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx ON webauthn_credentials(user_id)",
      `CREATE TABLE IF NOT EXISTS webauthn_challenges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('registration','authentication')),
        challenge TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      "CREATE INDEX IF NOT EXISTS webauthn_challenges_user_type_idx ON webauthn_challenges(user_id, type)",
      "CREATE INDEX IF NOT EXISTS webauthn_challenges_expiry_idx ON webauthn_challenges(expires_at)",
    ];
    await db.batch(statements.map((sql) => db.prepare(sql)));

    // Las activaciones históricas de SMS no tienen saldo. Se mantienen como
    // registros inertes hasta que el usuario canjee un token de créditos.
    const smsMigrationNow = new Date().toISOString();
    await db.prepare(
      `INSERT OR IGNORE INTO account_sms_settings (
        user_id, enabled, display_name, credit_balance, last_reservation_id, created_at, updated_at
      ) SELECT user_id, 0, '', 0, NULL, ?, ?
        FROM account_feature_entitlements WHERE kind = 'sms'`,
    ).bind(smsMigrationNow, smsMigrationNow).run();

    const recipientDirectoryColumns = await db.prepare("PRAGMA table_info(global_recipient_directory)").all<{ name: string }>();
    const knownRecipientDirectoryColumns = new Set((recipientDirectoryColumns.results ?? []).map((column) => column.name));
    if (!knownRecipientDirectoryColumns.has("provider")) {
      try {
        await db.prepare("ALTER TABLE global_recipient_directory ADD COLUMN provider TEXT NOT NULL DEFAULT 'Yape'").run();
      } catch (error) {
        if (!/duplicate column name/iu.test(error instanceof Error ? error.message : "")) throw error;
      }
    }

    const directoryIndexes = await db.prepare("PRAGMA index_list('global_recipient_directory')").all<{
      name: string;
      unique: number;
    }>();
    const hasLegacyPhoneUnique = (directoryIndexes.results ?? []).some(
      (index) => Number(index.unique) === 1 && index.name !== "global_recipient_directory_phone_provider_unique",
    );
    if (hasLegacyPhoneUnique) {
      await db.exec(
        `CREATE TABLE global_recipient_directory_migrating (
          id TEXT PRIMARY KEY,
          phone_e164 TEXT NOT NULL,
          display_name TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT 'Yape' CHECK (provider IN (
            'Yape','Plin','BCP','BBVA','Interbank','Scotiabank','Bim',
            'Banco Falabella','Banco Pichincha','Dale!','Izipay','Agora / Oh!','Tunki'
          )),
          source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','qr')),
          submitted_by_user_id TEXT NOT NULL,
          terms_version TEXT NOT NULL,
          terms_accepted_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          revoked_at TEXT,
          revoked_reason TEXT
        );
        INSERT INTO global_recipient_directory_migrating
          SELECT id, phone_e164, display_name, provider, source, submitted_by_user_id,
                 terms_version, terms_accepted_at, status, created_at, updated_at,
                 revoked_at, revoked_reason
          FROM global_recipient_directory;
        DROP TABLE global_recipient_directory;
        ALTER TABLE global_recipient_directory_migrating RENAME TO global_recipient_directory;
        CREATE UNIQUE INDEX global_recipient_directory_phone_provider_unique
          ON global_recipient_directory(phone_e164, provider);
        CREATE INDEX global_recipient_directory_submitter_idx
          ON global_recipient_directory(submitted_by_user_id, updated_at);
        CREATE INDEX global_recipient_directory_active_idx
          ON global_recipient_directory(phone_e164, status);`,
      );
    }

    // Backfill idempotente para las cuentas existentes antes de habilitar
    // cuentas con más de un rol.
    await db.prepare(
      `INSERT OR IGNORE INTO user_roles (user_id, role, granted_by, created_at)
       SELECT id, role, NULL, created_at FROM users WHERE deleted_at IS NULL`,
    ).run();

    const systemNow = new Date().toISOString();
    await db.prepare(
      `INSERT OR IGNORE INTO users (
        id, seller_code, username, display_name, email, role, is_owner, owner_id,
        status, password_hash, password_salt, pin_hash, pin_salt, credits,
        device_id, device_public_key, fingerprint_id_hash, telegram_user_id,
        referral_code, referred_by_user_id, access_expires_at,
        must_change_password, must_set_pin, created_at, updated_at, activated_at, deleted_at
      ) VALUES (
        'system-telegram-trial', 'SYSTEM', 'telegram-trial', 'Sistema Telegram', '',
        'seller', 0, NULL, 'disabled', ?, ?, NULL, NULL, 0,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?, ?, NULL, ?
      )`,
    ).bind("disabled", "disabled", systemNow, systemNow, systemNow).run();
    await db.prepare(
      `UPDATE client_crm_profiles
       SET crm_status = CASE
         WHEN EXISTS (
           SELECT 1 FROM users u
           WHERE u.id = client_crm_profiles.user_id
             AND (u.role = 'client' OR EXISTS (
               SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'client'
             ))
             AND u.status = 'active'
             AND u.access_expires_at IS NULL
         ) THEN 'vip'
         ELSE 'new'
       END
       WHERE user_id IN (
         SELECT id FROM users u
         WHERE u.role = 'client' OR EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'client'
         )
       )`,
    ).run();

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
    await db.prepare(
      `CREATE TRIGGER IF NOT EXISTS account_movements_daily_limit
       BEFORE INSERT ON account_movements
       FOR EACH ROW
       WHEN (
         SELECT COALESCE(SUM(amount_cents), 0)
         FROM account_movements
         WHERE user_id = NEW.user_id
           AND date(created_at, '-5 hours') = date(NEW.created_at, '-5 hours')
       ) + NEW.amount_cents > 200000
       BEGIN
         SELECT RAISE(ABORT, 'DAILY_LIMIT_EXCEEDED');
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
      ["referral_redemption_count", "INTEGER NOT NULL DEFAULT 0 CHECK (referral_redemption_count >= 0)"],
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
    await db.prepare("DROP INDEX IF EXISTS users_fingerprint_unique").run();
    const postMigrationStatements = [
      db.prepare("CREATE INDEX IF NOT EXISTS users_fingerprint_idx ON users(fingerprint_id_hash) WHERE fingerprint_id_hash IS NOT NULL"),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_user_unique ON users(telegram_user_id) WHERE telegram_user_id IS NOT NULL"),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_unique ON users(referral_code) WHERE referral_code IS NOT NULL"),
      db.prepare("CREATE INDEX IF NOT EXISTS users_owner_role_idx ON users(owner_id, role, deleted_at)"),
      db.prepare("CREATE INDEX IF NOT EXISTS users_role_deleted_created_idx ON users(role, deleted_at, created_at)"),
      db.prepare(
        `UPDATE users
         SET referral_redemption_count = COALESCE((
           SELECT COUNT(*) FROM referral_redemptions
           WHERE referral_redemptions.referrer_user_id = users.id
         ), 0)
         WHERE referral_redemption_count < COALESCE((
           SELECT COUNT(*) FROM referral_redemptions
           WHERE referral_redemptions.referrer_user_id = users.id
         ), 0)`,
      ),
      db.prepare(
        `INSERT OR IGNORE INTO referral_redeemer_claims (
           telegram_user_id, referrer_user_id, redemption_id, created_at
         )
         SELECT redeemer_telegram_user_id, MIN(referrer_user_id), MIN(id), MIN(created_at)
         FROM referral_redemptions
         GROUP BY redeemer_telegram_user_id`,
      ),
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
  const roles = [...new Set<AppRole>([row.role, ...(row.roles ?? [])])];
  return {
    id: row.id,
    sellerCode: row.seller_code,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    roles,
    isOwner: Boolean(row.is_owner),
    ownerId: row.owner_id,
    status: row.status,
    credits: Number(row.credits),
    referralRedemptionCount: Number(row.referral_redemption_count ?? 0),
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
    `SELECT role, referral_code,
            EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client') AS has_client_role
     FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
  ).bind(userId).first<{ role: AppRole; referral_code: string | null; has_client_role: number }>();
  if (!current || (current.role !== "client" && !Boolean(current.has_client_role))) return null;
  if (current.referral_code) return current.referral_code;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = await createUniqueReferralCode();
    try {
      const result = await database().prepare(
    `UPDATE users SET referral_code = ?, updated_at = ?
     WHERE id = ? AND (role = 'client' OR EXISTS (
       SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client'
     )) AND referral_code IS NULL`,
      ).bind(code, new Date().toISOString(), userId).run();
      if (Number(result.meta.changes ?? 0) === 1) return code;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
    const assigned = await database().prepare(
      `SELECT referral_code FROM users
       WHERE id = ? AND (role = 'client' OR EXISTS (
         SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client'
       )) LIMIT 1`,
    ).bind(userId).first<{ referral_code: string | null }>();
    if (assigned?.referral_code) return assigned.referral_code;
  }
  throw new Error("No se pudo asignar el código de promoción.");
}

export async function ensureClientReferralCodes(limit = 250) {
  await ensureAuthSchema();
  const missing = await database().prepare(
    `SELECT id FROM users
     WHERE (role = 'client' OR EXISTS (
       SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client'
     )) AND referral_code IS NULL AND deleted_at IS NULL
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
  const normalizedSellerCode = normalizeSellerCode(sellerCode);
  const normalizedUsername = normalizeUsername(username);
  const directMatch = await database().prepare(
    "SELECT * FROM users WHERE seller_code = ? AND username = ? AND deleted_at IS NULL LIMIT 1",
  ).bind(normalizedSellerCode, normalizedUsername).first<UserRow>();
  if (directMatch) {
    directMatch.roles = await getUserRoles(directMatch.id);
    return directMatch;
  }
  if (!/^\d{4,24}$/u.test(normalizedSellerCode)) return null;
  const telegramMatch = await database().prepare(
    "SELECT * FROM users WHERE telegram_user_id = ? AND username = ? AND deleted_at IS NULL LIMIT 1",
  ).bind(normalizedSellerCode, normalizedUsername).first<UserRow>();
  if (telegramMatch) telegramMatch.roles = await getUserRoles(telegramMatch.id);
  return telegramMatch;
}

export function userHasRole(user: Pick<AuthUser, "role" | "roles"> | Pick<UserRow, "role" | "roles">, role: AppRole) {
  return user.role === role || Boolean(user.roles?.includes(role));
}

export async function getUserRoles(userId: string): Promise<AppRole[]> {
  await ensureAuthSchema();
  const rows = await database().prepare(
    "SELECT role FROM user_roles WHERE user_id = ? ORDER BY role",
  ).bind(userId).all<{ role: AppRole }>();
  return [...new Set(rows.results?.map((entry) => entry.role) ?? [])];
}

const sessionService = createSessionService({
  database,
  ensureAuthSchema,
  getUserRoles,
  mapUser,
  sessionCookieName,
  sha256,
  randomToken,
  unlockIdleMinutes,
  sessionDays: SESSION_DAYS,
  maxSessionsPerUser: MAX_SESSIONS_PER_USER,
  sessionCleanupLimit: SESSION_CLEANUP_LIMIT,
});

/**
 * The facade retains the established auth-server contract. Access recovery
 * alone uses the including-expired variant; regular app routes use requireSession.
 */
export const {
  createSession,
  destroySession,
  getSessionUser,
  getSessionUserIncludingExpired,
  requireSession,
  requireSessionIncludingExpired,
  requireUnlockedSession,
  rotateAndUnlockSession,
} = sessionService;

/** Obtiene los roles de una página completa en una sola consulta. */
export async function getUserRolesBulk(userIds: string[]) {
  const ids = [...new Set(userIds.map((id) => id.trim()).filter((id) => id.length > 0 && id.length <= 128))];
  const result = new Map<string, AppRole[]>();
  if (!ids.length) return result;
  await ensureAuthSchema();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await database().prepare(
    `SELECT user_id, role FROM user_roles WHERE user_id IN (${placeholders}) ORDER BY user_id, role`,
  ).bind(...ids).all<{ user_id: string; role: AppRole }>();
  for (const id of ids) result.set(id, []);
  for (const row of rows.results ?? []) {
    const roles = result.get(row.user_id) ?? [];
    if (!roles.includes(row.role)) roles.push(row.role);
    result.set(row.user_id, roles);
  }
  return result;
}

export async function grantUserRole(input: {
  userId: string;
  role: Extract<AppRole, "admin" | "seller">;
  grantedBy: string;
}) {
  await ensureAuthSchema();
  const target = await database().prepare(
    `SELECT id, role, is_owner, status, deleted_at
     FROM users WHERE id = ? LIMIT 1`,
  ).bind(input.userId).first<{ id: string; role: AppRole; is_owner: number; status: string; deleted_at: string | null }>();
  if (!target || target.deleted_at || target.is_owner || target.status !== "active") return null;
  if (target.role !== "client" && target.role !== input.role) return null;

  const now = new Date().toISOString();
  const ownerId = input.grantedBy;
  await database().batch([
    database().prepare(
      `INSERT OR IGNORE INTO user_roles (user_id, role, granted_by, created_at)
       VALUES (?, 'client', ?, ?)`,
    ).bind(target.id, input.grantedBy, now),
    database().prepare(
      `INSERT OR IGNORE INTO user_roles (user_id, role, granted_by, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(target.id, input.role, input.grantedBy, now),
    database().prepare(
      `UPDATE users SET role = ?, owner_id = COALESCE(owner_id, ?), updated_at = ?
       WHERE id = ? AND role = 'client'`,
    ).bind(input.role, ownerId, now, target.id),
    database().prepare(
      `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
       SELECT ?, COALESCE(telegram_user_id, id), 'web_role_grant', ?, ?
       FROM users WHERE id = ?`,
    ).bind(crypto.randomUUID(), `${target.id}:${input.role}`, now, target.id),
  ]);
  const refreshed = await database().prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(target.id).first<UserRow>();
  if (!refreshed) return null;
  refreshed.roles = await getUserRoles(target.id);
  return refreshed;
}

export async function revokeUserRole(input: {
  userId: string;
  role: Extract<AppRole, "admin" | "seller">;
  revokedBy: string;
}) {
  await ensureAuthSchema();
  const target = await database().prepare(
    `SELECT id, role, is_owner, status, deleted_at
     FROM users WHERE id = ? LIMIT 1`,
  ).bind(input.userId).first<{ id: string; role: AppRole; is_owner: number; status: string; deleted_at: string | null }>();
  if (!target || target.deleted_at || target.is_owner || target.status !== "active") return null;
  const roles = await getUserRoles(target.id);
  if (!roles.includes("client") || !roles.includes(input.role)) return null;

  const now = new Date().toISOString();
  await database().batch([
    database().prepare(
      "DELETE FROM user_roles WHERE user_id = ? AND role = ?",
    ).bind(target.id, input.role),
    database().prepare(
      `UPDATE users SET role = 'client', updated_at = ?
       WHERE id = ? AND role = ? AND is_owner = 0 AND deleted_at IS NULL`,
    ).bind(now, target.id, input.role),
    database().prepare(
      `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
       SELECT ?, COALESCE(telegram_user_id, id), 'web_role_revoke', ?, ?
       FROM users WHERE id = ?`,
    ).bind(crypto.randomUUID(), `${target.id}:${input.role}`, now, target.id),
  ]);
  const refreshed = await database().prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(target.id).first<UserRow>();
  if (!refreshed) return null;
  refreshed.roles = await getUserRoles(target.id);
  return refreshed;
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
  trialSellerId?: string;
}) {
  await ensureAuthSchema();
  if (!validateUsername(input.username)) {
    throw new Error("El usuario debe tener de 3 a 40 caracteres y no puede contener espacios.");
  }
  const phoneE164 = input.phone ? normalizePeruvianMobile(input.phone) : "";
  if (input.phone && !phoneE164) throw new Error("El número de celular debe tener 9 dígitos y comenzar con 9.");
  const referralCode = input.referralCode?.trim()
    || (input.role === "client" ? await createUniqueReferralCode() : null);
  const password = await hashSecret(input.password);
  const pin = input.pin ? await hashSecret(input.pin) : null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const trialSellerId = input.trialSellerId?.trim() ?? "";
  const effectiveStatus = trialSellerId ? "active" : input.status ?? "pending";
  const effectiveAccessExpiresAt = trialSellerId
    ? input.accessExpiresAt ?? trialExpiresAt()
    : input.accessExpiresAt ?? null;
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
    effectiveStatus,
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
    effectiveAccessExpiresAt,
    input.mustChangePassword ? 1 : 0,
    pin ? 0 : 1,
    now,
    now,
    effectiveStatus === "active" ? now : null,
    null,
  ), database().prepare(
    `INSERT OR IGNORE INTO user_roles (user_id, role, granted_by, created_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(id, input.role, input.ownerId ?? null, now)];
  statements.push(database().prepare(
    `INSERT INTO account_balances (user_id, balance_cents, is_configured, updated_at)
     VALUES (?, 0, 1, ?)`,
  ).bind(id, now));
  if (phoneE164) {
    statements.push(database().prepare(
      `INSERT INTO payment_directory (
        id, user_id, phone_e164, discoverable, verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, phoneE164, now, now, now));
  }
  if (trialSellerId) {
    statements.push(
      database().prepare(
        `INSERT INTO activations (id, user_id, seller_id, credits_charged, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      ).bind(crypto.randomUUID(), id, trialSellerId, now),
      database().prepare(
        `INSERT INTO client_crm_profiles (
          user_id, crm_status, client_type, category, tags_json, notes,
          last_activity_at, updated_by, updated_at
        ) VALUES (?, 'new', 'individual', 'general', '[]', '', ?, ?, ?)`,
      ).bind(id, now, id, now),
    );
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
    database().prepare(
      `UPDATE password_reset_requests
       SET status = 'cancelled'
       WHERE user_id = (
         SELECT user_id FROM password_reset_tokens WHERE id = ? AND consumed_by = ? LIMIT 1
       ) AND status = 'approved'`,
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
  const duplicate = isUniqueConstraintError(message);
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
