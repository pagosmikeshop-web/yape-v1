import { NextRequest, NextResponse } from "next/server";

const BLOCKED_METHODS = new Set(["TRACE", "TRACK", "CONNECT"]);
const HOSTED_ENVIRONMENTS = new Set(["staging", "production"]);
const LOCAL_SESSION_COOKIE = "yape_session";
const SECURE_SESSION_COOKIE = "__Host-yape_session";

const PUBLIC_EXACT_PATHS = new Set([
  "/",
  "/registro",
  "/recuperar",
  "/cambiar-contrasena",
  "/cambiar-numero",
  "/activar-cuenta",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/offline.html",
  "/sw.js",
]);

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

function previewPublicAppUrl() {
  if (process.env.VERCEL_ENV !== "preview") return undefined;

  const hostname = (
    process.env.VERCEL_BRANCH_URL
    || process.env.VERCEL_URL
  )?.trim();
  return hostname ? `https://${hostname}` : undefined;
}

function configuredPublicAppUrl() {
  return previewPublicAppUrl() || process.env.PUBLIC_APP_URL;
}

function configuredPublicOrigins() {
  const previewUrl = previewPublicAppUrl();
  const candidates = previewUrl
    ? [previewUrl]
    : [
      process.env.PUBLIC_APP_URL,
      ...(process.env.PUBLIC_APP_ALLOWED_ORIGINS?.split(",") ?? []),
    ];
  const origins = new Set<string>();

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value || !validHttpsOrigin(value)) continue;
    origins.add(new URL(value).origin);
  }

  return origins;
}

function isHostedEnvironment() {
  return (
    HOSTED_ENVIRONMENTS.has(process.env.APP_ENV ?? "")
    || Boolean(previewPublicAppUrl())
  );
}

function hostedConfigurationErrors() {
  if (!isHostedEnvironment()) return [];
  const missing: string[] = [];
  const databaseProvider = process.env.DATABASE_PROVIDER?.trim().toLowerCase();
  if (databaseProvider !== "supabase") {
    missing.push("DATABASE_PROVIDER=supabase");
  } else if (!process.env.SUPABASE_DATABASE_URL?.trim()) {
    missing.push("SUPABASE_DATABASE_URL");
  }
  if (!validHttpsOrigin(configuredPublicAppUrl())) missing.push("PUBLIC_APP_URL");
  if (!validHttpsOrigin(process.env.ADMIN_WEB_URL)) missing.push("ADMIN_WEB_URL");
  if ((process.env.ADMIN_PROXY_SECRET?.trim().length ?? 0) < 32) {
    missing.push("ADMIN_PROXY_SECRET");
  }
  if (!/^\d{4,24}$/u.test(process.env.AUTH_OWNER_TELEGRAM_ID?.trim() ?? "")) {
    missing.push("AUTH_OWNER_TELEGRAM_ID");
  }
  if ((process.env.AUTH_RATE_LIMIT_PEPPER?.trim().length ?? 0) < 32) {
    missing.push("AUTH_RATE_LIMIT_PEPPER");
  }
  if ((process.env.QR_CONTACTS_ENCRYPTION_KEY?.trim().length ?? 0) < 32) {
    missing.push("QR_CONTACTS_ENCRYPTION_KEY");
  }
  const commandWebhookSecret = process.env.TELEGRAM_COMMAND_WEBHOOK_SECRET?.trim()
    || process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
    || "";
  if (commandWebhookSecret.length < 32) {
    missing.push("TELEGRAM_COMMAND_WEBHOOK_SECRET (o TELEGRAM_WEBHOOK_SECRET)");
  }
  const membershipBotToken = process.env.TELEGRAM_MEMBERSHIP_BOT_TOKEN?.trim()
    || process.env.TELEGRAM_BOT_TOKEN?.trim()
    || "";
  if (!membershipBotToken) {
    missing.push("TELEGRAM_MEMBERSHIP_BOT_TOKEN (o TELEGRAM_BOT_TOKEN)");
  }
  const commandBotToken = process.env.TELEGRAM_COMMAND_BOT_TOKEN?.trim()
    || process.env.TELEGRAM_BOT_TOKEN?.trim()
    || "";
  if (!commandBotToken) {
    missing.push("TELEGRAM_COMMAND_BOT_TOKEN (o TELEGRAM_BOT_TOKEN)");
  }
  if (!process.env.TELEGRAM_REQUIRED_GROUP_ID?.trim()) missing.push("TELEGRAM_REQUIRED_GROUP_ID");
  if (!/^https:\/\/t\.me\/[A-Za-z0-9_+/-]+$/u.test(process.env.TELEGRAM_GROUP_INVITE_URL?.trim() ?? "")) {
    missing.push("TELEGRAM_GROUP_INVITE_URL");
  }
  if (
    process.env.AUTH_BOOTSTRAP_ENABLED === "true"
    && (process.env.AUTH_BOOTSTRAP_SECRET?.trim().length ?? 0) < 32
  ) {
    missing.push("AUTH_BOOTSTRAP_SECRET");
  }
  return missing;
}

