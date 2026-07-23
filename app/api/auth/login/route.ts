import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  accountRateLimitSubject,
  bindDevice,
  clearAuthRateLimit,
  createSession,
  dbBinding,
  enforceAuthRateLimits,
  findLoginUser,
  requestIpRateLimitSubject,
  routeError,
  safeUser,
  secretHashNeedsUpgrade,
  hashSecret,
  verifyDeviceProof,
  verifySecret,
} from "@/app/lib/auth-server";
import { writeSecurityEvent } from "@/app/lib/security-log";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const sellerId = asString(body.sellerId);
    const username = asString(body.username);
    const password = asString(body.password);
    const deviceId = asString(body.deviceId);
    const proof = asString(body.proof);
    const proofTimestamp = Number(body.proofTimestamp);
    const publicKey = body.publicKey as JsonWebKey | undefined;

    if (!sellerId || !username || !password || !deviceId || !proof || !publicKey) {
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
    const validDevice = await verifyDeviceProof({ sellerId, username, deviceId, publicKey, proof, proofTimestamp });
    if (!validDevice) {
      writeSecurityEvent(request, "auth.login", "denied", { reason: "device_proof" });
      return jsonError("No se pudo verificar este dispositivo.", 403);
    }

    const user = await findLoginUser(sellerId, username);
    if (!user || user.status !== "active") {
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
    if (user.role === "client") {
      const bound = await bindDevice(user, deviceId, publicKey);
      if (!bound) {
        writeSecurityEvent(request, "auth.login", "denied", { reason: "device_binding", actorId: user.id });
        return jsonError("Esta cuenta ya esta vinculada a otro dispositivo. Contacta a tu vendedor.", 423);
      }
    } else if (user.device_id || user.device_public_key) {
      await dbBinding().prepare(
        "UPDATE users SET device_id = NULL, device_public_key = NULL, updated_at = ? WHERE id = ? AND role <> 'client'",
      ).bind(new Date().toISOString(), user.id).run();
    }
    if (user.access_expires_at && Date.parse(user.access_expires_at) <= Date.now()) {
      writeSecurityEvent(request, "auth.login", "denied", { reason: "access_expired", actorId: user.id });
      return Response.json({
        ok: false,
        error: "Tu suscripción terminó. Contacta a tu vendedor o ingresa un token permanente en Cambio de número.",
        code: "ACCESS_EXPIRED",
        referralCode: user.referral_code,
      }, { status: 403, headers: { "cache-control": "no-store" } });
    }

    const cookie = await createSession(request, user.id);
    await clearAuthRateLimit("login-account", accountSubject);
    writeSecurityEvent(request, "auth.login", "success", { actorId: user.id, role: user.role });
    return jsonOk(
      {
        user: safeUser({
          ...user,
          device_id: user.role === "client" ? (user.device_id ?? deviceId) : null,
          device_public_key: user.role === "client" ? user.device_public_key : null,
        }),
      },
      { headers: { "cache-control": "no-store", "set-cookie": cookie } },
    );
  } catch (error) {
    return routeError(error);
  }
}
