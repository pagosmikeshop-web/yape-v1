import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  createUniqueReferralCode,
  createUser,
  dbBinding,
  enforceAuthRateLimits,
  publicSha256,
  requestIpRateLimitSubject,
  routeError,
  SELF_REGISTRATION_SELLER_CODE,
  validateDisplayName,
  validateOptionalEmail,
  validatePassword,
  validateUsername,
} from "@/app/lib/auth-server";
import { isCurrentTelegramGroupMember } from "@/app/lib/telegram-manager";

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
      { bucket: "register-ip", subject: requestIpRateLimitSubject(request), limit: 8, windowSeconds: 60 * 60 },
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
    const [groupMember, existingTelegram, existingDevice, existingUser] = await Promise.all([
      isCurrentTelegramGroupMember(telegramUserId),
      database.prepare("SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1").bind(telegramUserId).first(),
      database.prepare("SELECT id FROM users WHERE fingerprint_id_hash = ? LIMIT 1").bind(fingerprintHash).first(),
      database.prepare("SELECT id FROM users WHERE seller_code = ? AND username = ? LIMIT 1")
        .bind(SELF_REGISTRATION_SELLER_CODE, username.trim().toLowerCase()).first(),
    ]);

    if (!groupMember) return jsonError("Primero entra al grupo de Telegram para habilitar tu registro.", 403);
    if (existingTelegram || existingDevice || existingUser) {
      return jsonError("No se pudo crear la cuenta con esos datos.", 409);
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

    return jsonOk({
      user: { id, sellerCode: SELF_REGISTRATION_SELLER_CODE, username: username.trim().toLowerCase(), displayName, status: "pending", referralCode: newReferralCode },
      message: "Cuenta creada. Queda pendiente de aprobacion para iniciar sesion.",
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
