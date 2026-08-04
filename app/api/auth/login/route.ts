import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  accountRateLimitSubject,
  bindDevice,
  clearAuthRateLimit,
  createSession,
  dbBinding,
  enforceAuthRateLimits,
  findLoginUser,
  hashSecret,
  requestIpRateLimitSubject,
  routeError,
  safeUser,
  getUserRoles,
  userHasRole,
  secretHashNeedsUpgrade,
  verifyDeviceProof,
  verifySecret,
  type UserRow,
} from "@/app/lib/auth-server";
import { writeSecurityEvent } from "@/app/lib/security-log";
import {
  checkCurrentTelegramGroupMember,
  telegramMembershipIsUnavailable,
  telegramMembershipError,
} from "@/app/lib/telegram-manager";
import {
  activateClientTrial,
  TELEGRAM_TRIAL_SELLER_ID,
} from "@/app/lib/trial-activation";

export const dynamic = "force-dynamic";

async function claimPendingTelegramTrial(user: UserRow): Promise<
  | { ok: true; user: UserRow }
  | { ok: false; response: Response }
> {
  if (!userHasRole(user, "client") || !user.telegram_user_id) {
    return {
      ok: false,
      response: jsonError("Tu cuenta está pendiente de aprobación.", 403),
    };
  }

  const database = dbBinding();
  const existingActivation = await database.prepare(
    "SELECT id FROM activations WHERE user_id = ? LIMIT 1",
  ).bind(user.id).first();
  if (existingActivation) {
    return {
      ok: false,
      response: jsonError("Tu cuenta está pendiente de aprobación.", 403),
    };
  }

  const membership = await checkCurrentTelegramGroupMember(user.telegram_user_id);
  if (!membership.member) {
    const temporary = telegramMembershipIsUnavailable(membership);
    return {
      ok: false,
      response: jsonError(
        temporary
          ? telegramMembershipError(membership)
          : "No pudimos confirmar que perteneces al grupo. Únete al grupo y vuelve a iniciar sesión.",
        temporary ? 503 : 403,
      ),
    };
  }

  const trial = await activateClientTrial({
    userId: user.id,
    sellerId: TELEGRAM_TRIAL_SELLER_ID,
    updatedBy: user.id,
  });
  if (!trial.ok) {
    return {
      ok: false,
      response: jsonError("Tu cuenta está pendiente de aprobación.", 403),
    };
  }

  const refreshed = await database.prepare(
    "SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1",
  ).bind(user.id).first<UserRow>();
  if (!refreshed || refreshed.status !== "active") {
    return {
      ok: false,
      response: jsonError("Tu cuenta está pendiente de aprobación.", 403),
    };
  }
  return { ok: true, user: refreshed };
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const sellerId = asString(body.sellerId);
    const username = asString(body.username);
    const password = asString(body.password);
    const clientType = asString(body.clientType).trim().toLowerCase();
    const isPanelLogin = clientType === "panel";
    const deviceId = asString(body.deviceId);
    const proof = asString(body.proof);
    const proofTimestamp = Number(body.proofTimestamp);
    const publicKey = body.publicKey as JsonWebKey | undefined;

    if (!sellerId || !username || !password || (!isPanelLogin && (!deviceId || !proof || !publicKey))) {
      writeSecurityEvent(request, "auth.login", "denied", { reason: "invalid_input" });
      return jsonError("Completa tus credenciales.");
    }
    const accountSubject = accountRateLimitSubject(sellerId, username);
    await enforceAuthRateLimits([
      {
        bucket: "login-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 20,
        windowSeconds: 15 * 60,
      },
      {
        bucket: "login-account",
        subject: accountSubject,
        limit: 5,
        windowSeconds: 15 * 60,
      },
    ]);
    if (!isPanelLogin) {
      const validDevice = await verifyDeviceProof({ sellerId, username, deviceId, publicKey: publicKey!, proof, proofTimestamp });
      if (!validDevice) {
        writeSecurityEvent(request, "auth.login", "denied", { reason: "device_proof" });
        return jsonError("No se pudo verificar este dispositivo.", 403);
      }
    }

    let user = await findLoginUser(sellerId, username);
    if (!user) {
      writeSecurityEvent(request, "auth.login", "denied", { reason: "credentials" });
      return jsonError("Credenciales invalidas.", 401);
    }
    const validPassword = await verifySecret(password, user.password_salt, user.password_hash);
    if (!validPassword) {
      writeSecurityEvent(request, "auth.login", "denied", { reason: "credentials", actorId: user.id });
      return jsonError("Credenciales invalidas.", 401);
    }
    if (secretHashNeedsUpgrade(user.password_hash)) {
      const upgraded = await hashSecret(password);
      await dbBinding().prepare(
        "UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?",
      ).bind(upgraded.hash, upgraded.salt, new Date().toISOString(), user.id).run();
    }
    // AUTH-001: claim trial solo tras password válida (no quemar trial ajeno).
  if (user.status === "pending") {
      const claimed = await claimPendingTelegramTrial(user);
      if (!claimed.ok) {
        writeSecurityEvent(request, "auth.login", "denied", { reason: "pending_approval", actorId: user.id });
        return claimed.response;
      }
      user = claimed.user;
      user.roles = await getUserRoles(user.id);
    }
    if (user.status !== "active") {
      writeSecurityEvent(request, "auth.login", "denied", { reason: "account_inactive", actorId: user.id });
      return jsonError("Tu cuenta no está activa. Contacta al administrador.", 403);
    }
    // El panel administrativo no vincula dispositivos. La app de clientes sÃ­.
    // El rol se comprueba en el servidor para impedir que una cuenta cliente
    // omita su vinculaciÃ³n enviando clientType=panel.
    const isPanelStaff = isPanelLogin && (userHasRole(user, "admin") || userHasRole(user, "seller"));
    if (isPanelLogin && !isPanelStaff) {
      writeSecurityEvent(request, "auth.login", "denied", { reason: "panel_role_required", actorId: user.id });
      return jsonError("El panel solo estÃ¡ disponible para cuentas internas.", 403);
    }
    if (userHasRole(user, "client") && !isPanelLogin) {
      const bound = await bindDevice(user, deviceId, publicKey!);
      if (!bound) {
        writeSecurityEvent(request, "auth.login", "denied", { reason: "device_binding", actorId: user.id });
        return jsonError("Esta cuenta ya esta vinculada a otro dispositivo. Contacta a tu vendedor.", 423);
      }
    } else if (user.device_id || user.device_public_key) {
      await dbBinding().prepare(
        "UPDATE users SET device_id = NULL, device_public_key = NULL, updated_at = ? WHERE id = ?",
      ).bind(new Date().toISOString(), user.id).run();
    }
    /* Legacy access-expired login response intentionally disabled:
    if (user && shouldBlockExpiredAccessAtLogin() && !userHasRole(user, "admin") && !userHasRole(user, "seller")
      && user.access_expires_at && Date.parse(user.access_expires_at) <= Date.now()) {
      writeSecurityEvent(request, "auth.login", "denied", { reason: "access_expired", actorId: user.id });
      return Response.json({
        ok: false,
        error: "Tu suscripción terminó. Canjea un token permanente en Cambio de número o comparte tu código para que alguien del grupo escriba /redeem y te dé 3 días.",
        code: "ACCESS_EXPIRED",
        referralCode: user.referral_code,
      }, { status: 403, headers: { "cache-control": "no-store" } });
    }

    */
    const cookie = await createSession(request, user.id);
    await clearAuthRateLimit("login-account", accountSubject);
    writeSecurityEvent(request, "auth.login", "success", { actorId: user.id, role: user.role });
    return jsonOk(
      {
        user: safeUser({
          ...user,
          device_id: userHasRole(user, "client") ? (user.device_id ?? deviceId) : null,
          device_public_key: userHasRole(user, "client") ? user.device_public_key : null,
        }),
      },
      { headers: { "cache-control": "no-store", "set-cookie": cookie } },
    );
  } catch (error) {
    return routeError(error);
  }
}
