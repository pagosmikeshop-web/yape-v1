import { jsonError, jsonOk } from "@/app/lib/api-utils";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { requireManagedAccount } from "@/app/lib/management-server";
import { requirePermission } from "@/app/lib/rbac";
import { activateClientTrial } from "@/app/lib/trial-activation";

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

    const responsibleId = client.owner_id ?? actor.id;
    const trial = await activateClientTrial({
      userId: client.id,
      sellerId: responsibleId,
      updatedBy: actor.id,
    });

    if (!trial.ok) {
      if (trial.reason === "not-found") return jsonError("Cliente no encontrado.", 404);
      if (trial.reason === "disabled") return jsonError("La cuenta está deshabilitada.", 409);
      if (trial.reason === "not-pending") return jsonError("La cuenta no se encuentra pendiente.", 409);
      return jsonError("La cuenta ya fue procesada.", 409);
    }

    if (!trial.activated) {
      return jsonOk({
        message: "El cliente ya estaba activo.",
        credits: actor.credits,
        accessExpiresAt: trial.accessExpiresAt,
      });
    }

    return jsonOk({
      message: `${client.display_name} recibió 3 días gratis. No se descontaron créditos.`,
      credits: actor.credits,
      accessExpiresAt: trial.accessExpiresAt,
    });
  } catch (error) {
    return routeError(error);
  }
}
