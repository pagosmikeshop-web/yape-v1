import { asString, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  accountRateLimitSubject,
  authRateLimitSubjectHash,
  createDecoyPasswordResetChallenge,
  enforceAuthRateLimits,
  findLoginUser,
  issuePasswordResetChallenge,
  requestIpRateLimitSubject,
  routeError,
  verifyDeviceProof,
} from "@/app/lib/auth-server";
import { writeSecurityEvent } from "@/app/lib/security-log";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const sellerId = asString(body.sellerId);
    const username = asString(body.username);
    const deviceId = asString(body.deviceId);
    const proof = asString(body.proof);
    const proofTimestamp = Number(body.proofTimestamp);
    const publicKey = body.publicKey && typeof body.publicKey === "object"
      ? body.publicKey as JsonWebKey
      : {} as JsonWebKey;
    const accountSubject = accountRateLimitSubject(sellerId, username);

    await enforceAuthRateLimits([
      {
        bucket: "reset-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 20,
        windowSeconds: 60 * 60,
      },
      {
        bucket: "reset-account",
        subject: accountSubject,
        limit: 3,
        windowSeconds: 60 * 60,
      },
    ]);

    const [user, validDeviceProof] = await Promise.all([
      findLoginUser(sellerId, username),
      deviceId && proof
        ? verifyDeviceProof({ sellerId, username, deviceId, publicKey, proof, proofTimestamp })
        : Promise.resolve(false),
    ]);
    const eligible = Boolean(
      user
      && user.role === "client"
      && user.status === "active"
      && user.device_id === deviceId
      && validDeviceProof,
    );
    const challenge = eligible && user
      ? await issuePasswordResetChallenge(
        user.id,
        await authRateLimitSubjectHash("password-reset-token", accountSubject),
      )
      : createDecoyPasswordResetChallenge();
    writeSecurityEvent(request, "auth.password_reset.request", eligible ? "success" : "denied", {
      actorId: eligible && user ? user.id : null,
    });

    return jsonOk(
      {
        message: "Si los datos y este dispositivo son validos, puedes continuar con el restablecimiento.",
        requestId: challenge.requestId,
        resetToken: challenge.token,
        expiresAt: challenge.expiresAt,
      },
      { status: 202, headers: { "cache-control": "no-store", pragma: "no-cache" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
