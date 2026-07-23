import { jsonOk } from "@/app/lib/api-utils";
import {
  dbBinding,
  ensureReferralCodeForUser,
  getSessionUserIncludingExpired,
  REFERRAL_EXTENSION_DAYS,
  REFERRAL_MONTHLY_LIMIT,
  routeError,
} from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

function currentMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  try {
    const session = await getSessionUserIncludingExpired(request, ["client"]);
    if (!session) {
      return Response.json(
        { ok: false, error: "Inicia sesión para consultar tu código." },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }
    const code = await ensureReferralCodeForUser(session.user.id);
    const usage = await dbBinding().prepare(
      "SELECT COUNT(*) AS total FROM referral_redemptions WHERE referrer_user_id = ? AND month_key = ?",
    ).bind(session.user.id, currentMonthKey()).first<{ total: number }>();
    const usedThisMonth = Math.max(0, Number(usage?.total ?? 0));

    return jsonOk({
      code,
      command: code ? `/redeem ${code}` : null,
      rewardDays: REFERRAL_EXTENSION_DAYS,
      monthlyLimit: REFERRAL_MONTHLY_LIMIT,
      usedThisMonth,
      remainingThisMonth: Math.max(0, REFERRAL_MONTHLY_LIMIT - usedThisMonth),
      groupUrl: "/api/telegram/group",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
