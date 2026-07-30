import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  authEnv,
  configuredOwnerTelegramId,
  dbBinding,
  enforceAuthRateLimits,
  ensureAuthSchema,
  hashSecret,
  requestIpRateLimitSubject,
  routeError,
  secureCompare,
  validatePassword,
} from "@/app/lib/auth-server";
import { writeSecurityEvent } from "@/app/lib/security-log";

export const dynamic = "force-dynamic";

const RESET_CONFIRMATION = "RESTABLECER OWNER";

function resetIsEnabled() {
  return authEnv().AUTH_OWNER_PASSWORD_RESET_ENABLED?.trim().toLowerCase() === "true";
}

function strongOwnerPassword(value: string) {
  return value.length >= 12
    && value.length <= 128
    && validatePassword(value)
    && /[a-z]/u.test(value)
    && /[A-Z]/u.test(value)
    && /\d/u.test(value)
    && /[^A-Za-z0-9]/u.test(value);
}

/**
 * Recuperación temporal del Owner.
 *
 * Esta ruta permanece cerrada salvo que AUTH_OWNER_PASSWORD_RESET_ENABLED=true.
 * No revela si existe un usuario Owner y nunca devuelve ni registra secretos.
 * Después de actualizar la contraseña revoca todas las sesiones para obligar
 * a iniciar sesión de nuevo con la credencial nueva.
 */
export async function POST(request: Request) {
  try {
    if (!resetIsEnabled()) return jsonError("Ruta no disponible.", 404);

    await ensureAuthSchema();
    await enforceAuthRateLimits([{
      bucket: "owner-password-reset-ip",
      subject: await requestIpRateLimitSubject(request),
      limit: 5,
      windowSeconds: 60 * 60,
    }]);

    const body = await readJson(request);
    const secret = asString(body.secret);
    const telegramId = asString(body.telegramId).trim();
    const newPassword = asString(body.newPassword);
    const confirmPassword = asString(body.confirmPassword);
    const confirmation = asString(body.confirmation).trim().toUpperCase();
    const configuredSecret = authEnv().AUTH_BOOTSTRAP_SECRET?.trim() ?? "";
    const ownerTelegramId = configuredOwnerTelegramId();

    if (configuredSecret.length < 32 || !ownerTelegramId) {
      return jsonError("La recuperación temporal no está configurada.", 503);
    }

    await enforceAuthRateLimits([{
      bucket: "owner-password-reset-account",
      subject: ownerTelegramId,
      limit: 3,
      windowSeconds: 60 * 60,
    }]);

    if (
      !(await secureCompare(secret, configuredSecret))
      || telegramId !== ownerTelegramId
      || confirmation !== RESET_CONFIRMATION
    ) {
      writeSecurityEvent(request, "auth.owner_password_reset", "denied", {
        reason: "invalid_confirmation",
      });
      return jsonError("No se pudo validar la recuperación temporal.", 403);
    }

    if (newPassword !== confirmPassword || !strongOwnerPassword(newPassword)) {
      return jsonError(
        "La nueva contraseña debe tener 12 caracteres e incluir mayúscula, minúscula, número y símbolo; ambas deben coincidir.",
      );
    }

    const owner = await dbBinding().prepare(
      `SELECT id FROM users
       WHERE role = 'admin'
         AND is_owner = 1
         AND telegram_user_id = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    ).bind(ownerTelegramId).first<{ id: string }>();

    if (!owner) {
      writeSecurityEvent(request, "auth.owner_password_reset", "denied", {
        reason: "owner_not_found",
      });
      return jsonError("No se pudo validar la recuperación temporal.", 403);
    }

    const hashed = await hashSecret(newPassword);
    const now = new Date().toISOString();
    const database = dbBinding();
    await database.batch([
      database.prepare(
        `UPDATE users
         SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ?
         WHERE id = ? AND role = 'admin' AND is_owner = 1`,
      ).bind(hashed.hash, hashed.salt, now, owner.id),
      database.prepare("DELETE FROM sessions WHERE user_id = ?").bind(owner.id),
      database.prepare(
        `UPDATE password_reset_tokens
         SET used_at = ?, consumed_by = 'owner_password_reset'
         WHERE user_id = ? AND used_at IS NULL`,
      ).bind(now, owner.id),
    ]);

    writeSecurityEvent(request, "auth.owner_password_reset", "success", {
      actorId: owner.id,
    });
    return jsonOk(
      { message: "Contraseña actualizada. Inicia sesión nuevamente." },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
