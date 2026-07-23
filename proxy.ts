import { NextRequest, NextResponse } from "next/server";

const BLOCKED_METHODS = new Set(["TRACE", "TRACK", "CONNECT"]);
const HOSTED_ENVIRONMENTS = new Set(["staging", "production"]);

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

function hostedConfigurationErrors() {
  if (!HOSTED_ENVIRONMENTS.has(process.env.APP_ENV ?? "")) return [];
  const missing: string[] = [];
  if (!process.env.TURSO_DATABASE_URL?.trim()) missing.push("TURSO_DATABASE_URL");
  if (!process.env.TURSO_AUTH_TOKEN?.trim()) missing.push("TURSO_AUTH_TOKEN");
  if (!validHttpsOrigin(process.env.PUBLIC_APP_URL)) missing.push("PUBLIC_APP_URL");
  if (!validHttpsOrigin(process.env.ADMIN_WEB_URL)) missing.push("ADMIN_WEB_URL");
  if (!/^\d{4,24}$/u.test(process.env.AUTH_OWNER_TELEGRAM_ID?.trim() ?? "")) {
    missing.push("AUTH_OWNER_TELEGRAM_ID");
  }
  if ((process.env.AUTH_RATE_LIMIT_PEPPER?.trim().length ?? 0) < 32) {
    missing.push("AUTH_RATE_LIMIT_PEPPER");
  }
  if ((process.env.QR_CONTACTS_ENCRYPTION_KEY?.trim().length ?? 0) < 32) {
    missing.push("QR_CONTACTS_ENCRYPTION_KEY");
  }
  if ((process.env.TELEGRAM_WEBHOOK_SECRET?.trim().length ?? 0) < 32) {
    missing.push("TELEGRAM_WEBHOOK_SECRET");
  }
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) missing.push("TELEGRAM_BOT_TOKEN");
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

export function proxy(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (BLOCKED_METHODS.has(request.method.toUpperCase())) {
    return jsonError("Método no permitido.", 405, requestId);
  }

  const isLoopback = request.nextUrl.hostname === "localhost"
    || request.nextUrl.hostname === "127.0.0.1"
    || request.nextUrl.hostname === "[::1]";
  const hosted = HOSTED_ENVIRONMENTS.has(process.env.APP_ENV ?? "");
  if (!isLoopback && !hosted) {
    return jsonError("El servicio no está disponible temporalmente.", 503, requestId);
  }
  if (hostedConfigurationErrors().length > 0) {
    return jsonError("El servicio no está disponible temporalmente.", 503, requestId);
  }

  if (hosted) {
    const publicUrl = new URL(process.env.PUBLIC_APP_URL!);
    if (
      request.nextUrl.hostname !== publicUrl.hostname
      || request.nextUrl.port !== publicUrl.port
    ) {
      return jsonError("Host no permitido.", 421, requestId);
    }
    if (request.nextUrl.protocol !== "https:") {
      return NextResponse.redirect(
        new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, publicUrl.origin),
        308,
      );
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
