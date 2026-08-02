import { authEnv, dbBinding, secureCompare } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Limpieza programada de datos operativos; nunca se expone a usuarios. */
export async function GET(request: Request) {
  const configured = authEnv().CRON_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (configured.length < 32 || supplied.length < 32 || !(await secureCompare(configured, supplied))) {
    return Response.json({ ok: false, error: "No autorizado." }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  try {
    await dbBinding().prepare("SELECT public.yape_operational_retention() AS cleaned").run();
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { ok: false, error: "La limpieza programada no está disponible." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
