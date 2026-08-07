import { jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requireSession,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import { writeSecurityEvent } from "@/app/lib/security-log";
import { MAX_ACCOUNT_BALANCE_CENTS } from "@/app/lib/money";

export const dynamic = "force-dynamic";

async function readBalance(userId: string) {
  return dbBinding().prepare(
    "SELECT balance_cents, is_configured, updated_at FROM account_balances WHERE user_id = ? LIMIT 1",
  ).bind(userId).first<{ balance_cents: number; is_configured: number; updated_at: string }>();
}

export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request);
    const row = await readBalance(user.id);
    const configured = Boolean(row?.is_configured);
    const balanceCents = configured ? Number(row?.balance_cents) : null;
    return jsonOk({
      balanceCents,
      balance: balanceCents === null ? null : balanceCents / 100,
      configured,
      updatedAt: configured ? row?.updated_at ?? null : null,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request);

    await enforceAuthRateLimits([
      {
        bucket: "account-balance-put",
        subject: user.id,
        limit: 30,
        windowSeconds: 15 * 60,
      },
    ]);

    const body = await readJson(request);
    const balanceCents = typeof body.balanceCents === "number" ? body.balanceCents : Number.NaN;
    if (
      !Number.isSafeInteger(balanceCents) ||
      balanceCents < 0 ||
      balanceCents > MAX_ACCOUNT_BALANCE_CENTS
    ) {
      return jsonError("El saldo debe estar entre S/ 0.00 y S/ 1,000,000.00.");
    }

    const updatedAt = new Date().toISOString();
    await dbBinding().prepare(
      `INSERT INTO account_balances (user_id, balance_cents, is_configured, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET balance_cents = excluded.balance_cents, is_configured = 1, updated_at = excluded.updated_at`,
    ).bind(user.id, balanceCents, updatedAt).run();

    writeSecurityEvent(request, "account.balance_edit", "success", {
      actorId: user.id,
      balanceCents,
    });

    return jsonOk({ balanceCents, balance: balanceCents / 100, updatedAt }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
