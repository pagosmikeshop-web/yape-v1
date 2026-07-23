import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  completePasswordReset,
  enforceAuthRateLimits,
  requestIpRateLimitSubject,
  routeError,
  validatePassword,
} from "@/app/lib/auth-server";
import { writeSecurityEvent } from "@/app/lib/security-log";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const requestId = asString(body.requestId).trim();
    const token = asString(body.resetToken).trim();
    const newPassword = asString(body.newPassword);

    await enforceAuthRateLimits([
      {
        bucket: "reset-ip",
        subject: requestIpRateLimitSubject(request),
        limit: 20,
        windowSeconds: 60 * 60,
      },
      {
        bucket: "reset-complete-token",
        subject: requestId || "missing",
        limit: 5,
        windowSeconds: 15 * 60,
      },
    ]);

    if (!validatePassword(newPassword)) {
      writeSecurityEvent(request, "auth.password_reset.complete", "denied", { reason: "password_policy" });
      return jsonError("La nueva contrasena debe tener entre 8 y 128 caracteres.");
    }
    if (requestId.length < 16 || requestId.length > 80 || token.length < 32 || token.length > 128) {
      writeSecurityEvent(request, "auth.password_reset.complete", "denied", { reason: "invalid_challenge" });
      return jsonError("El enlace de restablecimiento no es valido o ya vencio.", 400);
    }

    const completed = await completePasswordReset({ requestId, token, newPassword });
    if (!completed) {
      writeSecurityEvent(request, "auth.password_reset.complete", "denied", { reason: "invalid_challenge" });
      return jsonError("El enlace de restablecimiento no es valido o ya vencio.", 400);
    }
    writeSecurityEvent(request, "auth.password_reset.complete", "success");

    return jsonOk(
      { message: "Contrasena actualizada. Inicia sesion nuevamente en este dispositivo." },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
