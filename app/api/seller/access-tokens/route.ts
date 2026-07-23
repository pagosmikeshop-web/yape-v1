import { asString, jsonOk, readJson } from "@/app/lib/api-utils";
import { issuePermanentAccessToken } from "@/app/lib/access-server";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
    const select = `SELECT t.id, t.token_hint, t.created_at, t.redeemed_at,
              c.id AS client_id, c.display_name AS client_name,
              s.id AS seller_id, s.display_name AS seller_name
       FROM permanent_access_tokens t
       JOIN users c ON c.id = t.user_id
       JOIN users s ON s.id = t.seller_id`;
    const history = actor.role === "seller"
      ? await dbBinding().prepare(
        `${select} WHERE t.seller_id = ? ORDER BY t.created_at DESC LIMIT 100`,
      ).bind(actor.id).all()
      : actor.isOwner
        ? await dbBinding().prepare(
          `${select} ORDER BY t.created_at DESC LIMIT 100`,
        ).all()
        : await dbBinding().prepare(
          `${select}
           WHERE s.owner_id = ? OR t.created_by = ?
           ORDER BY t.created_at DESC LIMIT 100`,
        ).bind(actor.id, actor.id).all();
    return jsonOk({ tokens: history.results ?? [] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["seller", "admin"]);
    const body = await readJson(request);
    const result = await issuePermanentAccessToken(user, asString(body.clientId).trim());
    return jsonOk({
      ...result,
      message: `Token permanente creado para ${result.clientName}. Se descontó 1 crédito.`,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
