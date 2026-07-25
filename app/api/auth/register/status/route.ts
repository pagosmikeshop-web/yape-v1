import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  ensureAuthSchema,
  publicSha256,
  requestIpRateLimitSubject,
  routeError,
} from "@/app/lib/auth-server";
import {
  checkCurrentTelegramGroupMember,
  telegramMembershipError,
} from "@/app/lib/telegram-manager";

export const dynamic = "force-dynamic";

function cleanTelegramId(value: string) {
  return value.replace(/\D/gu, "").slice(0, 24);
}

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
        limit: 12,
        windowSeconds: 60 * 60,
      },
      {
        bucket: "register-status-telegram",
        subject: telegramUserId || "missing",
        limit: 6,
        windowSeconds: 60 * 60,
      },
    ]);
    if (!/^\d{4,24}$/u.test(telegramUserId)) return jsonError("Ingresa un Telegram ID válido.");
    if (fingerprintId.length < 8 || fingerprintId.length > 128) {
      return jsonError("No se pudo validar este dispositivo.", 403);
    }
    const fingerprintHash = fingerprintId ? await publicSha256(`fingerprintjs-v3\n${fingerprintId}`) : "";

    const [telegramCheck, linkedTelegram, duplicateDevice] = await Promise.all([
      checkCurrentTelegramGroupMember(telegramUserId),
      telegramUserId
        ? dbBinding().prepare(
          "SELECT id FROM users WHERE telegram_user_id = ? AND deleted_at IS NULL LIMIT 1",
        ).bind(telegramUserId).first()
        : null,
      fingerprintHash
        ? dbBinding().prepare(
          "SELECT id FROM users WHERE fingerprint_id_hash = ? AND deleted_at IS NULL LIMIT 1",
        ).bind(fingerprintHash).first()
        : null,
    ]);

    if (linkedTelegram) {
      return jsonOk({
        allowed: false,
        groupInviteUrl: "/api/telegram/group",
        reason: "telegram-already-registered",
        error: "Ese Telegram ID ya tiene una cuenta. Inicia sesión o recupera tu acceso.",
      });
    }
    if (duplicateDevice) {
      return jsonOk({
        allowed: false,
        groupInviteUrl: "/api/telegram/group",
        reason: "device-already-registered",
        error: "Este dispositivo ya tiene una cuenta registrada. Usa otra cuenta o contacta soporte.",
      });
    }
    if (!telegramCheck.member) {
      return jsonOk({
        allowed: false,
        groupInviteUrl: "/api/telegram/group",
        reason: telegramCheck.reason,
        error: telegramMembershipError(telegramCheck),
      });
    }

    const allowed = Boolean(telegramUserId && fingerprintHash && telegramCheck.member);
    return jsonOk({
      allowed,
      groupInviteUrl: "/api/telegram/group",
      reason: allowed ? "ok" : "incomplete",
      error: allowed ? "" : "No se pudo habilitar el registro con estos datos.",
    });
  } catch (error) {
    return routeError(error);
  }
}
