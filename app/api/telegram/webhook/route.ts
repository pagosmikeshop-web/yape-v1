import { readJson } from "@/app/lib/api-utils";
import { authEnv } from "@/app/lib/auth-server";
import { writeSecurityEvent } from "@/app/lib/security-log";
import { processTelegramUpdate, sameSecret, TelegramUpdate } from "@/app/lib/telegram-manager";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = authEnv().TELEGRAM_WEBHOOK_SECRET ?? "";
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
    await processTelegramUpdate(body as TelegramUpdate);
    writeSecurityEvent(request, "telegram.webhook", "success");
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
