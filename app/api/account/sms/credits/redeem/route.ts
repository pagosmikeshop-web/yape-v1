import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  clearAuthRateLimit,
  enforceAuthRateLimits,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import { isSmsCreditToken } from "@/app/lib/sms-credit-tokens";
import { redeemSmsCreditToken } from "@/app/lib/sms-credits-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request);
    await enforceAuthRateLimits([{
      bucket: "sms-credit-redeem",
      subject: user.id,
      limit: 8,
      windowSeconds: 10 * 60,
    }]);
    const body = await readJson(request);
    if (Object.keys(body).some((key) => key !== "token")) {
      return jsonError("La solicitud contiene campos no permitidos.", 400);
    }
    const token = asString(body.token).trim();
    if (!isSmsCreditToken(token)) return jsonError("El token SMS no es válido.", 400);

    const sms = await redeemSmsCreditToken(user.id, token);
    if (!sms) return jsonError("El token no es válido, fue usado o fue revocado.", 409);
    await clearAuthRateLimit("sms-credit-redeem", user.id);
    return jsonOk({ sms, message: "Créditos SMS agregados correctamente." });
  } catch (error) {
    return routeError(error);
  }
}
