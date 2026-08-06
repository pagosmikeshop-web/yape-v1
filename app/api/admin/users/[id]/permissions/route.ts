import { jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requireUnlockedSession,
  routeError,
  type AuthUser,
} from "@/app/lib/auth-server";
import {
  basePermissions,
  DELEGABLE_PERMISSIONS,
  isPermission,
  OWNER_ONLY_PERMISSIONS,
  permissionCatalog,
  permissionsFor,
  requirePermission,
} from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

type TargetUser = {
  id: string;
  role: "admin" | "seller" | "client";
  is_owner: number;
  owner_id: string | null;
};

async function permissionTarget(actorId: string, actorIsOwner: boolean, id: string) {
  const target = await dbBinding().prepare(
    `SELECT id, role, is_owner, owner_id
     FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
  ).bind(id).first<TargetUser>();
  if (!target || target.role === "client" || target.is_owner) return null;
  if (!actorIsOwner && (target.role !== "seller" || target.owner_id !== actorId)) return null;
  return target;
}

function targetAuthUser(actor: AuthUser, target: TargetUser): AuthUser {
  return {
    ...actor,
    id: target.id,
    role: target.role,
    roles: [target.role],
    isOwner: Boolean(target.is_owner),
  };
}

function editablePermissions(actorIsOwner: boolean) {
  if (!actorIsOwner) return [...DELEGABLE_PERMISSIONS];
  const ownerOnly = new Set<string>(OWNER_ONLY_PERMISSIONS);
  return permissionCatalog().filter((permission) => !ownerOnly.has(permission));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    const { id } = await context.params;
    const target = await permissionTarget(actor.id, actor.isOwner, id);
    if (!target) return jsonError("Usuario interno no encontrado o fuera de tu alcance.", 404);
    return jsonOk({
      permissions: [...await permissionsFor(targetAuthUser(actor, target))],
      catalog: actor.isOwner ? permissionCatalog() : [...DELEGABLE_PERMISSIONS],
      editable: editablePermissions(actor.isOwner),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    await enforceAuthRateLimits([
      { bucket: "admin-permissions-put", subject: actor.id, limit: 40, windowSeconds: 15 * 60 },
    ]);
    const { id } = await context.params;
    const target = await permissionTarget(actor.id, actor.isOwner, id);
    if (!target) return jsonError("Usuario interno no encontrado o fuera de tu alcance.", 404);
    /* Solo el owner (roles:manage) puede alterar overrides de permisos. */
    await requirePermission(actor, "roles:manage");

    const body = await readJson(request);
    if (!Array.isArray(body.permissions) || body.permissions.some((entry) => typeof entry !== "string" || !isPermission(entry))) {
      return jsonError("La selección de permisos no es válida.");
    }
    const requested = new Set(body.permissions as string[]);
    const ownerOnly = new Set<string>(OWNER_ONLY_PERMISSIONS);
    for (const permission of requested) {
      if (ownerOnly.has(permission)) {
        return jsonError("Esos permisos solo puede gestionarlos el propietario.", 403);
      }
    }
    const editableList = editablePermissions(actor.isOwner);
    const targetUser = targetAuthUser(actor, target);
    const base = new Set(basePermissions(targetUser));
    const database = dbBinding();
    const now = new Date().toISOString();
    const statements = [
      database.prepare(
        `DELETE FROM rbac_permission_overrides
         WHERE user_id = ? AND permission IN (${editableList.map(() => "?").join(",")})`,
      ).bind(id, ...editableList),
    ];

    for (const permission of editableList) {
      const shouldAllow = requested.has(permission);
      const allowedByRole = base.has(permission);
      if (shouldAllow === allowedByRole) continue;
      statements.push(
        database.prepare(
          `INSERT INTO rbac_permission_overrides
             (user_id, permission, effect, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(id, permission, shouldAllow ? "allow" : "deny", actor.id, now),
      );
    }
    statements.push(
      database.prepare(
        `INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at)
         VALUES (?, ?, 'web_permissions_update', ?, ?)`,
      ).bind(crypto.randomUUID(), actor.telegramUserId ?? actor.id, `${id}:${[...requested].sort().join(",")}`, now),
    );
    await database.batch(statements);
    return jsonOk({
      permissions: [...await permissionsFor(targetUser)],
      message: "Permisos actualizados correctamente.",
    });
  } catch (error) {
    return routeError(error);
  }
}
