import { jsonOk } from "@/app/lib/api-utils";
import { authEnv, dbBinding, secureCompare } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

/**
 * Público: liveness del proceso (sin tocar la base).
 * Profundo: Authorization Bearer CRON_SECRET → también verifica DB.
 */
export async function GET(request: Request) {
  const configured = authEnv().CRON_SECRET?.trim() ?? "";
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim() ?? "";
  const deep = configured.length >= 32 && bearer.length > 0 && await secureCompare(bearer, configured);

  if (!deep) {
    return jsonOk(
      { status: "ready" },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const row = await dbBinding().prepare("SELECT 1 AS ready").first<{ ready: number }>();
    if (row?.ready !== 1) throw new Error("database-not-ready");
    return jsonOk(
      { status: "ready", database: "available" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
