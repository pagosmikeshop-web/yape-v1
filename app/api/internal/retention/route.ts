import { dbBinding } from "@/app/lib/auth-server";
import { isAuthorizedCronRequest } from "@/app/lib/internal-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Limpieza programada de datos operativos; nunca se expone a usuarios. */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
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
