import { parseJsonObject, readJsonText } from "@/app/lib/api-utils";
import { writeSecurityEvent } from "@/app/lib/security-log";
import { processTelegramCommand, TelegramUpdate } from "@/app/lib/telegram-manager";
import {
  TELEGRAM_VPS_SIGNATURE_HEADER,
  TELEGRAM_VPS_TIMESTAMP_HEADER,
  verifyTelegramVpsForward,
} from "@/app/lib/telegram-vps-forward";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rawBody = await readJsonText(request, {
      maxBytes: 64 * 1024,
      requireTrustedOrigin: false,
    });
    const timestamp = request.headers.get(TELEGRAM_VPS_TIMESTAMP_HEADER) ?? "";
    const signature = request.headers.get(TELEGRAM_VPS_SIGNATURE_HEADER) ?? "";
    if (!(await verifyTelegramVpsForward(rawBody, timestamp, signature))) {
      writeSecurityEvent(request, "telegram.vps_forward", "denied", { reason: "authentication" });
      return Response.json({ ok: false }, { status: 401, headers: { "cache-control": "no-store" } });
    }

    const body = parseJsonObject(rawBody);
    if (!Number.isSafeInteger(body.update_id) || Number(body.update_id) < 0) {
      writeSecurityEvent(request, "telegram.vps_forward", "denied", { reason: "invalid_update" });
      return Response.json({ ok: false }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    const processing = await processTelegramCommand(body as TelegramUpdate);
    if (processing.processingResult === "processed-me" || processing.processingResult === "processed-redeem") {
      writeSecurityEvent(request, "telegram.vps_forward", "success", { result: processing.processingResult });
    }
    return Response.json(
      { ok: true, result: processing.processingResult, ...(processing.reply ? { reply: processing.reply } : {}) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Response) return error;
    writeSecurityEvent(request, "telegram.vps_forward", "failure", { reason: "processing" });
    return Response.json({ ok: false }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
