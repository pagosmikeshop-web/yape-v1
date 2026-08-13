import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  ensureAuthSchema,
  requestIpRateLimitSubject,
  routeError,
} from "@/app/lib/auth-server";
import {
  checkCurrentTelegramGroupMember,
  telegramMembershipError,
  telegramMembershipIsUnavailable,
} from "@/app/lib/telegram-manager";
import {
  ACCOUNT_BANNED_CODE,
  ACCOUNT_BANNED_MESSAGE,
  isTelegramAccountBanned,
} from "@/app/lib/account-blacklist";

export const dynamic = "force-dynamic";

function cleanTelegramId(value: string) {
  return value.replace(/\D/gu, "").slice(0, 24);
}

const TELEGRAM_ALREADY_REGISTERED_MESSAGE =
  "Este usuario ya está registrado. Inicia sesión para continuar.";

export async function POST(request: Request) {
  try {
    await ensureAuthSchema();
    const body = await readJson(request);
    const telegramUserId = cleanTelegramId(asString(body.telegramUserId));
    const fingerprintId = asString(body.fingerprintId).trim();

    await enforceAuthRateLimits([
      {
        bucket: "register-status-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 16,
        windowSeconds: 60 * 60,
      },
      {
        bucket: "register-status-telegram",
        subject: telegramUserId || "missing",
        limit: 10,
        windowSeconds: 60 * 60,
      },
    ]);

    if (!/^\d{4,24}$/u.test(telegramUserId)) return jsonError("Ingresa un Telegram ID válido.");
    if (!/^[A-Za-z0-9_-]{8,128}$/u.test(fingerprintId)) {
      return jsonError("No se pudo validar este dispositivo.", 403);
    }

    const database = dbBinding();
    if (await isTelegramAccountBanned(telegramUserId, database)) {
      return jsonOk({
        allowed: false,
        pending: false,
        banned: true,
        code: ACCOUNT_BANNED_CODE,
        groupInviteUrl: "/api/telegram/group",
        error: ACCOUNT_BANNED_MESSAGE,
      });
    }

    const [telegramCheck, linkedTelegram] = await Promise.all([
      checkCurrentTelegramGroupMember(telegramUserId),
      database.prepare(
        "SELECT id FROM users WHERE telegram_user_id = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(telegramUserId).first(),
    ]);

    // La misma consulta determina ambas condiciones. Se responden por separado
    // para que la interfaz explique la causa real sin exponer detalles internos.
    if (linkedTelegram) {
      return jsonOk({
        allowed: false,
        pending: false,
        groupInviteUrl: "/api/telegram/group",
        error: TELEGRAM_ALREADY_REGISTERED_MESSAGE,
      });
    }

    if (!telegramCheck.member && telegramMembershipIsUnavailable(telegramCheck)) {
      return jsonError(telegramMembershipError(telegramCheck), 503);
    }

    if (!telegramCheck.member) {
      return jsonOk({
        allowed: false,
        pending: false,
        groupInviteUrl: "/api/telegram/group",
        error: telegramMembershipError(telegramCheck),
      });
    }

    return jsonOk({
      allowed: true,
      pending: false,
      groupInviteUrl: "/api/telegram/group",
      message: "Telegram confirmado. Ya puedes crear tu cuenta.",
    });
  } catch (error) {
    return routeError(error);
  }
}