function jsonError(message: string, status: number, requestId: string) {
  const response = NextResponse.json(
    { ok: false, error: message },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  return response;
}

function isPublicPath(pathname: string) {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.startsWith("/icons/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  return false;
}

function wantsHtmlDocument(request: NextRequest) {
  if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
    return false;
  }
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

function hasSessionCookie(request: NextRequest) {
  return Boolean(
    request.cookies.get(SECURE_SESSION_COOKIE)?.value
    || request.cookies.get(LOCAL_SESSION_COOKIE)?.value,
  );
}

function contentSecurityPolicy(nonce: string) {
  const development = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const nonce = btoa(requestId);
  const csp = contentSecurityPolicy(nonce);
  if (BLOCKED_METHODS.has(request.method.toUpperCase())) {
    return jsonError("Método no permitido.", 405, requestId);
  }

  const isLoopback = request.nextUrl.hostname === "localhost"
    || request.nextUrl.hostname === "127.0.0.1"
    || request.nextUrl.hostname === "[::1]";
  // Railway's container health probe reaches the service through its private
  // host, which is intentionally not a public origin. Keep this exception
  // scoped to the read-only readiness endpoint.
  const isHealthCheck = request.method === "GET"
    && request.nextUrl.pathname === "/api/health";
  const hosted = isHostedEnvironment();
  if (!isLoopback && !hosted) {
    return jsonError("El servicio no está disponible temporalmente.", 503, requestId);
  }
  if (hostedConfigurationErrors().length > 0) {
    return jsonError("El servicio no está disponible temporalmente.", 503, requestId);
  }

  if (hosted && !isHealthCheck) {
    if (!configuredPublicOrigins().has(request.nextUrl.origin)) {
      return jsonError("Host no permitido.", 421, requestId);
    }
    if (request.nextUrl.protocol !== "https:") {
      const secureUrl = request.nextUrl.clone();
      secureUrl.protocol = "https:";
      return NextResponse.redirect(
        secureUrl,
        308,
      );
    }
  }

  // Fuera de localhost: páginas HTML protegidas requieren cookie de sesión (validación real sigue en APIs).
  if (
    !isLoopback
    && wantsHtmlDocument(request)
    && !isPublicPath(request.nextUrl.pathname)
    && !hasSessionCookie(request)
  ) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/";
    loginUrl.search = "";
    const response = NextResponse.redirect(loginUrl, 307);
    response.headers.set("x-request-id", requestId);
    response.headers.set("cache-control", "no-store");
    response.headers.set("content-security-policy", csp);
    response.headers.set(
      "x-robots-tag",
      "noindex, nofollow, noarchive, nosnippet, noimageindex",
    );
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("content-security-policy", csp);
  response.headers.set(
    "x-robots-tag",
    "noindex, nofollow, noarchive, nosnippet, noimageindex",
  );
  if (wantsHtmlDocument(request)) {
    response.headers.set("cache-control", "private, no-store, max-age=0");
  }
  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
