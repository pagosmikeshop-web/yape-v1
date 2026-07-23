import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { authenticateAccessCredentials, redeemPermanentAccessToken } from "@/app/lib/access-server";
import {
  createSession,
  enforceAuthRateLimits,
  getSessionUserIncludingExpired,
  requestIpRateLimitSubject,
  routeError,
  safeUser,
} from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const token = asString(body.token).trim();
    await enforceAuthRateLimits([
      { bucket: "permanent-token-ip", subject: await requestIpRateLimitSubject(request), limit: 20, windowSeconds: 15 * 60 },
      { bucket: "permanent-token-value", subject: token || "missing", limit: 6, windowSeconds: 15 * 60 },
    ]);

    const existingSession = await getSessionUserIncludingExpired(request, ["client"]);
    const credentialUser = existingSession ? null : await authenticateAccessCredentials({
      sellerId: asString(body.sellerId),
      username: asString(body.username),
      password: asString(body.password),
      deviceId: asString(body.deviceId),
      publicKey: body.publicKey as JsonWebKey,
      proof: asString(body.proof),
      proofTimestamp: Number(body.proofTimestamp),
    });
    const userId = existingSession?.user.id ?? credentialUser?.id;
    if (!userId) return jsonError("No pudimos verificar tu cuenta y este dispositivo.", 401);

    const redeemed = await redeemPermanentAccessToken(userId, token);
    const headers: Record<string, string> = { "cache-control": "no-store" };
    if (!existingSession && credentialUser) headers["set-cookie"] = await createSession(request, credentialUser.id);
    return jsonOk({
      permanent: true,
      referralCode: existingSession?.user.referralCode ?? credentialUser?.referral_code ?? null,
      user: credentialUser ? safeUser({ ...credentialUser, access_expires_at: null }) : { ...existingSession?.user, accessExpiresAt: null },
      message: redeemed.alreadyPermanent ? "Tu cuenta ya tenía acceso permanente." : "Token validado. Tu acceso ahora es permanente.",
    }, { headers });
  } catch (error) {
    return routeError(error);
  }
}
