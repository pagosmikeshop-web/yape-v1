import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { requireManagedAccount } from "@/app/lib/management-server";
import { requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: admin } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(admin, "clients:update");
    const { id } = await context.params;
    const managed = await requireManagedAccount(admin, id);
    if (managed.role !== "client") return jsonError("Cliente no encontrado.", 404);
    const body = await readJson(request);
    const mode = asString(body.mode);
    const days = Number(body.days);
    if (mode !== "permanent" && mode !== "days") return jsonError("Selecciona un tipo de acceso válido.");
    if (mode === "days" && (!Number.isInteger(days) || days < 0 || days > 3650)) {
      return jsonError("Los días deben ser un entero entre 0 y 3650.");
    }

    const database = dbBinding();
    const client = await database.prepare(
      `SELECT id, display_name, status FROM users
       WHERE id = ? AND (role = 'client' OR EXISTS (
         SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client'
       )) LIMIT 1`,
    ).bind(id).first<{ id: string; display_name: string; status: string }>();
    if (!client) return jsonError("Cliente no encontrado.", 404);
    if (client.status !== "active") return jsonError("Activa la cuenta antes de modificar su acceso.", 409);

    const now = new Date().toISOString();
    const accessExpiresAt = mode === "permanent" ? null : new Date(Date.now() + days * 86_400_000).toISOString();
    const crmStatus = mode === "permanent" ? "vip" : "new";
    const results = await database.batch([
      database.prepare(
        `UPDATE users SET access_expires_at = ?, updated_at = ?
         WHERE id = ? AND (role = 'client' OR EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.role = 'client'
         ))`,
      ).bind(accessExpiresAt, now, client.id),
      database.prepare(
        `INSERT INTO client_crm_profiles
           (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
         VALUES (?, ?, 'individual', 'general', '[]', '', ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           crm_status = excluded.crm_status,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      ).bind(client.id, crmStatus, now, admin.id, now),
      database.prepare(
        "INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        admin.telegramUserId ?? admin.id,
        "web_access_update",
        `${client.id}:${mode}:${mode === "days" ? days : "permanent"}`,
        now,
      ),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return jsonError("No se pudo actualizar el acceso.", 409);
    return jsonOk({
      accessExpiresAt,
      permanent: mode === "permanent",
      message: mode === "permanent"
        ? `${client.display_name} ahora tiene acceso permanente.`
        : `${client.display_name} ahora tiene ${days} días de acceso.`,
    });
  } catch (error) {
    return routeError(error);
  }
}
