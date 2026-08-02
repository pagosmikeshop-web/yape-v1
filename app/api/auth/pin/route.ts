import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  clearAuthRateLimit,
  dbBinding,
  enforceAuthRateLimits,
  hashSecret,
  requireSessionIncludingExpired,
  rotateAndUnlockSession,
  routeError,
} from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user, sessionId } = await requireSessionIncludingExpired(request);
    if (user.mustChangePassword) return jsonError("Cambia tu contraseña antes de configurar la clave.", 428);
    await enforceAuthRateLimits([
      { bucket: "pin-account", subject: user.id, limit: 5, windowSeconds: 10 * 60 },
    ]);
    const body = await readJson(request);
    const pin = asString(body.pin).replace(/\D/gu, "");
    if (!/^\d{6}$/u.test(pin)) return jsonError("La clave debe tener exactamente 6 números.");
    const hashed = await hashSecret(pin);
    const result = await dbBinding().prepare(
      `UPDATE users
       SET pin_hash = ?, pin_salt = ?, must_set_pin = 0, updated_at = ?
       WHERE id = ? AND pin_hash IS NULL`,
    ).bind(hashed.hash, hashed.salt, new Date().toISOString(), user.id).run();
    if (Number(result.meta.changes ?? 0) !== 1) return jsonError("La clave ya fue configurada.", 409);
    const { unlockedUntil, cookie } = await rotateAndUnlockSession(request, sessionId);
    await clearAuthRateLimit("pin-account", user.id);
    return jsonOk(
      { user: { ...user, pinSet: true, mustSetPin: false, unlocked: true }, unlockedUntil },
      { headers: { "cache-control": "no-store", "set-cookie": cookie } },
    );
  } catch (error) {
    return routeError(error);
  }
}
