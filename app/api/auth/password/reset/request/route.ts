import { asString, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  accountRateLimitSubject,
  dbBinding,
  enforceAuthRateLimits,
  findLoginUser,
  requestIpRateLimitSubject,
  routeError,
  verifyDeviceProof,
  userHasRole,
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
      && userHasRole(user, "client")
      && user.status === "active"
      && user.device_id === deviceId
      && validDeviceProof,
    );
    let requestId = crypto.randomUUID();
    let requestCreated = false;
    if (eligible && user) {
      const database = dbBinding();
      const approver = user.owner_id
        ? { id: user.owner_id }
        : await database.prepare(
          `SELECT seller_id AS id
           FROM activations
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        ).bind(user.id).first<{ id: string }>()
          ?? await database.prepare(
            `SELECT id
             FROM users
             WHERE is_owner = 1 AND status = 'active' AND deleted_at IS NULL
             LIMIT 1`,
          ).first<{ id: string }>();
      if (approver?.id) {
        requestId = crypto.randomUUID();
        requestCreated = true;
        const now = new Date().toISOString();
        await database.batch([
          database.prepare(
            `UPDATE password_reset_requests
             SET status = 'cancelled'
             WHERE user_id = ? AND status = 'pending'`,
          ).bind(user.id),
          database.prepare(
            `INSERT INTO password_reset_requests (
              id, user_id, seller_id, status, price_credits, created_at
            ) VALUES (?, ?, ?, 'pending', 0, ?)`,
          ).bind(requestId, user.id, approver.id, now),
        ]);
      }
    }
    writeSecurityEvent(request, "auth.password_reset.request", eligible ? "success" : "denied", {
      actorId: eligible && user ? user.id : null,
    });

    return jsonOk(
      {
        message: "Solicitud enviada. Tu vendedor debe aprobar el restablecimiento.",
        requestId,
        pending: requestCreated,
      },
      { status: 202, headers: { "cache-control": "no-store", pragma: "no-cache" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
