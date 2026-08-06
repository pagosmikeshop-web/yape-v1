import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  grantUserRole,
  requireUnlockedSession,
  revokeUserRole,
  routeError,
  type AppRole,
} from "@/app/lib/auth-server";
import { requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS = new Set(["telegramUserId", "role"]);

/**
 * Promueve una cuenta de la app sin crear otra identidad de Telegram.
 * Solo el Owner puede conceder roles administrativos porque `roles:manage`
 * está reservado a ese nivel en RBAC.
 */
export async function POST(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    await enforceAuthRateLimits([
      { bucket: "admin-roles-mutate", subject: actor.id, limit: 30, windowSeconds: 15 * 60 },
    ]);
    await requirePermission(actor, "roles:manage");
    const body = await readJson(request);
    if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
      return jsonError("La solicitud de roles no es válida.", 400);
    }

    const telegramUserId = asString(body.telegramUserId).trim();
    const requestedRole = asString(body.role).trim() as Extract<AppRole, "admin" | "seller">;
    if (!/^\d{4,24}$/u.test(telegramUserId)) {
      return jsonError("Ingresa un Telegram ID válido.", 400);
    }
    if (requestedRole !== "seller" && requestedRole !== "admin") {
      return jsonError("Selecciona un rol válido.", 400);
    }

    const target = await dbBinding().prepare(
      `SELECT id, display_name, username, role, status
       FROM users
       WHERE telegram_user_id = ? AND deleted_at IS NULL
       LIMIT 1`,
    ).bind(telegramUserId).first<{
      id: string;
      display_name: string;
      username: string;
      role: AppRole;
      status: string;
    }>();
    if (!target) return jsonError("No encontramos una cuenta activa con ese Telegram ID.", 404);
    if (target.status !== "active" || target.role !== "client") {
      return jsonError("La cuenta ya tiene un acceso administrativo o no está activa.", 409);
    }

    const promoted = await grantUserRole({
      userId: target.id,
      role: requestedRole,
      grantedBy: actor.id,
    });
    if (!promoted) return jsonError("No se pudo actualizar el rol de la cuenta.", 409);

    return jsonOk({
      user: {
        id: promoted.id,
        displayName: promoted.display_name,
        username: promoted.username,
        telegramUserId,
        role: promoted.role,
        roles: promoted.roles ?? [promoted.role],
      },
      message: `${requestedRole === "seller" ? "Vendedor" : "Administrador"} añadido. La cuenta conserva su acceso a la app.`,
    }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    await enforceAuthRateLimits([
      { bucket: "admin-roles-mutate", subject: actor.id, limit: 30, windowSeconds: 15 * 60 },
    ]);
    await requirePermission(actor, "roles:manage");
    const body = await readJson(request);
    if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
      return jsonError("La solicitud de roles no es válida.", 400);
    }

    const telegramUserId = asString(body.telegramUserId).trim();
    const requestedRole = asString(body.role).trim() as Extract<AppRole, "admin" | "seller">;
    if (!/^\d{4,24}$/u.test(telegramUserId)) return jsonError("Ingresa un Telegram ID válido.", 400);
    if (requestedRole !== "seller" && requestedRole !== "admin") return jsonError("Selecciona un rol válido.", 400);

    const target = await dbBinding().prepare(
      `SELECT id, role, status FROM users
       WHERE telegram_user_id = ? AND deleted_at IS NULL LIMIT 1`,
    ).bind(telegramUserId).first<{ id: string; role: AppRole; status: string }>();
    if (!target || target.status !== "active") return jsonError("No encontramos una cuenta activa con ese Telegram ID.", 404);
    if (target.role !== requestedRole) return jsonError("La cuenta no tiene ese acceso administrativo.", 409);

    const demoted = await revokeUserRole({
      userId: target.id,
      role: requestedRole,
      revokedBy: actor.id,
    });
    if (!demoted) return jsonError("La cuenta debe conservar su acceso de cliente para quitar el rol.", 409);

    return jsonOk({
      user: {
        id: demoted.id,
        role: demoted.role,
        roles: demoted.roles ?? [demoted.role],
      },
      message: "Acceso al panel retirado. La cuenta conserva su acceso a la app.",
    });
  } catch (error) {
    return routeError(error);
  }
}
