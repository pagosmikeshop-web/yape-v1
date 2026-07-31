import { jsonOk } from "@/app/lib/api-utils";
import {
  ensureReferralCodeForUser,
  getSessionUser,
  getSessionUserIncludingExpired,
  routeError,
  userHasRole,
} from "@/app/lib/auth-server";
import { permissionsFor, staffRole } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSessionUser(request);
    if (session) {
      const referralCode = userHasRole(session.user, "client")
        ? await ensureReferralCodeForUser(session.user.id)
        : session.user.referralCode;
      const staff = userHasRole(session.user, "admin") || userHasRole(session.user, "seller");
      const permissions = staff ? [...await permissionsFor(session.user)] : [];
      return jsonOk(
        {
          user: {
            ...session.user,
            referralCode,
            effectiveRole: staff ? staffRole(session.user) : "client",
            permissions,
          },
        },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }
    const expiredSession = await getSessionUserIncludingExpired(request, ["client"]);
    if (expiredSession?.user.accessExpiresAt && Date.parse(expiredSession.user.accessExpiresAt) <= Date.now()) {
      return Response.json({
        ok: false,
        user: null,
        code: "ACCESS_EXPIRED",
        error: "Tu suscripción terminó. Canjea un token permanente en Cambio de número o comparte tu código para que alguien del grupo escriba /redeem y te dé 3 días.",
        referralCode: await ensureReferralCodeForUser(expiredSession.user.id),
      }, { status: 403, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }
    return jsonOk({ user: null }, { status: 401, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
