import { dbBinding, type AuthUser, userHasRole } from "@/app/lib/auth-server";

export type StaffRole = "owner" | "admin" | "seller";

export type Permission =
  | "dashboard:view"
  | "staff:view"
  | "admins:create"
  | "admins:update"
  | "admins:delete"
  | "sellers:create"
  | "sellers:update"
  | "sellers:delete"
  | "sellers:credits"
  | "clients:view"
  | "clients:view_all"
  | "clients:create"
  | "clients:update"
  | "clients:assign"
  | "clients:suspend"
  | "clients:delete"
  | "clients:export"
  | "clients:activity"
  | "keys:view"
  | "keys:view_all"
  | "keys:create"
  | "sales:view"
  | "payments:view"
  | "reports:view"
  | "settings:view"
  | "settings:update"
  | "roles:manage"
  | "security:view"
  | "audit:view";

const ALL_PERMISSIONS: readonly Permission[] = [
  "dashboard:view",
  "staff:view",
  "admins:create",
  "admins:update",
  "admins:delete",
  "sellers:create",
  "sellers:update",
  "sellers:delete",
  "sellers:credits",
  "clients:view",
  "clients:view_all",
  "clients:create",
  "clients:update",
  "clients:assign",
  "clients:suspend",
  "clients:delete",
  "clients:export",
  "clients:activity",
  "keys:view",
  "keys:view_all",
  "keys:create",
  "sales:view",
  "payments:view",
  "reports:view",
  "settings:view",
  "settings:update",
  "roles:manage",
  "security:view",
  "audit:view",
] as const;

const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: [
    "dashboard:view",
    "staff:view",
    "sellers:create",
    "sellers:update",
    "sellers:delete",
    "sellers:credits",
    "clients:view",
    "clients:view_all",
    "clients:create",
    "clients:update",
    "clients:assign",
    "clients:suspend",
    "clients:delete",
    "clients:export",
    "clients:activity",
    "keys:view",
    "keys:view_all",
    "keys:create",
    "sales:view",
    "payments:view",
    "reports:view",
    "settings:view",
    "security:view",
    "audit:view",
  ],
  seller: [
    "dashboard:view",
    "clients:view",
    "clients:create",
    "clients:update",
    "clients:activity",
    "keys:view",
    "keys:create",
    "sales:view",
    "payments:view",
  ],
};

export function staffRole(user: Pick<AuthUser, "role" | "isOwner">): StaffRole {
  const withRoles = user as Pick<AuthUser, "role" | "roles" | "isOwner">;
  return userHasRole(withRoles, "admin") && user.isOwner
    ? "owner"
    : userHasRole(withRoles, "admin")
      ? "admin"
      : "seller";
}

export function basePermissions(user: Pick<AuthUser, "role" | "isOwner">) {
  const withRoles = user as Pick<AuthUser, "role" | "roles" | "isOwner">;
  if (!userHasRole(withRoles, "admin") && !userHasRole(withRoles, "seller")) return [] as Permission[];
  return [...ROLE_PERMISSIONS[staffRole(user)]];
}

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

export function permissionCatalog() {
  return [...ALL_PERMISSIONS];
}

export const DELEGABLE_PERMISSIONS: readonly Permission[] = [
  "clients:view_all",
  "clients:assign",
  "clients:export",
  "reports:view",
] as const;

/** Permisos exclusivos del Owner: nunca se otorgan por override a admin/vendedor. */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = [
  "admins:create",
  "admins:update",
  "admins:delete",
  "roles:manage",
  "settings:update",
] as const;

export async function permissionsFor(user: AuthUser) {
  const permissions = new Set(basePermissions(user));
  if ((!userHasRole(user, "admin") && !userHasRole(user, "seller")) || user.isOwner) return permissions;

  const overrides = await dbBinding().prepare(
    `SELECT permission, effect
     FROM rbac_permission_overrides
     WHERE user_id = ?`,
  ).bind(user.id).all<{ permission: string; effect: "allow" | "deny" }>();

  for (const override of overrides.results ?? []) {
    if (!isPermission(override.permission)) continue;
    if (override.effect === "allow") permissions.add(override.permission);
    else permissions.delete(override.permission);
  }
  for (const permission of OWNER_ONLY_PERMISSIONS) {
    permissions.delete(permission);
  }
  return permissions;
}

export async function hasPermission(user: AuthUser, permission: Permission) {
  return (await permissionsFor(user)).has(permission);
}

export async function requirePermission(user: AuthUser, permission: Permission) {
  if (await hasPermission(user, permission)) return;
  throw Response.json(
    {
      ok: false,
      code: "PERMISSION_DENIED",
      error: "No tienes permisos para realizar esta acción.",
      permission,
    },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}

/** Valida el acceso exclusivo del Owner sin duplicar la respuesta en cada ruta. */
export function assertOwner(actor: Pick<AuthUser, "isOwner">) {
  if (actor.isOwner) return;
  throw Response.json(
    {
      ok: false,
      code: "OWNER_ONLY",
      error: "Esta sección está disponible únicamente para el Owner.",
    },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
