import { isAuthorizedCronRequest } from "@/app/lib/internal-cron";
import { reconcileSmsDeliveries } from "@/app/lib/sms-credits-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Revisa los SMS aceptados hasta obtener una entrega final o una devolución. */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return Response.json({ ok: false, error: "No autorizado." }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  try {
    const summary = await reconcileSmsDeliveries();
    return Response.json({ ok: true, ...summary }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { ok: false, error: "La revisión de entrega de SMS no está disponible." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
