import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requireUnlockedSession,
  revokeOtherUserSessions,
  routeError,
  verifySecret,
} from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user, sessionId } = await requireUnlockedSession(request);
    const body = await readJson(request);
    const currentPassword = asString(body.currentPassword);
    await enforceAuthRateLimits([
      { bucket: "session-revoke-account", subject: user.id, limit: 5, windowSeconds: 15 * 60 },
    ]);
    const row = await dbBinding().prepare(
      "SELECT password_hash, password_salt FROM users WHERE id = ? LIMIT 1",
    ).bind(user.id).first<{ password_hash: string; password_salt: string }>();
    if (!row || !(await verifySecret(currentPassword, row.password_salt, row.password_hash))) {
      return jsonError("No se pudo confirmar la identidad.", 401);
    }
    await revokeOtherUserSessions(user.id, sessionId);
    return jsonOk({ message: "Las demás sesiones fueron cerradas." });
  } catch (error) {
    return routeError(error);
  }
}
