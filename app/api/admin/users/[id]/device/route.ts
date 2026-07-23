import { jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { requireManagedAccount } from "@/app/lib/management-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    await readJson(request);
    const { id } = await context.params;
    const target = await requireManagedAccount(actor, id);
    if (target.role !== "client") {
      return jsonError("El restablecimiento de dispositivo solo está disponible para clientes.", 409);
    }

    const database = dbBinding();
    const now = new Date().toISOString();
    const results = await database.batch([
      database.prepare(
        `UPDATE users
         SET device_id = NULL, device_public_key = NULL, updated_at = ?
         WHERE id = ? AND role = 'client' AND deleted_at IS NULL`,
      ).bind(now, id),
      database.prepare(
        `DELETE FROM sessions
         WHERE user_id = ?
           AND EXISTS (
             SELECT 1 FROM users
             WHERE id = ? AND role = 'client' AND deleted_at IS NULL
           )`,
      ).bind(id, id),
      database.prepare(
        `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
         VALUES (?, ?, 'web_reset_client_device', ?, ?)`,
      ).bind(crypto.randomUUID(), actor.telegramUserId ?? actor.id, id, now),
    ]);

    if (Number(results[0]?.meta.changes ?? 0) !== 1) {
      return jsonError("No se pudo restablecer el dispositivo del cliente.", 409);
    }

    return jsonOk({
      message: "Dispositivo restablecido. Las sesiones anteriores se cerraron y el cliente ya puede ingresar nuevamente.",
    });
  } catch (error) {
    return routeError(error);
  }
}
