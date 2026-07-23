import { jsonOk } from "@/app/lib/api-utils";
import { getSessionUser, getSessionUserIncludingExpired, routeError } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSessionUser(request);
    if (session) return jsonOk({ user: session.user }, { status: 200, headers: { "cache-control": "no-store" } });
    const expiredSession = await getSessionUserIncludingExpired(request, ["client"]);
    if (expiredSession?.user.accessExpiresAt && Date.parse(expiredSession.user.accessExpiresAt) <= Date.now()) {
      return Response.json({
        ok: false,
        user: null,
        code: "ACCESS_EXPIRED",
        error: "Tu suscripción terminó. Contacta a tu vendedor.",
        referralCode: expiredSession.user.referralCode,
      }, { status: 403, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }
    return jsonOk({ user: null }, { status: 401, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
