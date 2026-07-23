import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { requireClientAccess } from "@/app/lib/management-server";

export const dynamic = "force-dynamic";

const ACTIVITY_TYPES = new Set(["purchase", "payment", "conversation", "quote", "note", "status"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
    const { id } = await context.params;
    await requireClientAccess(actor, id, "clients:view");
    const result = await dbBinding().prepare(
      `SELECT a.id, a.activity_type, a.title, a.description, a.amount_cents, a.created_at,
              u.display_name AS created_by_name
       FROM client_crm_activities a
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC LIMIT 200`,
    ).bind(id).all();
    return jsonOk({ activities: result.results ?? [] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
    const { id } = await context.params;
    await requireClientAccess(actor, id, "clients:activity");
    const body = await readJson(request);
    const activityType = asString(body.activityType);
    const title = asString(body.title).trim().slice(0, 100);
    const description = asString(body.description).trim().slice(0, 1000);
    const amountCents = Math.round(Number(body.amount) * 100);
    if (!ACTIVITY_TYPES.has(activityType) || title.length < 2) return jsonError("Tipo de actividad o título inválido.");
    if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > 100_000_000_00) {
      return jsonError("El importe no es válido.");
    }
    const database = dbBinding();
    const now = new Date().toISOString();
    const activityId = crypto.randomUUID();
    await database.batch([
      database.prepare(
        `INSERT INTO client_crm_activities
           (id, user_id, activity_type, title, description, amount_cents, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(activityId, id, activityType, title, description, amountCents, actor.id, now),
      database.prepare(
        `INSERT INTO client_crm_profiles
           (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
         VALUES (?, 'new', 'individual', 'general', '[]', '', ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           last_activity_at = excluded.last_activity_at,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      ).bind(id, now, actor.id, now),
      database.prepare(
        `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
         VALUES (?, ?, 'crm_activity_create', ?, ?)`,
      ).bind(crypto.randomUUID(), actor.telegramUserId ?? actor.id, `${id}:${activityType}:${activityId}`, now),
    ]);
    return jsonOk({
      activity: { id: activityId, activityType, title, description, amountCents, createdAt: now },
      message: "Actividad registrada en el historial.",
    }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
