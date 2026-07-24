import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  createUser,
  dbBinding,
  enforceAuthRateLimits,
  ensureClientReferralCodes,
  generateTemporaryPassword,
  normalizePeruvianMobile,
  publicAppBaseUrl,
  requireUnlockedSession,
  routeError,
  SELF_REGISTRATION_SELLER_CODE,
  validateDisplayName,
  validateOptionalEmail,
  validateSellerCode,
  validateUsername,
} from "@/app/lib/auth-server";
import { createInvitation } from "@/app/lib/invitation-server";
import { hasPermission, requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
    await requirePermission(actor, "clients:view");
    await ensureClientReferralCodes();

    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 80).toLocaleLowerCase("es-PE");
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
    const canViewAll = actor.isOwner || await hasPermission(actor, "clients:view_all");

    const conditions = ["u.role = 'client'", "u.deleted_at IS NULL"];
    const values: unknown[] = [];
    if (!canViewAll) {
      if (actor.role === "seller") {
        conditions.push("u.owner_id = ?");
        values.push(actor.id);
      } else {
        conditions.push(`(
          u.owner_id = ? OR u.owner_id IN (
            SELECT id FROM users
            WHERE role = 'seller' AND owner_id = ? AND deleted_at IS NULL
          )
        )`);
        values.push(actor.id, actor.id);
      }
    }
    if (search) {
      conditions.push(`(
        LOWER(u.display_name) LIKE ? OR LOWER(u.username) LIKE ? OR
        LOWER(u.email) LIKE ? OR COALESCE(d.phone_e164, '') LIKE ? OR
        LOWER(COALESCE(u.referral_code, '')) LIKE ? OR LOWER(u.seller_code) LIKE ?
      )`);
      const term = `%${search}%`;
      values.push(term, term, term, term, term, term);
    }

    const whereSql = conditions.join(" AND ");
    const totalRow = await dbBinding().prepare(
      `SELECT COUNT(*) AS total
       FROM users u
       LEFT JOIN payment_directory d ON d.user_id = u.id
       WHERE ${whereSql}`,
    ).bind(...values).first<{ total: number }>();
    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);

    const clients = await dbBinding().prepare(
      `SELECT u.id, u.seller_code, u.username, u.display_name, u.email, u.status, u.owner_id,
              u.created_at, u.activated_at, u.device_id, u.referral_code, u.access_expires_at, d.phone_e164
       FROM users u
       LEFT JOIN payment_directory d ON d.user_id = u.id
       WHERE ${whereSql}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(...values, pageSize, (safePage - 1) * pageSize).all();

    return jsonOk({
      clients: clients.results ?? [],
      credits: actor.credits,
      viewerRole: actor.isOwner ? "owner" : actor.role,
      pagination: { page: safePage, pageSize, total, totalPages },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
    await requirePermission(actor, "clients:create");
    await enforceAuthRateLimits([
      {
        bucket: "seller-create-user",
        subject: actor.id,
        limit: 40,
        windowSeconds: 60 * 60,
      },
    ]);
    const body = await readJson(request);
    const username = asString(body.username);
    const displayName = asString(body.displayName);
    const email = asString(body.email);
    const phone = normalizePeruvianMobile(asString(body.phone));
    const requestedSellerCode = asString(body.sellerCode);

    if (
      !validateUsername(username)
      || !validateDisplayName(displayName)
      || !validateOptionalEmail(email)
      || !phone
    ) {
      return jsonError("Completa un usuario, nombre y celular peruano válidos.");
    }

    let ownerId: string | null = actor.role === "seller" ? actor.id : null;
    let sellerCode = actor.role === "seller" ? actor.sellerCode : SELF_REGISTRATION_SELLER_CODE;
    if (actor.role === "admin" && requestedSellerCode.trim()) {
      await requirePermission(actor, "clients:assign");
      if (!validateSellerCode(requestedSellerCode)) return jsonError("Indica un código de vendedor válido.");
      const canAssignGlobally = actor.isOwner || await hasPermission(actor, "clients:view_all");
      const selectedSeller = await dbBinding().prepare(
        `SELECT id, seller_code
         FROM users
         WHERE role = 'seller' AND status = 'active' AND seller_code = ? AND deleted_at IS NULL
           AND (? = 1 OR owner_id = ?)
         LIMIT 1`,
      ).bind(requestedSellerCode.trim().toUpperCase(), canAssignGlobally ? 1 : 0, actor.id)
        .first<{ id: string; seller_code: string }>();
      if (!selectedSeller) return jsonError("No encontramos un vendedor activo con ese código.", 404);
      ownerId = selectedSeller.id;
      sellerCode = selectedSeller.seller_code;
    }

    const id = await createUser({
      sellerCode,
      username,
      displayName,
      email,
      password: generateTemporaryPassword(),
      phone,
      role: "client",
      ownerId,
      status: "pending",
      mustChangePassword: true,
    });
    const now = new Date().toISOString();
    await dbBinding().prepare(
      `INSERT INTO client_crm_profiles
         (user_id, crm_status, client_type, category, tags_json, notes, last_activity_at, updated_by, updated_at)
       VALUES (?, 'new', 'individual', 'general', '[]', '', ?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    ).bind(id, now, actor.id, now).run();
    const invitation = await createInvitation(id);
    const activationUrl = new URL(invitation.activationPath, publicAppBaseUrl(request)).toString();

    return jsonOk({
      client: { id, username: username.toLowerCase(), displayName, phone, status: "pending", ownerId },
      invitation: { activationUrl, expiresAt: invitation.expiresAt },
      message: ownerId
        ? "Cliente creado y asignado. No tiene acceso al panel administrativo."
        : "Cliente creado sin vendedor asignado. No tiene acceso al panel administrativo.",
    }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
