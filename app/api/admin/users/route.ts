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
    const select = `SELECT id, seller_code, username, display_name, email, role,
              CASE WHEN role = 'admin' AND is_owner = 1 THEN 'owner' ELSE role END AS effective_role,
              is_owner, owner_id, status, credits, telegram_user_id, referral_code,
              access_expires_at, created_at, activated_at
       FROM users`;
    const result = actor.isOwner
      ? await dbBinding().prepare(
        `${select} WHERE deleted_at IS NULL ORDER BY is_owner DESC, role, created_at DESC LIMIT 500`,
      ).all<ListedUser>()
      : await dbBinding().prepare(
        `${select}
         WHERE deleted_at IS NULL AND (
           id = ?
           OR (role = 'seller' AND owner_id = ?)
           OR (role = 'client' AND owner_id = ?)
           OR (role = 'client' AND owner_id IN (
             SELECT id FROM users
             WHERE role = 'seller' AND owner_id = ? AND deleted_at IS NULL
           ))
         )
         ORDER BY role, created_at DESC LIMIT 500`,
      ).bind(actor.id, actor.id, actor.id, actor.id).all<ListedUser>();
    return jsonOk({ users: result.results ?? [], viewerRole: actor.isOwner ? "owner" : "admin" });
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
    if (requestedRole === "admin" && !actor.isOwner) return jsonError("Solo el Owner puede crear administradores.", 403);
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
