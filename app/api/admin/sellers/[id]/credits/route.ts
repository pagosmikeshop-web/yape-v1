import { jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { dbBinding, enforceAuthRateLimits, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { canManageSeller } from "@/app/lib/management-server";
import { requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: admin } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(admin, "sellers:credits");
    await enforceAuthRateLimits([
      {
        bucket: "credits-assign-user",
        subject: admin.id,
        limit: 40,
        windowSeconds: 60 * 60,
      },
    ]);
    const { id } = await context.params;
    if (!(await canManageSeller(admin, id))) return jsonError("Vendedor no encontrado.", 404);
    const body = await readJson(request);
    const amount = Number(body.amount);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!Number.isInteger(amount) || amount < 1 || amount > 10_000) {
      return jsonError("La cantidad debe ser un entero entre 1 y 10000.");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(idempotencyKey)) {
      return jsonError("Falta una clave de idempotencia válida.");
    }

    const database = dbBinding();
    const seller = await database.prepare(
      "SELECT id, display_name FROM users WHERE id = ? AND role = 'seller' AND status = 'active' LIMIT 1",
    ).bind(id).first<{ id: string; display_name: string }>();
    if (!seller) return jsonError("Vendedor activo no encontrado.", 404);

    const previous = await database.prepare(
      "SELECT balance_after FROM credit_ledger WHERE reason = 'web_credit_assignment' AND reference_id = ? AND seller_id = ? LIMIT 1",
    ).bind(idempotencyKey, seller.id).first<{ balance_after: number }>();
    if (previous) return jsonOk({ credits: Number(previous.balance_after), message: "La asignación ya había sido procesada." });

    const now = new Date().toISOString();
    const results = await database.batch([
      database.prepare(
        "UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ? AND role = 'seller' AND status = 'active'",
      ).bind(amount, now, seller.id),
      database.prepare(
        `INSERT INTO credit_ledger (
          id, seller_id, delta, balance_after, reason, reference_id, created_by, created_at
        ) SELECT ?, id, ?, credits, 'web_credit_assignment', ?, ?, ?
          FROM users WHERE id = ? AND role = 'seller' AND status = 'active'`,
      ).bind(crypto.randomUUID(), amount, idempotencyKey, admin.id, now, seller.id),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return jsonError("No se pudieron asignar los créditos.", 409);

    const balance = await database.prepare("SELECT credits FROM users WHERE id = ? LIMIT 1")
      .bind(seller.id).first<{ credits: number }>();
    return jsonOk({
      credits: Number(balance?.credits ?? 0),
      message: `Se asignaron ${amount} créditos a ${seller.display_name}.`,
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: admin } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(admin, "sellers:credits");
    await enforceAuthRateLimits([
      {
        bucket: "credits-assign-user",
        subject: admin.id,
        limit: 40,
        windowSeconds: 60 * 60,
      },
    ]);
    const { id } = await context.params;
    if (!(await canManageSeller(admin, id))) return jsonError("Vendedor no encontrado.", 404);
    const body = await readJson(request);
    const credits = Number(body.credits);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!Number.isInteger(credits) || credits < 0 || credits > 1_000_000) {
      return jsonError("El saldo debe ser un entero entre 0 y 1000000.");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(idempotencyKey)) {
      return jsonError("Falta una clave de idempotencia válida.");
    }

    const database = dbBinding();
    const seller = await database.prepare(
      "SELECT id, display_name, credits FROM users WHERE id = ? AND role = 'seller' AND status = 'active' LIMIT 1",
    ).bind(id).first<{ id: string; display_name: string; credits: number }>();
    if (!seller) return jsonError("Vendedor activo no encontrado.", 404);
    const previous = await database.prepare(
      "SELECT balance_after FROM credit_ledger WHERE reason = 'web_credit_set' AND reference_id = ? AND seller_id = ? LIMIT 1",
    ).bind(idempotencyKey, seller.id).first<{ balance_after: number }>();
    if (previous) return jsonOk({ credits: Number(previous.balance_after), message: "El cambio ya había sido procesado." });

    const delta = credits - Number(seller.credits);
    const now = new Date().toISOString();
    const results = await database.batch([
      database.prepare("UPDATE users SET credits = ?, updated_at = ? WHERE id = ? AND role = 'seller' AND status = 'active'")
        .bind(credits, now, seller.id),
      database.prepare(
        `INSERT INTO credit_ledger (
          id, seller_id, delta, balance_after, reason, reference_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, 'web_credit_set', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), seller.id, delta, credits, idempotencyKey, admin.id, now),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return jsonError("No se pudo actualizar el saldo.", 409);
    return jsonOk({ credits, message: `${seller.display_name} ahora tiene ${credits} créditos.` });
  } catch (error) {
    return routeError(error);
  }
}
