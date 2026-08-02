import { jsonError, jsonOk } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requestIpRateLimitSubject,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import { assertSameOriginMutation } from "@/app/lib/qr-contact-server";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginMutation(request, false);
    const { user } = await requireUnlockedSession(request, ["admin", "seller", "client"]);
    await enforceAuthRateLimits([
      {
        bucket: "global-recipient-delete-user",
        subject: user.id,
        limit: 60,
        windowSeconds: 60 * 60,
      },
      {
        bucket: "global-recipient-delete-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 120,
        windowSeconds: 60 * 60,
      },
    ]);
    const { id } = await context.params;
    if (!id || id.length > 80) return jsonError("Destinatario no válido.", 400);
    const result = await dbBinding().prepare(
      `DELETE FROM global_recipient_directory
       WHERE id = ? AND submitted_by_user_id = ?`,
    ).bind(id, user.id).run();
    if (Number(result.meta.changes ?? 0) === 0) return jsonError("Destinatario no encontrado.", 404);
    return jsonOk({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
