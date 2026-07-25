import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  AppRole,
  createUser,
  dbBinding,
  generateTemporaryPassword,
  linkTelegramIdentity,
  publicAppBaseUrl,
  requireUnlockedSession,
  routeError,
  validateDisplayName,
  validateOptionalEmail,
  validateSellerCode,
  validateUsername,
} from "@/app/lib/auth-server";
import { createInvitation } from "@/app/lib/invitation-server";
import { requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

type ListedUser = {
  id: string;
  seller_code: string;
  username: string;
  display_name: string;
  email: string;
  role: AppRole;
  effective_role: "owner" | AppRole;
  is_owner: number;
  owner_id: string | null;
  status: string;
  credits: number;
  telegram_user_id: string | null;
  referral_code: string | null;
  access_expires_at: string | null;
  created_at: string;
  activated_at: string | null;
};

export async function GET(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(actor, "staff:view");

    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 80).toLocaleLowerCase("es-PE");
    const roleFilter = url.searchParams.get("role") ?? "";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));

    const scopeConditions = ["deleted_at IS NULL", "role IN ('admin','seller')"];
    const scopeValues: unknown[] = [];
    if (!actor.isOwner) {
      scopeConditions.push("(id = ? OR (role = 'seller' AND owner_id = ?))");
      scopeValues.push(actor.id, actor.id);
    }
    const conditions = [...scopeConditions];
    const values: unknown[] = [...scopeValues];
    if (roleFilter === "admin" || roleFilter === "seller") {
      conditions.push("role = ?");
      values.push(roleFilter);
    }
    if (search) {
      conditions.push(`(
        LOWER(display_name) LIKE ? OR LOWER(username) LIKE ? OR
        LOWER(email) LIKE ? OR LOWER(seller_code) LIKE ? OR
        LOWER(COALESCE(telegram_user_id, '')) LIKE ?
      )`);
      const term = `%${search}%`;
      values.push(term, term, term, term, term);
    }

    const whereSql = conditions.join(" AND ");
    const [totalRow, summaryRow] = await Promise.all([
      dbBinding().prepare(
        `SELECT COUNT(*) AS total FROM users WHERE ${whereSql}`,
      ).bind(...values).first<{ total: number }>(),
      dbBinding().prepare(
        `SELECT
           SUM(CASE WHEN is_owner = 1 THEN 1 ELSE 0 END) AS owners,
           SUM(CASE WHEN role = 'admin' AND is_owner = 0 THEN 1 ELSE 0 END) AS admins,
           SUM(CASE WHEN role = 'seller' THEN 1 ELSE 0 END) AS sellers,
           COUNT(*) AS active
         FROM users
         WHERE ${scopeConditions.join(" AND ")}`,
      ).bind(...scopeValues).first<{
        owners: number;
        admins: number;
        sellers: number;
        active: number;
      }>(),
    ]);
    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);

    const result = await dbBinding().prepare(
      `SELECT id, seller_code, username, display_name, email, role,
              CASE WHEN role = 'admin' AND is_owner = 1 THEN 'owner' ELSE role END AS effective_role,
              is_owner, owner_id, status, credits, telegram_user_id, referral_code,
              access_expires_at, created_at, activated_at
       FROM users
       WHERE ${whereSql}
       ORDER BY is_owner DESC, role, created_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(...values, pageSize, (safePage - 1) * pageSize).all<ListedUser>();

    return jsonOk({
      users: result.results ?? [],
      viewerRole: actor.isOwner ? "owner" : "admin",
      pagination: { page: safePage, pageSize, total, totalPages },
      summary: {
        owners: Number(summaryRow?.owners ?? 0),
        admins: Number(summaryRow?.admins ?? 0),
        sellers: Number(summaryRow?.sellers ?? 0),
        active: Number(summaryRow?.active ?? 0),
      },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    const body = await readJson(request);
    const requestedRole = asString(body.role) || "seller";
    const sellerCode = asString(body.sellerCode);
    const username = asString(body.username);
    const displayName = asString(body.displayName).trim();
    const email = asString(body.email);

    if (requestedRole !== "seller" && requestedRole !== "admin") return jsonError("Rol administrativo inválido.");
    await requirePermission(actor, requestedRole === "admin" ? "admins:create" : "sellers:create");
    if (
      !validateSellerCode(sellerCode)
      || !validateUsername(username)
      || !validateDisplayName(displayName)
      || !validateOptionalEmail(email)
    ) {
      return jsonError("Completa un Telegram ID, usuario y nombre válidos.");
    }

    let ownerId = actor.id;
    if (requestedRole === "seller" && actor.isOwner) {
      const managerId = asString(body.managerId).trim();
      if (managerId) {
        const manager = await dbBinding().prepare(
          `SELECT id FROM users
           WHERE id = ? AND role = 'admin' AND is_owner = 0 AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
        ).bind(managerId).first<{ id: string }>();
        if (!manager) return jsonError("Administrador activo no encontrado.", 404);
        ownerId = manager.id;
      }
    }

    const id = await createUser({
      sellerCode,
      username,
      displayName,
      email,
      password: generateTemporaryPassword(),
      role: requestedRole,
      ownerId,
      status: "active",
      credits: 0,
      mustChangePassword: true,
      telegramUserId: sellerCode.trim(),
    });
    const invitation = await createInvitation(id);
    await linkTelegramIdentity(id, sellerCode.trim());
    const activationUrl = new URL(invitation.activationPath, publicAppBaseUrl(request)).toString();
    const label = requestedRole === "admin" ? "Administrador" : "Vendedor";

    return jsonOk({
      user: {
        id,
        sellerCode: sellerCode.trim(),
        username: username.trim().toLowerCase(),
        displayName,
        role: requestedRole,
        ownerId,
        credits: 0,
      },
      invitation: { activationUrl, expiresAt: invitation.expiresAt },
      message: `${label} creado. Entrega su invitación privada; vence en 24 horas.`,
    }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
