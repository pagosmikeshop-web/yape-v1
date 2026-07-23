import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { authenticateAccessCredentials } from "@/app/lib/access-server";
import { enforceAuthRateLimits, requestIpRateLimitSubject, routeError } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const sellerId = asString(body.sellerId);
    const username = asString(body.username);
    await enforceAuthRateLimits([
      { bucket: "access-status-ip", subject: await requestIpRateLimitSubject(request), limit: 20, windowSeconds: 15 * 60 },
      { bucket: "access-status-account", subject: `${sellerId}:${username}`, limit: 6, windowSeconds: 15 * 60 },
    ]);
    const user = await authenticateAccessCredentials({
      sellerId,
      username,
      password: asString(body.password),
      deviceId: asString(body.deviceId),
      publicKey: body.publicKey as JsonWebKey,
      proof: asString(body.proof),
      proofTimestamp: Number(body.proofTimestamp),
    });
    if (!user) return jsonError("No pudimos verificar tu cuenta y este dispositivo.", 401);
    return jsonOk({
      permanent: !user.access_expires_at,
      accessExpiresAt: user.access_expires_at,
      referralCode: user.referral_code,
      displayName: user.display_name,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
