import { asString, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  accountRateLimitSubject,
  authRateLimitSubjectHash,
  dbBinding,
  enforceAuthRateLimits,
  findLoginUser,
  issuePasswordResetChallenge,
  requestIpRateLimitSubject,
  routeError,
} from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

/**
 * The client polls this endpoint while its seller reviews the request. No
 * reset secret is returned until the request is approved. Recovery requests
 * are intentionally device-independent so a user can finish on a new device.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const requestId = asString(body.requestId).trim();
    const sellerId = asString(body.sellerId);
    const username = asString(body.username);
    if (!/^[0-9a-f-]{36}$/iu.test(requestId)) {
      return jsonOk({ status: "unavailable" }, { headers: { "cache-control": "no-store" } });
    }

    await enforceAuthRateLimits([
      {
        bucket: "reset-status-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 150,
        windowSeconds: 10 * 60,
      },
      {
        bucket: "reset-status-account",
        subject: accountRateLimitSubject(sellerId, username),
        limit: 150,
        windowSeconds: 10 * 60,
      },
    ]);

    const user = await findLoginUser(sellerId, username);
    if (!user || user.status !== "active" || Boolean(user.is_owner)) {
      return jsonOk({ status: "unavailable" }, { headers: { "cache-control": "no-store" } });
    }

    const reset = await dbBinding().prepare(
      `SELECT id, status, approved_at
       FROM password_reset_requests
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
    ).bind(requestId, user.id).first<{ id: string; status: "pending" | "approved" | "cancelled"; approved_at: string | null }>();
    if (!reset || reset.status === "cancelled") {
      return jsonOk({ status: "unavailable" }, { headers: { "cache-control": "no-store" } });
    }
    if (reset.status === "pending") {
      return jsonOk({ status: "pending" }, { headers: { "cache-control": "no-store" } });
    }

    const challenge = await issuePasswordResetChallenge(
      user.id,
      await authRateLimitSubjectHash("password-reset-token", accountRateLimitSubject(sellerId, username)),
    );
    return jsonOk(
      {
        status: "approved",
        requestId: challenge.requestId,
        resetToken: challenge.token,
        expiresAt: challenge.expiresAt,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
