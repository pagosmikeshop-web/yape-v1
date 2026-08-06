import { jsonError, jsonOk } from "@/app/lib/api-utils";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: approver } = await requireUnlockedSession(request, ["seller", "admin"]);
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/iu.test(id)) return jsonError("Solicitud no valida.", 400);
    const database = dbBinding();
    const reset = await database.prepare(
      `SELECT r.id, r.status, r.seller_id,
              s.owner_id AS seller_owner_id
       FROM password_reset_requests r
       JOIN users s ON s.id = r.seller_id
       WHERE r.id = ?
       LIMIT 1`,
    ).bind(id).first<{ id: string; status: string; seller_id: string; seller_owner_id: string | null }>();
    if (!reset) return jsonError("Solicitud no encontrada.", 404);

    const allowed = approver.isOwner
      || (approver.role === "seller" && reset.seller_id === approver.id)
      || (approver.role === "admin" && (reset.seller_id === approver.id || reset.seller_owner_id === approver.id));
    if (!allowed) return jsonError("No tienes permiso para aprobar esta solicitud.", 403);
    if (reset.status !== "pending") return jsonError("Esta solicitud ya fue atendida.", 409);

    const result = await database.prepare(
      `UPDATE password_reset_requests
       SET status = 'approved', approved_at = ?, approved_by = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(new Date().toISOString(), approver.id, id).run();
    if (Number(result.meta.changes ?? 0) !== 1) return jsonError("Esta solicitud ya fue atendida.", 409);
    return jsonOk({ message: "Restablecimiento aprobado. El cliente ya puede crear una nueva contraseña." });
  } catch (error) {
    return routeError(error);
  }
}
