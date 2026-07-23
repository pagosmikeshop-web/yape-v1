import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  clearAuthRateLimit,
  dbBinding,
  enforceAuthRateLimits,
  hashSecret,
  requireSession,
  rotateAndUnlockSession,
  routeError,
  secretHashNeedsUpgrade,
  verifySecret,
} from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user, sessionId } = await requireSession(request);
    if (user.mustChangePassword) return jsonError("Cambia tu contraseña antes de verificar la clave.", 428);
    const body = await readJson(request);
    const pin = asString(body.pin).replace(/\D/gu, "");
    const row = await dbBinding().prepare("SELECT pin_hash, pin_salt FROM users WHERE id = ? LIMIT 1").bind(user.id).first<{ pin_hash: string | null; pin_salt: string | null }>();
    if (!row?.pin_hash || !row.pin_salt) return jsonError("Primero configura tu clave.", 428);
    await enforceAuthRateLimits([
      { bucket: "pin-account", subject: user.id, limit: 5, windowSeconds: 10 * 60 },
    ]);
    const ok = await verifySecret(pin, row.pin_salt, row.pin_hash);
    if (!ok) return jsonError("Clave incorrecta.", 401);
    if (secretHashNeedsUpgrade(row.pin_hash)) {
      const upgraded = await hashSecret(pin);
      await dbBinding().prepare(
        "UPDATE users SET pin_hash = ?, pin_salt = ?, updated_at = ? WHERE id = ?",
      ).bind(upgraded.hash, upgraded.salt, new Date().toISOString(), user.id).run();
    }
    const { unlockedUntil, cookie } = await rotateAndUnlockSession(request, sessionId);
    await clearAuthRateLimit("pin-account", user.id);
    return jsonOk(
      { user: { ...user, unlocked: true }, unlockedUntil },
      { headers: { "cache-control": "no-store", "set-cookie": cookie } },
    );
  } catch (error) {
    return routeError(error);
  }
}
