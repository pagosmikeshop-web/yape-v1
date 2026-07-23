import { asString, jsonOk, readJson } from "@/app/lib/api-utils";
import { issuePermanentAccessToken } from "@/app/lib/access-server";
import { requireUnlockedSession, routeError } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

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
