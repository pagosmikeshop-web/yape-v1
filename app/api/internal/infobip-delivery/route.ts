import { parseInfobipSmsDeliveryReports } from "@/app/lib/infobip-sms";
import { processInfobipDeliveryReport } from "@/app/lib/sms-credits-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Recibe estados de Infobip; cada evento se valida con un nonce por SMS. */
export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const reports = parseInfobipSmsDeliveryReports(payload);
  if (reports.length === 0) {
    return Response.json({ ok: false }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  try {
    for (const report of reports) await processInfobipDeliveryReport(report);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
