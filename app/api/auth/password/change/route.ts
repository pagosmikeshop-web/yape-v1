import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  hashSecret,
  requireSession,
  routeError,
  validatePassword,
  verifySecret,
} from "@/app/lib/auth-server";
import { writeSecurityEvent } from "@/app/lib/security-log";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user, sessionId } = await requireSession(request);
    const body = await readJson(request);
    const currentPassword = asString(body.currentPassword);
    const newPassword = asString(body.newPassword);
    if (!validatePassword(newPassword)) return jsonError("La nueva contrasena debe tener al menos 8 caracteres.");
    await enforceAuthRateLimits([
      { bucket: "password-change-account", subject: user.id, limit: 5, windowSeconds: 15 * 60 },
    ]);
    const row = await dbBinding().prepare("SELECT password_hash, password_salt FROM users WHERE id = ? LIMIT 1").bind(user.id).first<{ password_hash: string; password_salt: string }>();
    if (!row || !(await verifySecret(currentPassword, row.password_salt, row.password_hash))) {
      writeSecurityEvent(request, "auth.password_change", "denied", { actorId: user.id });
      return jsonError("La contrasena actual no coincide.", 401);
    }
    const hashed = await hashSecret(newPassword);
    const now = new Date().toISOString();
    const db = dbBinding();
    await db.batch([
      db.prepare(
        "UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?",
      ).bind(hashed.hash, hashed.salt, now, user.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").bind(user.id, sessionId),
      db.prepare(
        "UPDATE sessions SET pin_verified_at = NULL, unlocked_until = NULL, last_seen_at = ? WHERE id = ?",
      ).bind(now, sessionId),
      db.prepare(
        `UPDATE password_reset_tokens
         SET used_at = ?, consumed_by = 'password_changed'
         WHERE user_id = ? AND used_at IS NULL`,
      ).bind(now, user.id),
    ]);
    writeSecurityEvent(request, "auth.password_change", "success", { actorId: user.id });
    return jsonOk({}, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
