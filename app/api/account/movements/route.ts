import { jsonOk } from "@/app/lib/api-utils";
import { dbBinding, requireSession, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { maskRecipientName } from "@/app/lib/recipient-lookup/name-masker";

export const dynamic = "force-dynamic";

type MovementRow = {
  id: string;
  recipient_name: string;
  recipient_reference: string;
  destination: string;
  amount_cents: number;
  message: string;
  security_code: string;
  operation_number: string;
  created_at: string;
};

export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request);
    const database = dbBinding();
    const [movementsResult, historyState] = await Promise.all([
      database.prepare(
        `SELECT id, recipient_name, recipient_reference, destination, amount_cents,
          message, security_code, operation_number, created_at
         FROM account_movements
         WHERE user_id = ?
           AND (
             (SELECT cleared_at FROM account_history_state WHERE user_id = ?) IS NULL
             OR created_at > (SELECT cleared_at FROM account_history_state WHERE user_id = ?)
           )
         ORDER BY created_at DESC
         LIMIT 250`,
      ).bind(user.id, user.id, user.id).all<MovementRow>(),
      database.prepare(
        "SELECT cleared_at FROM account_history_state WHERE user_id = ? LIMIT 1",
      ).bind(user.id).first<{ cleared_at: string }>(),
    ]);

    return jsonOk({
      historyCleared: Boolean(historyState?.cleared_at),
      clearedAt: historyState?.cleared_at ?? null,
      movements: (movementsResult.results ?? []).map((row) => ({
        id: row.id,
        recipientName: maskRecipientName(row.recipient_name),
        recipientReference: row.recipient_reference,
        destination: row.destination,
        amountCents: Number(row.amount_cents),
        message: row.message,
        securityCode: row.security_code,
        operationNumber: row.operation_number,
        createdAt: row.created_at,
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request);
    const database = dbBinding();
    const clearedAt = new Date().toISOString();
    await database.prepare(
      `INSERT INTO account_history_state (user_id, cleared_at) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET cleared_at = excluded.cleared_at`,
    ).bind(user.id, clearedAt).run();
    return jsonOk({ clearedAt }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
