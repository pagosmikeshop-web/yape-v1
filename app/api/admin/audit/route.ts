import { jsonOk } from "@/app/lib/api-utils";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(actor, "audit:view");

    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 80).toLocaleLowerCase("es-PE");
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));

    const conditions: string[] = [];
    const values: unknown[] = [];
    if (!actor.isOwner) {
      conditions.push(`(
        l.telegram_user_id = ?
        OR l.telegram_user_id IN (
          SELECT COALESCE(telegram_user_id, id)
          FROM users
          WHERE role = 'seller' AND owner_id = ? AND deleted_at IS NULL
        )
      )`);
      values.push(actor.telegramUserId ?? actor.id, actor.id);
    }
    if (search) {
      conditions.push(`(
        LOWER(l.command) LIKE ? OR LOWER(l.outcome) LIKE ? OR LOWER(l.telegram_user_id) LIKE ?
      )`);
      const term = `%${search}%`;
      values.push(term, term, term);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const database = dbBinding();
    const totalRow = await database.prepare(
      `SELECT COUNT(*) AS total FROM manager_audit_log l ${whereSql}`,
    ).bind(...values).first<{ total: number }>();
    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);

    const result = await database.prepare(
      `SELECT l.id, l.telegram_user_id, l.command, l.outcome, l.created_at
       FROM manager_audit_log l
       ${whereSql}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(...values, pageSize, (safePage - 1) * pageSize).all();

    return jsonOk({
      logs: result.results ?? [],
      pagination: { page: safePage, pageSize, total, totalPages },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
