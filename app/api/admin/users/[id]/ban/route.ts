import { jsonError, jsonOk } from "@/app/lib/api-utils";
import {
  dbBinding,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import { requireManagedAccount } from "@/app/lib/management-server";
import { buildBanUserStatements } from "@/app/lib/admin-user-cleanup";

export const dynamic = "force-dynamic";

type BanTarget = {
  id: string;
  telegram_user_id: string | null;
  role: string;
  is_owner: number;
  deleted_at: string | null;
};

/**
 * Bans an account and removes its data in the same database batch.
 * The blacklist row is written before cleanup so a failed batch leaves the
 * account intact instead of creating a partial ban.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    if (!actor.isOwner) return jsonError("Solo el Owner puede banear cuentas.", 403);

    const { id } = await context.params;
    if (id === actor.id) return jsonError("No puedes banear tu propia cuenta.", 409);

    const target = await requireManagedAccount(actor, id);
    if (target.is_owner) return jsonError("La cuenta Owner no puede banearse.", 403);
    if (target.role !== "client" && target.roles?.includes("client")) {
      return jsonError(
        "Esta cuenta también tiene acceso a la app. Retira primero el rol del panel para conservarla.",
        409,
      );
    }

    const database = dbBinding();
    const current = await database
      .prepare(
        `SELECT id, telegram_user_id, role, is_owner, deleted_at
         FROM users
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(id)
      .first<BanTarget>();
    if (!current) return jsonError("Usuario no encontrado.", 404);
    if (!current.telegram_user_id) {
      return jsonError("La cuenta no tiene un Telegram vinculado.", 409);
    }

    const dependents = await database
      .prepare("SELECT COUNT(*) AS total FROM users WHERE owner_id = ? AND deleted_at IS NULL")
      .bind(id)
      .first<{ total: number }>();
    if (Number(dependents?.total ?? 0) > 0) {
      return jsonError("Primero reasigna o elimina las cuentas que dependen de este usuario.", 409);
    }

    const now = new Date().toISOString();
    await database.batch(
      buildBanUserStatements(
        database,
        current.id,
        current.telegram_user_id,
        actor.id,
        actor.telegramUserId,
        current.role,
        now,
      ),
    );

    return jsonOk({
      message: "Cuenta baneada. Sus registros fueron eliminados y no podrá registrarse nuevamente.",
    });
  } catch (error) {
    return routeError(error);
  }
}
