import { jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  issueGlobalPermanentAccessToken,
  listGlobalPermanentAccessTokens,
} from "@/app/lib/access-server";
import { enforceAuthRateLimits, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["seller", "admin"]);
    const keys = await listGlobalPermanentAccessTokens(user);
    return jsonOk({ keys }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["seller", "admin"]);
    await requirePermission(user, "keys:create");
    await enforceAuthRateLimits([{
      bucket: "global-access-token-create",
      subject: user.id,
      limit: 20,
      windowSeconds: 60 * 60,
    }]);
    const body = await readJson(request);
    if (Object.keys(body).length > 0) {
      return jsonError("La solicitud contiene campos no permitidos.", 400);
    }
    const result = await issueGlobalPermanentAccessToken(user);
    return jsonOk({
      ...result,
      message: "Key global creada. La primera cuenta que la canjee recibirá acceso permanente y solo podrá usarse una vez.",
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
