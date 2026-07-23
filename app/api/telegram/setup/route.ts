import {
  authEnv,
  bootstrapIsEnabled,
  enforceAuthRateLimits,
  publicAppBaseUrl,
  requestIpRateLimitSubject,
  routeError,
} from "@/app/lib/auth-server";
import { writeSecurityEvent } from "@/app/lib/security-log";
import { sameSecret } from "@/app/lib/telegram-manager";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!bootstrapIsEnabled()) return Response.json(
      { ok: false, error: "Ruta no disponible." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
    const env = authEnv();
    await enforceAuthRateLimits([
      {
        bucket: "telegram-setup-ip",
        subject: requestIpRateLimitSubject(request),
        limit: 5,
        windowSeconds: 60 * 60,
      },
    ]);
    const authorization = request.headers.get("authorization") ?? "";
    const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!env.AUTH_BOOTSTRAP_SECRET || !supplied || !(await sameSecret(supplied, env.AUTH_BOOTSTRAP_SECRET))) {
      writeSecurityEvent(request, "telegram.webhook_setup", "denied", { reason: "authentication" });
      return Response.json(
        { ok: false, error: "Acceso no autorizado." },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
      return Response.json(
        { ok: false, error: "La integración de Telegram no está configurada." },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    const webhookUrl = new URL("/api/telegram/webhook", publicAppBaseUrl(request)).toString();
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "edited_message"],
        drop_pending_updates: true,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 16 * 1024) {
      writeSecurityEvent(request, "telegram.webhook_setup", "failure", { reason: "oversized_response" });
      return Response.json(
        { ok: false, error: "Telegram rechazó la configuración." },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > 16 * 1024) {
      writeSecurityEvent(request, "telegram.webhook_setup", "failure", { reason: "oversized_response" });
      return Response.json(
        { ok: false, error: "Telegram rechazó la configuración." },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
    let result: { ok?: boolean };
    try {
      result = JSON.parse(responseText) as { ok?: boolean };
    } catch {
      result = {};
    }
    if (!response.ok || !result.ok) {
      writeSecurityEvent(request, "telegram.webhook_setup", "failure", { reason: "provider_rejected" });
      return Response.json(
        { ok: false, error: "Telegram rechazó la configuración." },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
    writeSecurityEvent(request, "telegram.webhook_setup", "success");
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
