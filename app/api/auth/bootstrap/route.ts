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
  hashSecret,
  requestIpRateLimitSubject,
  routeError,
  secureCompare,
  validateDisplayName,
  validateOptionalEmail,
  validateSellerCode,
  validateUsername,
} from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!bootstrapIsEnabled()) return jsonError("Ruta no disponible.", 404);
    await ensureAuthSchema();
    await enforceAuthRateLimits([
      {
        bucket: "bootstrap-ip",
        subject: requestIpRateLimitSubject(request),
        limit: 5,
        windowSeconds: 60 * 60,
      },
    ]);
    const body = await readJson(request);
    const secret = asString(body.secret);
    const sellerCode = asString(body.sellerCode);
    const username = asString(body.username);
    const password = asString(body.password);
    const requestedDisplayName = asString(body.displayName).trim();
    const requestedEmail = asString(body.email).trim().toLowerCase();
    const displayName = requestedDisplayName || "Administrador";
    const configuredSecret = authEnv().AUTH_BOOTSTRAP_SECRET;
    const ownerTelegramId = configuredOwnerTelegramId();

    if (!configuredSecret || configuredSecret.length < 32) {
      return jsonError("La configuración segura del administrador está incompleta.", 503);
    }
    if (!ownerTelegramId) return jsonError("La identidad del propietario no está configurada.", 503);
    if (!(await secureCompare(secret, configuredSecret))) return jsonError("Clave de configuracion invalida.", 403);
    if (sellerCode !== ownerTelegramId) {
      return jsonError("El administrador principal debe usar el Telegram ID autorizado.");
    }
    if (!/^\d{6}$/u.test(password)) {
      return jsonError("El codigo de administrador debe tener exactamente 6 digitos.");
    }
    if (!validateSellerCode(sellerCode) || !validateUsername(username)) {
      return jsonError("Datos de administrador invalidos.");
    }
    if (!validateDisplayName(displayName) || !validateOptionalEmail(requestedEmail)) {
      return jsonError("Datos de administrador invalidos.");
    }

    const existingAdmin = await dbBinding().prepare(
      `SELECT id, display_name, email
       FROM users
       WHERE role = 'admin' AND deleted_at IS NULL
         AND (is_owner = 1 OR telegram_user_id = ?)
       ORDER BY is_owner DESC, created_at ASC LIMIT 1`,
    ).bind(ownerTelegramId).first<{ id: string; display_name: string; email: string }>();
    if (existingAdmin) {
      const [hashedPassword, hashedPin] = await Promise.all([hashSecret(password), hashSecret(password)]);
      const now = new Date().toISOString();
      await dbBinding().batch([
        dbBinding().prepare(
          `UPDATE users SET
             seller_code = ?, username = ?, display_name = ?, email = ?,
             password_hash = ?, password_salt = ?, pin_hash = ?, pin_salt = ?,
             telegram_user_id = ?, status = 'active', must_change_password = 0,
             must_set_pin = 0, is_owner = 1, owner_id = NULL, deleted_at = NULL, updated_at = ?
           WHERE id = ? AND role = 'admin'`,
        ).bind(
          sellerCode,
          username.trim().toLowerCase(),
          requestedDisplayName || existingAdmin.display_name,
          requestedEmail || existingAdmin.email,
          hashedPassword.hash,
          hashedPassword.salt,
          hashedPin.hash,
          hashedPin.salt,
          sellerCode,
          now,
          existingAdmin.id,
        ),
        dbBinding().prepare("DELETE FROM sessions WHERE user_id = ?").bind(existingAdmin.id),
      ]);
      const cookie = await createSession(request, existingAdmin.id, { unlocked: true });
      const user = await findLoginUser(sellerCode, username);
      return jsonOk(
        { user: user ? { id: user.id, role: user.role, isOwner: true, username: user.username, displayName: user.display_name } : null },
        { headers: { "cache-control": "no-store", "set-cookie": cookie } },
      );
    }

    const id = await createUser({
      sellerCode,
      username,
      displayName,
      email: asString(body.email),
      password,
      role: "admin",
      isOwner: true,
      status: "active",
      credits: 0,
      telegramUserId: sellerCode,
      pin: password,
    });
    const cookie = await createSession(request, id, { unlocked: true });
    const user = await findLoginUser(sellerCode, username);
    return jsonOk(
      { user: user ? { id: user.id, role: user.role, isOwner: true, username: user.username, displayName: user.display_name } : null },
      { headers: { "cache-control": "no-store", "set-cookie": cookie } },
    );
  } catch (error) {
    return routeError(error);
  }
}
