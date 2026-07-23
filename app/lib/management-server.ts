import { AuthUser, dbBinding } from "@/app/lib/auth-server";

export type ManagedAccount = {
  id: string;
  role: "admin" | "seller" | "client";
  is_owner: number;
  owner_id: string | null;
  deleted_at: string | null;
};

export function effectiveRole(user: Pick<AuthUser, "role" | "isOwner">) {
  return user.role === "admin" && user.isOwner ? "owner" : user.role;
}

export async function findManagedAccount(userId: string) {
  return dbBinding().prepare(
    `SELECT id, role, is_owner, owner_id, deleted_at
     FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
  ).bind(userId).first<ManagedAccount>();
}

export async function canManageAccount(actor: AuthUser, target: ManagedAccount) {
  if (actor.role !== "admin" || target.deleted_at) return false;
  if (actor.isOwner) return true;
  if (target.role === "admin") return false;
  if (target.role === "seller") return target.owner_id === actor.id;
  if (target.owner_id === actor.id) return true;
  if (!target.owner_id) return false;
  const seller = await dbBinding().prepare(
    `SELECT owner_id FROM users
     WHERE id = ? AND role = 'seller' AND deleted_at IS NULL LIMIT 1`,
  ).bind(target.owner_id).first<{ owner_id: string | null }>();
  return seller?.owner_id === actor.id;
}

export async function requireManagedAccount(actor: AuthUser, userId: string) {
  const target = await findManagedAccount(userId);
  if (!target || !(await canManageAccount(actor, target))) {
    throw Response.json(
      { ok: false, error: "Usuario no encontrado o fuera de tu alcance." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  return target;
}

export async function canManageSeller(actor: AuthUser, sellerId: string) {
  const target = await findManagedAccount(sellerId);
  return Boolean(target && target.role === "seller" && await canManageAccount(actor, target));
}
