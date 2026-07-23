import { jsonOk } from "@/app/lib/api-utils";
import { dbBinding, requireUnlockedSession, routeError } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user: seller } = await requireUnlockedSession(request, ["seller", "admin"]);
    const where = seller.role === "seller"
      ? "WHERE r.seller_id = ?"
      : seller.isOwner
        ? ""
        : `WHERE r.seller_id IN (
             SELECT id FROM users WHERE role = 'seller' AND owner_id = ? AND deleted_at IS NULL
           )`;
    const statement = dbBinding().prepare(
      `SELECT r.id, r.status, r.price_credits, r.created_at, r.approved_at,
              u.display_name, u.username, u.seller_code
       FROM password_reset_requests r JOIN users u ON u.id = r.user_id
       ${where}
       ORDER BY r.created_at DESC LIMIT 200`,
    );
    const resets = seller.role === "seller" || !seller.isOwner
      ? await statement.bind(seller.id).all()
      : await statement.all();
    return jsonOk({ resets: resets.results ?? [], credits: seller.credits });
  } catch (error) {
    return routeError(error);
  }
}
