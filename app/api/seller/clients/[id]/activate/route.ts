import { jsonError, jsonOk } from "@/app/lib/api-utils";
import { dbBinding, requireUnlockedSession, routeError, trialExpiresAt } from "@/app/lib/auth-server";
import { requireManagedAccount } from "@/app/lib/management-server";
import { requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
    await requirePermission(actor, "clients:update");
    const { id } = await context.params;
    if (actor.role === "admin") {
      const managed = await requireManagedAccount(actor, id);
      if (managed.role !== "client") return jsonError("Cliente no encontrado.", 404);
    }
    const database = dbBinding();
    const client = await database.prepare(
      "SELECT id, owner_id, display_name, status FROM users WHERE id = ? AND role = 'client' AND deleted_at IS NULL LIMIT 1",
    ).bind(id).first<{ id: string; owner_id: string | null; display_name: string; status: string }>();

    if (!client || (actor.role === "seller" && client.owner_id !== actor.id)) {
      return jsonError("Cliente no encontrado.", 404);
    }
    if (client.status === "active") return jsonOk({ message: "El cliente ya estaba activo.", credits: actor.credits });
    if (client.status !== "pending") return jsonError("La cuenta no se encuentra pendiente.", 409);

    const now = new Date().toISOString();
    const accessExpiresAt = trialExpiresAt();
    const activationId = crypto.randomUUID();
    const responsibleId = client.owner_id ?? actor.id;
    const results = await database.batch([
      database.prepare(
        `INSERT INTO activations (id, user_id, seller_id, credits_charged, created_at)
         SELECT ?, id, ?, 0, ? FROM users
         WHERE id = ? AND role = 'client' AND status = 'pending'`,
      ).bind(activationId, responsibleId, now, client.id),
      database.prepare(
        `UPDATE users SET status = 'active', activated_at = ?, access_expires_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'
           AND EXISTS (SELECT 1 FROM activations WHERE id = ? AND user_id = ?)`,
      ).bind(now, accessExpiresAt, now, client.id, activationId, client.id),
      database.prepare(
        `INSERT INTO client_crm_profiles
           (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
         VALUES (?, 'new', 'individual', 'general', '[]', '', ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           crm_status = 'new',
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      ).bind(client.id, now, actor.id, now),
    ]);

    if (Number(results[0]?.meta.changes ?? 0) !== 1 || Number(results[1]?.meta.changes ?? 0) !== 1) {
      return jsonError("La cuenta ya fue procesada.", 409);
    }
    return jsonOk({
      message: `${client.display_name} recibió 3 días gratis. No se descontaron créditos.`,
      credits: actor.credits,
      accessExpiresAt,
    });
  } catch (error) {
    return routeError(error);
  }
}
