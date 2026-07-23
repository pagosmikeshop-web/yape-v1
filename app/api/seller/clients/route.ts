import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  createUser,
  dbBinding,
  ensureClientReferralCodes,
  generateTemporaryPassword,
  normalizePeruvianMobile,
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

export async function GET(request: Request) {
  try {
    const { user: seller } = await requireUnlockedSession(request, ["seller", "admin"]);
    await ensureClientReferralCodes();
    const ownerFilter = seller.role === "seller"
      ? "WHERE u.role = 'client' AND u.owner_id = ? AND u.deleted_at IS NULL"
      : seller.isOwner
        ? "WHERE u.role = 'client' AND u.deleted_at IS NULL"
        : `WHERE u.role = 'client' AND u.deleted_at IS NULL AND (
             u.owner_id = ? OR u.owner_id IN (
               SELECT id FROM users WHERE role = 'seller' AND owner_id = ? AND deleted_at IS NULL
             )
           )`;
    const statement = dbBinding().prepare(
      `SELECT u.id, u.seller_code, u.username, u.display_name, u.email, u.status, u.owner_id,
              u.created_at, u.activated_at, u.device_id, u.referral_code, u.access_expires_at, d.phone_e164
       FROM users u
       LEFT JOIN payment_directory d ON d.user_id = u.id
       ${ownerFilter} ORDER BY u.created_at DESC LIMIT 250`,
    );
    const clients = seller.role === "seller"
      ? await statement.bind(seller.id).all()
      : seller.isOwner
        ? await statement.all()
        : await statement.bind(seller.id, seller.id).all();
    return jsonOk({
      clients: clients.results ?? [],
      credits: seller.credits,
      viewerRole: seller.isOwner ? "owner" : seller.role,
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["seller", "admin"]);
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

    let seller = actor;
    if (actor.role === "admin") {
      if (!validateSellerCode(requestedSellerCode)) return jsonError("Indica un código de vendedor válido.");
      const selectedSeller = await dbBinding().prepare(
        `SELECT * FROM users
         WHERE role = 'seller' AND status = 'active' AND seller_code = ? AND deleted_at IS NULL
           AND (? = 1 OR owner_id = ?)
         LIMIT 1`,
      ).bind(requestedSellerCode.trim().toUpperCase(), actor.isOwner ? 1 : 0, actor.id)
        .first<typeof actor & { display_name: string; seller_code: string }>();
      if (!selectedSeller) return jsonError("No encontramos un vendedor activo con ese código.", 404);
      seller = {
        ...actor,
        id: selectedSeller.id,
        sellerCode: selectedSeller.seller_code,
        displayName: selectedSeller.display_name,
        role: "seller",
      };
    }

    const id = await createUser({
      sellerCode: seller.sellerCode,
      username,
      displayName,
      email,
      password: generateTemporaryPassword(),
      phone,
      role: "client",
      ownerId: seller.id,
      status: "pending",
      mustChangePassword: true,
    });
    const invitation = await createInvitation(id);
    const activationUrl = new URL(invitation.activationPath, publicAppBaseUrl(request)).toString();

    return jsonOk({
      client: { id, username: username.toLowerCase(), displayName, phone, status: "pending" },
      invitation: { activationUrl, expiresAt: invitation.expiresAt },
      message: "Cliente creado. Entrega su invitación privada y actívalo cuando hayas verificado sus datos.",
    }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
