import { jsonOk } from "@/app/lib/api-utils";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(actor, "audit:view");
    const database = dbBinding();
    const result = actor.isOwner
      ? await database.prepare(
        `SELECT id, telegram_user_id, command, outcome, created_at
         FROM manager_audit_log ORDER BY created_at DESC LIMIT 250`,
      ).all()
      : await database.prepare(
        `SELECT l.id, l.telegram_user_id, l.command, l.outcome, l.created_at
         FROM manager_audit_log l
         WHERE l.telegram_user_id = ?
            OR l.telegram_user_id IN (
              SELECT COALESCE(telegram_user_id, id)
              FROM users
              WHERE role = 'seller' AND owner_id = ? AND deleted_at IS NULL
            )
         ORDER BY l.created_at DESC LIMIT 250`,
      ).bind(actor.telegramUserId ?? actor.id, actor.id).all();
    return jsonOk({ logs: result.results ?? [] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
