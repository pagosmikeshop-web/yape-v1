import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  authEnv,
  bootstrapIsEnabled,
  configuredOwnerTelegramId,
  createSession,
  createUser,
  dbBinding,
  enforceAuthRateLimits,
  ensureAuthSchema,
  findLoginUser,
  requestIpRateLimitSubject,
  routeError,
  secureCompare,
  validateDisplayName,
  validateOptionalEmail,
  validateSellerCode,
  validateUsername,
} from "@/app/lib/auth-server";
import { writeSecurityEvent } from "@/app/lib/security-log";

export const dynamic = "force-dynamic";

function strongOwnerPassword(value: string) {
  return value.length >= 12
    && value.length <= 128
    && /[a-z]/u.test(value)
    && /[A-Z]/u.test(value)
    && /\d/u.test(value)
    && /[^A-Za-z0-9]/u.test(value);
}

export async function POST(request: Request) {
  try {
    if (!bootstrapIsEnabled()) return jsonError("Ruta no disponible.", 404);
    await ensureAuthSchema();
    await enforceAuthRateLimits([{
      bucket: "bootstrap-ip",
      subject: await requestIpRateLimitSubject(request),
      limit: 5,
      windowSeconds: 60 * 60,
    }]);

    const body = await readJson(request);
    const secret = asString(body.secret);
    const sellerCode = asString(body.sellerCode);
    const username = asString(body.username);
    const password = asString(body.password);
    const pin = asString(body.pin).replace(/\D/gu, "");
    const requestedDisplayName = asString(body.displayName).trim();
    const requestedEmail = asString(body.email).trim().toLocaleLowerCase("es-PE");
    const displayName = requestedDisplayName || "Administrador";
    const configuredSecret = authEnv().AUTH_BOOTSTRAP_SECRET;
    const ownerTelegramId = configuredOwnerTelegramId();

    if (!configuredSecret || configuredSecret.length < 32) {
      return jsonError("La configuración segura del administrador está incompleta.", 503);
    }
    if (!ownerTelegramId) {
      return jsonError("La identidad del propietario no está configurada.", 503);
    }
    if (!(await secureCompare(secret, configuredSecret))) {
      writeSecurityEvent(request, "auth.bootstrap", "denied", { reason: "invalid_secret" });
      return jsonError("Clave de configuración inválida.", 403);
    }
    if (sellerCode !== ownerTelegramId) {
      return jsonError("El Owner debe usar el Telegram ID autorizado.");
    }
    if (!strongOwnerPassword(password)) {
      return jsonError(
        "La contraseña debe tener al menos 12 caracteres, mayúscula, minúscula, número y símbolo.",
      );
    }
    if (!/^\d{6}$/u.test(pin)) return jsonError("El PIN debe tener exactamente 6 dígitos.");
    if (password === pin) return jsonError("La contraseña y el PIN deben ser diferentes.");
    if (!validateSellerCode(sellerCode) || !validateUsername(username)) {
      return jsonError("Datos de administrador inválidos.");
    }
    if (!validateDisplayName(displayName) || !validateOptionalEmail(requestedEmail)) {
      return jsonError("Datos de administrador inválidos.");
    }

    const existingOwner = await dbBinding().prepare(
      `SELECT id FROM users
       WHERE role = 'admin' AND deleted_at IS NULL
         AND (is_owner = 1 OR telegram_user_id = ?)
       LIMIT 1`,
    ).bind(ownerTelegramId).first<{ id: string }>();
    if (existingOwner) {
      writeSecurityEvent(request, "auth.bootstrap", "denied", {
        reason: "owner_exists",
        actorId: existingOwner.id,
      });
      return jsonError(
        "La cuenta Owner ya existe. Usa el inicio de sesión o el flujo de recuperación.",
        409,
      );
    }

    const id = await createUser({
      sellerCode,
      username,
      displayName,
      email: requestedEmail,
      password,
      role: "admin",
      isOwner: true,
      status: "active",
      credits: 0,
      telegramUserId: sellerCode,
      pin,
    });
    const cookie = await createSession(request, id, { unlocked: true });
    const user = await findLoginUser(sellerCode, username);
    writeSecurityEvent(request, "auth.bootstrap", "success", { actorId: id });
    return jsonOk(
      {
        user: user
          ? {
            id: user.id,
            role: user.role,
            isOwner: true,
            username: user.username,
            displayName: user.display_name,
          }
          : null,
      },
      { headers: { "cache-control": "no-store", "set-cookie": cookie } },
    );
  } catch (error) {
    return routeError(error);
  }
}
