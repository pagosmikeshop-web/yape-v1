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
  validatePassword,
  validateUsername,
  trialExpiresAt,
  type UserRow,
} from "@/app/lib/auth-server";
import {
  checkCurrentTelegramGroupMember,
  telegramMembershipError,
  telegramMembershipIsUnavailable,
} from "@/app/lib/telegram-manager";
import { TELEGRAM_TRIAL_SELLER_ID } from "@/app/lib/trial-activation";

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
    const password = asString(body.password);
    const pin = asString(body.pin).replace(/\D/gu, "");
    const phone = asString(body.phone).replace(/\D/gu, "");
    const referralCode = normalizeReferralCode(asString(body.referralCode));

    await enforceAuthRateLimits([
      {
        bucket: "register-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 8,
        windowSeconds: 60 * 60,
      },
      {
        bucket: "register-telegram",
        subject: telegramUserId || "missing",
        limit: 5,
        windowSeconds: 60 * 60,
      },
    ]);

    if (!telegramUserId) return jsonError("Ingresa tu Telegram ID.");
    if (!/^[A-Za-z0-9_-]{8,128}$/u.test(fingerprintId)) {
      return jsonError("No se pudo validar este dispositivo.", 403);
    }
    if (!validateUsername(username)) return jsonError("El usuario debe tener de 3 a 40 caracteres.");
    if (!validateDisplayName(displayName)) return jsonError("Ingresa tu nombre completo.");
    if (!validatePassword(password)) return jsonError("La contraseña debe tener entre 8 y 128 caracteres.");
    if (!/^\d{6}$/u.test(pin)) {
      return jsonError("La clave de ingreso debe tener exactamente 6 dígitos.");
    }

    const fingerprintHash = await publicSha256(`fingerprintjs-v3\n${fingerprintId}`);
    const database = dbBinding();
    const [telegramCheck, existingTelegram, existingUser] = await Promise.all([
      checkCurrentTelegramGroupMember(telegramUserId),
      database.prepare(
        "SELECT id FROM users WHERE telegram_user_id = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(telegramUserId).first(),
      database.prepare(
        "SELECT id FROM users WHERE seller_code = ? AND username = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(
        SELF_REGISTRATION_SELLER_CODE,
        username.trim().toLocaleLowerCase("es-PE"),
      ).first(),
    ]);

    if (!telegramCheck.member) {
      return jsonError(
        telegramMembershipError(telegramCheck),
        telegramMembershipIsUnavailable(telegramCheck) ? 503 : 403,
      );
    }
    if (existingTelegram) {
      return jsonError("Ese Telegram ID ya tiene una cuenta. Inicia sesión o recupera tu acceso.", 409);
    }
    if (existingUser) return jsonError("Ese nombre de usuario ya está en uso. Elige otro.", 409);

    const referrer = referralCode
      ? await database.prepare(
        "SELECT id FROM users WHERE referral_code = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(referralCode).first<{ id: string }>()
      : null;
    const newReferralCode = await createUniqueReferralCode();
    const accessExpiresAt = trialExpiresAt();

    const id = await createUser({
      sellerCode: SELF_REGISTRATION_SELLER_CODE,
      username,
      displayName,
      email: "",
      password,
      phone,
      pin,
      role: "client",
      ownerId: null,
      status: "active",
      fingerprintIdHash: fingerprintHash,
      telegramUserId,
      referralCode: newReferralCode,
      referredByUserId: referrer?.id ?? null,
      accessExpiresAt,
      mustChangePassword: false,
      trialSellerId: TELEGRAM_TRIAL_SELLER_ID,
    });

    try {
      await linkTelegramIdentity(id, telegramUserId);
    } catch {
      // users.telegram_user_id es la fuente de autoridad; esta tabla auxiliar
      // puede contener una identidad histórica y se concilia por administración.
    }
    const userRow = await database.prepare(
      "SELECT * FROM users WHERE id = ? LIMIT 1",
    ).bind(id).first<UserRow>();
    if (!userRow) return jsonError("No se pudo completar el registro.", 500);

    const cookie = await createSession(request, id, { unlocked: true });
    return jsonOk({
      user: {
        ...safeUser(userRow),
        loginId: telegramUserId,
        status: "active",
        referralCode: newReferralCode,
        accessExpiresAt,
      },
      accessExpiresAt,
      message: "Registro completado. Confirmamos tu Telegram y activamos tus 3 días gratuitos.",
    }, {
      status: 201,
      headers: { "cache-control": "no-store", "set-cookie": cookie },
    });
  } catch (error) {
    return routeError(error);
  }
}
