import { readJson } from "@/app/lib/api-utils";
import { writeSecurityEvent } from "@/app/lib/security-log";
import {
  inspectTelegramWebhookUpdate,
  processTelegramUpdate,
  sameSecret,
  telegramCommandWebhookSecret,
  telegramWebhookDiagnosticsEnabled,
  TelegramUpdate,
} from "@/app/lib/telegram-manager";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = telegramCommandWebhookSecret();
  const received = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || !received || !(await sameSecret(received, expected))) {
    writeSecurityEvent(request, "telegram.webhook", "denied", { reason: "authentication" });
    return Response.json(
      { ok: false },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const body = await readJson(request, {
      maxBytes: 64 * 1024,
      requireTrustedOrigin: false,
    });
    if (!Number.isSafeInteger(body.update_id) || Number(body.update_id) < 0) {
      writeSecurityEvent(request, "telegram.webhook", "denied", { reason: "invalid_update" });
      return Response.json(
        { ok: false },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const update = body as TelegramUpdate;
    const inspection = inspectTelegramWebhookUpdate(update);
    const processingResult = await processTelegramUpdate(update);
    const duplicate = processingResult === "duplicate";

    if (telegramWebhookDiagnosticsEnabled()) {
      // Fixed categories only: no message text, Telegram IDs, chat IDs or secrets.
      console.info("[telegram-webhook-diagnostic]", {
        timestamp: new Date().toISOString(),
        updateId: inspection.updateId,
        updateType: inspection.updateType,
        chatType: inspection.chatType,
        duplicate,
        processingResult,
      });
    }
    if (processingResult === "processed-me" || processingResult === "processed-redeem") {
      writeSecurityEvent(request, "telegram.webhook", "success", { result: processingResult });
    }
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) {
      writeSecurityEvent(request, "telegram.webhook", "denied", { reason: "invalid_payload", status: error.status });
      return error;
    }
    writeSecurityEvent(request, "telegram.webhook", "failure", { reason: "processing" });
    return Response.json(
      { ok: false, error: "No se pudo procesar la actualización." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
