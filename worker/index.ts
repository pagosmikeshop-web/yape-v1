/** Cloudflare Worker entry point for Yape. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  APP_ENV?: string;
  ALLOW_CLIENT_BALANCE_EDIT?: string;
  PUBLIC_APP_URL?: string;
  ADMIN_WEB_URL?: string;
  ADMIN_PROXY_SECRET?: string;
  AUTH_BOOTSTRAP_ENABLED?: string;
  AUTH_BOOTSTRAP_SECRET?: string;
  AUTH_OWNER_TELEGRAM_ID?: string;
  AUTH_RATE_LIMIT_PEPPER?: string;
  AUTH_SESSION_IDLE_MINUTES?: string;
  ACCOUNT_SMS_VALIDATION_TOKEN?: string;
  ACCOUNT_AUTO_VALIDATION_TOKEN?: string;
  QR_CONTACTS_ENCRYPTION_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ADMIN_IDS?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_SUPPORT_USERNAME?: string;
  TELEGRAM_SUPPORT_USER_ID?: string;
  TELEGRAM_REQUIRED_GROUP_ID?: string;
  TELEGRAM_GROUP_INVITE_URL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const BLOCKED_METHODS = new Set(["TRACE", "TRACK", "CONNECT"]);
const HOSTED_ENVIRONMENTS = new Set(["staging", "production"]);
const PROTECTED_PAGE_PREFIXES = [
  "/inicio",
  "/perfil",
  "/datos-cuenta",
  "/movimientos",
  "/transferir",
  "/mi-qr",
  "/qr-personal",
  "/vendedor",
  "/admin",
];
const ENFORCED_CSP = [
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");
const STRICT_CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

function validHttpsOrigin(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && url.pathname === "/"
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function hostedConfigurationErrors(env: Env) {
  if (!HOSTED_ENVIRONMENTS.has(env.APP_ENV ?? "")) return [];
  const missing: string[] = [];
  const ownerTelegramId = env.AUTH_OWNER_TELEGRAM_ID?.trim() ?? "";
  if (!validHttpsOrigin(env.PUBLIC_APP_URL)) missing.push("PUBLIC_APP_URL");
  if (!validHttpsOrigin(env.ADMIN_WEB_URL)) missing.push("ADMIN_WEB_URL");
  if ((env.ADMIN_PROXY_SECRET?.trim().length ?? 0) < 32) missing.push("ADMIN_PROXY_SECRET");
  if (!/^\d{4,24}$/u.test(ownerTelegramId)) missing.push("AUTH_OWNER_TELEGRAM_ID");
  if ((env.AUTH_RATE_LIMIT_PEPPER?.trim().length ?? 0) < 32) missing.push("AUTH_RATE_LIMIT_PEPPER");
  if ((env.QR_CONTACTS_ENCRYPTION_KEY?.trim().length ?? 0) < 32) missing.push("QR_CONTACTS_ENCRYPTION_KEY");
  if ((env.TELEGRAM_WEBHOOK_SECRET?.trim().length ?? 0) < 32) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (!env.TELEGRAM_BOT_TOKEN?.trim()) missing.push("TELEGRAM_BOT_TOKEN");
  if (!env.TELEGRAM_REQUIRED_GROUP_ID?.trim()) missing.push("TELEGRAM_REQUIRED_GROUP_ID");
  if (!/^https:\/\/t\.me\/[A-Za-z0-9_+/-]+$/u.test(env.TELEGRAM_GROUP_INVITE_URL?.trim() ?? "")) {
    missing.push("TELEGRAM_GROUP_INVITE_URL");
  }
  if (
    env.AUTH_BOOTSTRAP_ENABLED === "true"
    && (env.AUTH_BOOTSTRAP_SECRET?.trim().length ?? 0) < 32
  ) missing.push("AUTH_BOOTSTRAP_SECRET");
  return missing;
}

function requestId(request: Request) {
  const cloudflareRay = request.headers.get("cf-ray")?.split("-", 1)[0]?.trim();
  return cloudflareRay && /^[A-Za-z0-9]{8,32}$/u.test(cloudflareRay)
    ? cloudflareRay
    : crypto.randomUUID();
}

function securedResponse(request: Request, response: Response, id: string) {
  const headers = new Headers(response.headers);
  const url = new URL(request.url);
  headers.set("x-request-id", id);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", ENFORCED_CSP);
  headers.set("content-security-policy-report-only", STRICT_CSP_REPORT_ONLY);
  headers.set(
    "permissions-policy",
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  );
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.delete("x-powered-by");
  headers.delete("server");

  if (url.protocol === "https:") {
    headers.set("strict-transport-security", "max-age=15552000");
  }
  if (
    url.pathname.startsWith("/api/")
    || PROTECTED_PAGE_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
    || headers.has("set-cookie")
  ) {
    headers.set("cache-control", "no-store, max-age=0");
    headers.set("pragma", "no-cache");
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/configurar-admin")) {
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function logSecurityStatus(request: Request, response: Response, id: string) {
  if (![401, 403, 429].includes(response.status) && response.status < 500) return;
  console.info("[security-http]", {
    timestamp: new Date().toISOString(),
    requestId: id,
    method: request.method,
    path: new URL(request.url).pathname,
    status: response.status,
    severity: response.status >= 500 ? "error" : response.status === 429 ? "warning" : "notice",
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const id = requestId(request);
    const url = new URL(request.url);
    const host = request.headers.get("host");
    if (host && host.toLowerCase() !== url.host.toLowerCase()) {
      return securedResponse(request, Response.json(
        { ok: false, error: "Solicitud no permitida." },
        { status: 400 },
      ), id);
    }
    if (BLOCKED_METHODS.has(request.method.toUpperCase())) {
      return securedResponse(request, Response.json(
        { ok: false, error: "Método no permitido." },
        { status: 405, headers: { allow: "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" } },
      ), id);
    }
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (!loopback && !HOSTED_ENVIRONMENTS.has(env.APP_ENV ?? "")) {
      console.error("[security] Hosted environment mode is not configured", { requestId: id });
      return securedResponse(request, Response.json(
        { ok: false, error: "El servicio no está disponible temporalmente." },
        { status: 503 },
      ), id);
    }

    const configurationErrors = hostedConfigurationErrors(env);
    if (configurationErrors.length > 0) {
      console.error("[security] Production configuration rejected", {
        requestId: id,
        missingVariables: configurationErrors,
      });
      return securedResponse(request, Response.json(
        { ok: false, error: "El servicio no está disponible temporalmente." },
        { status: 503 },
      ), id);
    }
    if (HOSTED_ENVIRONMENTS.has(env.APP_ENV ?? "")) {
      const publicUrl = new URL(env.PUBLIC_APP_URL!);
      if (url.hostname !== publicUrl.hostname || url.port !== publicUrl.port) {
        return securedResponse(request, Response.json(
          { ok: false, error: "Host no permitido." },
          { status: 421 },
        ), id);
      }
      if (url.protocol !== "https:") {
        const destination = new URL(`${url.pathname}${url.search}`, publicUrl.origin);
        return securedResponse(request, new Response(null, {
          status: 308,
          headers: { location: destination.toString(), "cache-control": "no-store" },
        }), id);
      }
    }

    (globalThis as typeof globalThis & { __YAPE_ENV?: Env }).__YAPE_ENV = env;
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-request-id", id);
    const instrumentedRequest = new Request(request, { headers: requestHeaders });

    let response: Response;
    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      response = await handleImageOptimization(instrumentedRequest, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    } else {
      response = await handler.fetch(instrumentedRequest, env, ctx);
    }

    logSecurityStatus(request, response, id);
    return securedResponse(request, response, id);
  },
};

export default worker;
