import { asString, jsonOk, readJson } from "@/app/lib/api-utils";
import { issuePermanentAccessToken } from "@/app/lib/access-server";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { hasPermission, requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
    await requirePermission(actor, "keys:view");
    const select = `SELECT t.id, t.token_hint, t.created_at, t.redeemed_at,
              c.id AS client_id, c.display_name AS client_name,
              i.id AS seller_id, i.display_name AS seller_name,
              CASE WHEN i.is_owner = 1 THEN 'owner' ELSE i.role END AS issuer_role
       FROM permanent_access_tokens t
       JOIN users c ON c.id = t.user_id
       JOIN users i ON i.id = t.created_by`;
    const canViewAll = actor.isOwner || await hasPermission(actor, "keys:view_all");
    const history = canViewAll
      ? await dbBinding().prepare(`${select} ORDER BY t.created_at DESC LIMIT 100`).all()
      : await dbBinding().prepare(
        `${select} WHERE t.created_by = ? ORDER BY t.created_at DESC LIMIT 100`,
      ).bind(actor.id).all();
    return jsonOk({ tokens: history.results ?? [] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["seller", "admin"]);
    await requirePermission(user, "keys:create");
    const body = await readJson(request);
    const result = await issuePermanentAccessToken(user, asString(body.clientId).trim());
    const creditMessage = result.chargedCredits
      ? "Se descontó 1 crédito."
      : "Generada con autorización administrativa, sin depender de un vendedor.";
    return jsonOk({
      ...result,
      message: `Key permanente creada para ${result.clientName}. ${creditMessage}`,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
