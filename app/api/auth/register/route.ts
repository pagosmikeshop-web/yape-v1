import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  createSession,
  createUniqueReferralCode,
  createUser,
  dbBinding,
  enforceAuthRateLimits,
  linkTelegramIdentity,
  publicSha256,
  requestIpRateLimitSubject,
  routeError,
  safeUser,
  SELF_REGISTRATION_SELLER_CODE,
  validateDisplayName,
  validateOptionalEmail,
  validatePassword,
  validateUsername,
  type UserRow,
} from "@/app/lib/auth-server";
import {
  checkCurrentTelegramGroupMember,
  telegramMembershipError,
} from "@/app/lib/telegram-manager";
import {
  activateClientTrial,
  TELEGRAM_TRIAL_SELLER_ID,
} from "@/app/lib/trial-activation";

export const dynamic = "force-dynamic";

function cleanTelegramId(value: string) {
  const normalized = value.trim();
  return /^\d{4,24}$/u.test(normalized) ? normalized : "";
}

function normalizeReferralCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "").slice(0, 16);
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const telegramUserId = cleanTelegramId(asString(body.telegramUserId));
    const fingerprintId = asString(body.fingerprintId).trim();
    const username = asString(body.username);
    const displayName = asString(body.displayName).trim();
    const email = asString(body.email).trim();
    const password = asString(body.password);
    const pin = asString(body.pin).replace(/\D/gu, "");
    const phone = asString(body.phone).replace(/\D/gu, "");
    const referralCode = normalizeReferralCode(asString(body.referralCode));

    await enforceAuthRateLimits([
      { bucket: "register-ip", subject: await requestIpRateLimitSubject(request), limit: 8, windowSeconds: 60 * 60 },
      { bucket: "register-telegram", subject: telegramUserId || "missing", limit: 5, windowSeconds: 60 * 60 },
    ]);

    if (!telegramUserId) return jsonError("Ingresa tu Telegram ID.");
    if (!/^[A-Za-z0-9_-]{8,128}$/u.test(fingerprintId)) {
      return jsonError("No se pudo validar este dispositivo.", 403);
    }
    if (!validateUsername(username)) return jsonError("El usuario debe tener 3 a 40 caracteres.");
    if (!validateDisplayName(displayName)) return jsonError("Ingresa tu nombre completo.");
    if (!validateOptionalEmail(email)) return jsonError("Ingresa un correo válido.");
    if (!validatePassword(password)) return jsonError("La contrasena debe tener entre 8 y 128 caracteres.");
    if (!/^\d{6}$/u.test(pin)) return jsonError("La clave de ingreso debe tener exactamente 6 digitos.");

    const fingerprintHash = await publicSha256(`fingerprintjs-v3\n${fingerprintId}`);
    const database = dbBinding();
    const [telegramCheck, existingTelegram, existingDevice, existingUser] = await Promise.all([
      checkCurrentTelegramGroupMember(telegramUserId),
      database.prepare(
        "SELECT id FROM users WHERE telegram_user_id = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(telegramUserId).first(),
      database.prepare(
        "SELECT id FROM users WHERE fingerprint_id_hash = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(fingerprintHash).first(),
      database.prepare(
        "SELECT id FROM users WHERE seller_code = ? AND username = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(SELF_REGISTRATION_SELLER_CODE, username.trim().toLowerCase()).first(),
    ]);

    if (!telegramCheck.member) {
      // AUTH-002 (mitigación parcial): re-verificamos membresía en el servidor.
      // Limitación residual: el cliente envía el Telegram ID; sin Login Widget / deep-link OTP
      // no demostramos posesión del ID (solo que ese ID es miembro del grupo).
      // TODO(AUTH-002): Telegram Login Widget o challenge one-time del bot para binding fuerte.
      return jsonError(
        `${telegramMembershipError(telegramCheck)} Solo se aceptan IDs que pertenezcan al grupo; aún así, asegúrate de usar tu propio Telegram ID.`,
        403,
      );
    }
    if (existingTelegram) {
      return jsonError("Ese Telegram ID ya tiene una cuenta. Inicia sesión o recupera tu acceso.", 409);
    }
    if (existingDevice) {
      return jsonError("Este dispositivo ya tiene una cuenta registrada. Usa otro dispositivo o contacta soporte.", 409);
    }
    if (existingUser) {
      return jsonError("Ese nombre de usuario ya está en uso. Elige otro.", 409);
    }

    const referrer = referralCode
      ? await database.prepare("SELECT id FROM users WHERE referral_code = ? LIMIT 1").bind(referralCode).first<{ id: string }>()
      : null;
    const newReferralCode = await createUniqueReferralCode();
    const id = await createUser({
      sellerCode: SELF_REGISTRATION_SELLER_CODE,
      username,
      displayName,
      email,
      password,
      phone,
      pin,
      role: "client",
      ownerId: null,
      status: "pending",
      fingerprintIdHash: fingerprintHash,
      telegramUserId,
      referralCode: newReferralCode,
      referredByUserId: referrer?.id ?? null,
      mustChangePassword: false,
    });

    const trial = await activateClientTrial({
      userId: id,
      sellerId: TELEGRAM_TRIAL_SELLER_ID,
      updatedBy: id,
    });
    if (!trial.ok || !trial.activated) {
      // Evita dejar cuentas "pending" huérfanas que en el panel piden Activar 3 días.
      const now = new Date().toISOString();
      const deletedLogin = `deleted_${id.replace(/-/gu, "").slice(0, 12)}`;
      try {
        await database.batch([
          database.prepare("DELETE FROM activations WHERE user_id = ?").bind(id),
          database.prepare("DELETE FROM client_crm_profiles WHERE user_id = ?").bind(id),
          database.prepare("DELETE FROM payment_directory WHERE user_id = ?").bind(id),
          database.prepare(
            `UPDATE users SET seller_code = ?, username = ?, display_name = 'Usuario eliminado', email = '',
               status = 'disabled', fingerprint_id_hash = NULL, telegram_user_id = NULL,
               referral_code = NULL, referred_by_user_id = NULL, access_expires_at = NULL,
               deleted_at = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL`,
          ).bind(deletedLogin, deletedLogin.toLowerCase(), now, now, id),
        ]);
      } catch {
        // Si el rollback falla, el error de trial sigue siendo la respuesta principal.
      }
      return jsonError("No se pudo activar la prueba gratuita. Intenta registrarte de nuevo o contacta soporte.", 500);
    }

    try {
      await linkTelegramIdentity(id, telegramUserId);
    } catch {
      // La unicidad de telegram_identities puede fallar si ya existe; users.telegram_user_id ya está ligado.
    }

    const userRow = await database.prepare(
      "SELECT * FROM users WHERE id = ? LIMIT 1",
    ).bind(id).first<UserRow>();
    if (!userRow) {
      return jsonError("No se pudo completar el registro.", 500);
    }

    const cookie = await createSession(request, id, { unlocked: true });
    const mapped = safeUser(userRow);

    return jsonOk({
      user: {
        ...mapped,
        loginId: telegramUserId,
        status: "active",
        referralCode: newReferralCode,
        accessExpiresAt: trial.accessExpiresAt,
      },
      accessExpiresAt: trial.accessExpiresAt,
      message: "Registro completado. Validamos que perteneces al grupo y activamos tus 3 días gratuitos.",
    }, {
      status: 201,
      headers: { "cache-control": "no-store", "set-cookie": cookie },
    });
  } catch (error) {
    return routeError(error);
  }
}
