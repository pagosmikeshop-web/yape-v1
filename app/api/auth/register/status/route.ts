import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  ensureAuthSchema,
  publicSha256,
  requestIpRateLimitSubject,
  routeError,
} from "@/app/lib/auth-server";
import { checkCurrentTelegramGroupMember } from "@/app/lib/telegram-manager";
import {
  createTelegramRegistrationChallenge,
  telegramRegistrationChallengeIsVerified,
} from "@/app/lib/telegram-registration";

export const dynamic = "force-dynamic";

function cleanTelegramId(value: string) {
  return value.replace(/\D/gu, "").slice(0, 24);
}

const GENERIC_DENIAL =
  "No se pudo habilitar el registro. Verifica tu ID, tu acceso al grupo y que no exista una cuenta vinculada.";

export async function POST(request: Request) {
  try {
    await ensureAuthSchema();
    const body = await readJson(request);
    const telegramUserId = cleanTelegramId(asString(body.telegramUserId));
    const fingerprintId = asString(body.fingerprintId).trim();
    const challengeToken = asString(body.challengeToken).trim();

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

    const fingerprintHash = await publicSha256(`fingerprintjs-v3\n${fingerprintId}`);
    const [telegramCheck, linkedTelegram] = await Promise.all([
      checkCurrentTelegramGroupMember(telegramUserId),
      dbBinding().prepare(
        "SELECT id FROM users WHERE telegram_user_id = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(telegramUserId).first(),
    ]);

    if (!telegramCheck.member || linkedTelegram) {
      return jsonOk({
        allowed: false,
        pending: false,
        groupInviteUrl: "/api/telegram/group",
        error: GENERIC_DENIAL,
      });
    }

    if (challengeToken) {
      const allowed = await telegramRegistrationChallengeIsVerified({
        telegramUserId,
        fingerprintHash,
        code: challengeToken,
      });
      return jsonOk({
        allowed,
        pending: !allowed,
        groupInviteUrl: "/api/telegram/group",
        error: allowed
          ? ""
          : "Aún falta confirmar el código desde tu cuenta de Telegram en el grupo.",
      });
    }

    const challenge = await createTelegramRegistrationChallenge(
      telegramUserId,
      fingerprintHash,
    );
    return jsonOk({
      allowed: false,
      pending: true,
      challengeToken: challenge.code,
      command: challenge.command,
      expiresAt: challenge.expiresAt,
      groupInviteUrl: "/api/telegram/group",
      error: "Publica el comando mostrado en el grupo y luego pulsa Comprobar validación.",
    });
  } catch (error) {
    return routeError(error);
  }
}
