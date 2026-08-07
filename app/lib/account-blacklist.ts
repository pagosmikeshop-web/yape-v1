import { dbBinding } from "@/app/lib/auth-server";

export const ACCOUNT_BANNED_CODE = "ACCOUNT_BANNED" as const;
export const ACCOUNT_BANNED_MESSAGE = "Cuenta Baneada." as const;

/**
 * Checks the permanent Telegram blacklist on the server. The value is
 * normalized before querying so formatting differences cannot bypass a ban.
 */
export async function isTelegramAccountBanned(
  telegramUserId: string,
  database = dbBinding(),
): Promise<boolean> {
  const normalized = telegramUserId.trim();
  if (!/^\d{4,24}$/u.test(normalized)) return false;
  const row = await database.prepare(
    "SELECT 1 FROM account_blacklist WHERE telegram_user_id = ? LIMIT 1",
  ).bind(normalized).first();
  return Boolean(row);
}
