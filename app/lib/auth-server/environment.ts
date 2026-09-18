export type AuthEnv = {
  DB?: D1Database;
  DATABASE_PROVIDER?: string;
  SUPABASE_DATABASE_URL?: string;
  APP_ENV?: string;
  ADMIN_WEB_URL?: string;
  ADMIN_PROXY_SECRET?: string;
  TOKEN_ENCRYPTION_SECRET?: string;
  PUBLIC_APP_URL?: string;
  PUBLIC_APP_ALLOWED_ORIGINS?: string;
  AUTH_BOOTSTRAP_ENABLED?: string;
  AUTH_BOOTSTRAP_SECRET?: string;
  AUTH_OWNER_PASSWORD_RESET_ENABLED?: string;
  AUTH_OWNER_TELEGRAM_ID?: string;
  AUTH_RATE_LIMIT_PEPPER?: string;
  RATE_LIMIT_REDIS_URL?: string;
  RATE_LIMIT_REDIS_TOKEN?: string;
  KV_REST_API_URL?: string;
  KV_REST_API_TOKEN?: string;
  AUTH_UNLOCK_IDLE_MINUTES?: string;
  CRON_SECRET?: string;
  ACCOUNT_SMS_VALIDATION_TOKEN?: string;
  ACCOUNT_AUTO_VALIDATION_TOKEN?: string;
  INFOBIP_API_KEY?: string;
  INFOBIP_BASE_URL?: string;
  INFOBIP_SENDER?: string;
  /** Legacy single-bot token. Used as a fallback during the two-bot migration. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Bot used exclusively for getChatMember membership checks. */
  TELEGRAM_MEMBERSHIP_BOT_TOKEN?: string;
  /** Bot that receives /redeem and /me commands through the webhook. */
  TELEGRAM_COMMAND_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Secret for the command bot webhook; falls back to TELEGRAM_WEBHOOK_SECRET. */
  TELEGRAM_COMMAND_WEBHOOK_SECRET?: string;
  TELEGRAM_WEBHOOK_DIAGNOSTICS?: string;
  TELEGRAM_ADMIN_IDS?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_SUPPORT_USERNAME?: string;
  TELEGRAM_SUPPORT_USER_ID?: string;
  TELEGRAM_REQUIRED_GROUP_ID?: string;
  TELEGRAM_GROUP_INVITE_URL?: string;
  RECIPIENT_LOOKUP_PROVIDER?: string;
  RECIPIENT_LOOKUP_API_BASE_URL?: string;
  RECIPIENT_LOOKUP_API_TOKEN?: string;
};

export const SESSION_DAYS = 30;
const LOCAL_SESSION_COOKIE = "yape_session";
const SECURE_SESSION_COOKIE = "__Host-yape_session";
const DEFAULT_UNLOCK_IDLE_MINUTES = 5;

export function authEnv() {
  const globals = globalThis as typeof globalThis & {
    __YAPE_ENV?: AuthEnv;
    __MI_BANCO_ENV?: AuthEnv;
    process?: { env?: Record<string, string | undefined> };
  };
  return globals.__YAPE_ENV ?? globals.__MI_BANCO_ENV ?? (globals.process?.env as AuthEnv | undefined) ?? {};
}

export function isHostedEnvironment() {
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
  /* Fail-closed: solo se habilita con AUTH_BOOTSTRAP_ENABLED=true explícito. */
  return configured === "true";
}

export function publicAppBaseUrl(request: Request) {
  const configured = authEnv().PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || isLocalUrl(url)) {
        const allowedOrigins = new Set([url.origin]);
        for (const candidate of authEnv().PUBLIC_APP_ALLOWED_ORIGINS?.split(",") ?? []) {
          try {
            const allowed = new URL(candidate.trim());
            if (allowed.protocol === "https:") allowedOrigins.add(allowed.origin);
          } catch {
            // Las entradas inválidas nunca amplían los orígenes permitidos.
          }
        }

        const requestOrigin = new URL(request.url).origin;
        return allowedOrigins.has(requestOrigin) ? requestOrigin : url.origin;
      }
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

export function unlockIdleMinutes() {
  const configured = authEnv().AUTH_UNLOCK_IDLE_MINUTES?.trim();
  if (!configured) return DEFAULT_UNLOCK_IDLE_MINUTES;
  const minutes = Number(configured);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > SESSION_DAYS * 24 * 60) {
    throw new Error("Invalid AUTH_UNLOCK_IDLE_MINUTES configuration.");
  }
  return minutes;
}

export function sessionCookieName(request: Request) {
  return new URL(request.url).protocol === "https:" ? SECURE_SESSION_COOKIE : LOCAL_SESSION_COOKIE;
}
