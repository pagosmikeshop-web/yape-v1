import {
  authEnv,
  dbBinding,
  ensureAuthSchema,
  isUniqueConstraintError,
  REFERRAL_EXTENSION_DAYS,
  REFERRAL_REDEMPTION_LIMIT,
} from "@/app/lib/auth-server";
import { isSupabaseDatabase } from "@/app/lib/database-server";
import { safeClientMessage } from "@/app/lib/client-error";

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type: string; username?: string };
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  [key: string]: unknown;
};

const TELEGRAM_UPDATE_TYPES = [
  "message",
  "callback_query",
  "edited_message",
  "channel_post",
  "my_chat_member",
  "chat_member",
] as const;

export type TelegramWebhookUpdateType = (typeof TELEGRAM_UPDATE_TYPES)[number] | "other";
export type TelegramWebhookChatType = "private" | "group" | "supergroup" | "channel" | "unknown";

export type TelegramWebhookInspection = {
  updateId: string;
  updateType: TelegramWebhookUpdateType;
  chatType: TelegramWebhookChatType;
};

export type TelegramProcessingResult =
  | "ignored-no-message"
  | "ignored-no-sender"
  | "ignored-non-text"
  | "ignored-private"
  | "ignored-unconfigured-group"
  | "ignored-other-chat"
  | "ignored-command"
  | "duplicate"
  | "processed-me"
  | "processed-redeem";

function configuredTelegramValue(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim() ?? "").find(Boolean) ?? "";
}

/**
 * The legacy token keeps current production working until the membership and
 * command bot variables are configured independently.
 */
export function telegramMembershipBotToken() {
  const env = authEnv();
  return configuredTelegramValue(env.TELEGRAM_MEMBERSHIP_BOT_TOKEN, env.TELEGRAM_BOT_TOKEN);
}

export function telegramCommandBotToken() {
  const env = authEnv();
  return configuredTelegramValue(env.TELEGRAM_COMMAND_BOT_TOKEN, env.TELEGRAM_BOT_TOKEN);
}

export function telegramCommandWebhookSecret() {
  const env = authEnv();
  return configuredTelegramValue(env.TELEGRAM_COMMAND_WEBHOOK_SECRET, env.TELEGRAM_WEBHOOK_SECRET);
}

export function telegramWebhookDiagnosticsEnabled() {
  return authEnv().TELEGRAM_WEBHOOK_DIAGNOSTICS?.trim().toLowerCase() === "true";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Returns only finite categories; it never exposes Telegram message contents or identities. */
export function inspectTelegramWebhookUpdate(update: TelegramUpdate): TelegramWebhookInspection {
  const updateType = TELEGRAM_UPDATE_TYPES.find((type) => update[type] !== undefined) ?? "other";
  const payload = updateType === "other" ? null : asRecord(update[updateType]);
  const message = asRecord(payload?.message) ?? payload;
  const chat = asRecord(message?.chat);
  const chatType = chat?.type;

  return {
    updateId: String(update.update_id),
    updateType,
    chatType: chatType === "private" || chatType === "group" || chatType === "supergroup" || chatType === "channel"
      ? chatType
      : "unknown",
  };
}

function commandParts(text: string) {
  const trimmed = text.trim();
  const space = trimmed.search(/\s/u);
  const head = (space === -1 ? trimmed : trimmed.slice(0, space)).split("@")[0].toLocaleLowerCase("es-PE");
  return { command: head, args: space === -1 ? "" : trimmed.slice(space + 1).trim() };
}

export type TelegramMembershipCheck =
  | { member: true; status: "creator" | "administrator" | "member" | "restricted" }
  | {
    member: false;
    reason:
      | "invalid-user-id"
      | "not-configured"
      | "invalid-group"
      | "bot-not-authorized"
      | "user-not-found"
      | "not-member"
      | "telegram-unavailable";
  };

function normalizeTelegramGroupReference(value: string | undefined) {
  const raw = (value ?? "").trim();
  if (/^-?\d+$/u.test(raw)) return raw;
  if (/^@[A-Za-z0-9_]{5,}$/u.test(raw)) return raw;
  if (/^[A-Za-z0-9_]{5,}$/u.test(raw)) return `@${raw}`;
  return "";
}

function publicGroupReferenceFromInviteUrl(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["t.me", "telegram.me"].includes(url.hostname)) {
      return "";
    }
    const username = url.pathname.replace(/^\/+|\/+$/gu, "");
    return /^[A-Za-z0-9_]{5,}$/u.test(username) ? `@${username}` : "";
  } catch {
    return "";
  }
}

function requiredGroupId() {
  const env = authEnv();
  const configured = normalizeTelegramGroupReference(env.TELEGRAM_REQUIRED_GROUP_ID);
  if (/^-?\d+$/u.test(configured)) return configured;
  return publicGroupReferenceFromInviteUrl(env.TELEGRAM_GROUP_INVITE_URL) || configured;
}

function isRequiredGroupChat(chat: TelegramMessage["chat"], groupReference: string) {
  if (/^-?\d+$/u.test(groupReference)) return String(chat.id) === groupReference;
  const expectedUsername = groupReference.replace(/^@/u, "").toLocaleLowerCase("en-US");
  return Boolean(chat.username)
    && chat.username!.toLocaleLowerCase("en-US") === expectedUsername;
}

function membershipFailureMessage(check: TelegramMembershipCheck) {
  if (check.member) return "";
  switch (check.reason) {
    case "invalid-user-id":
      return "Ingresa un Telegram ID válido.";
    case "not-configured":
      return "Falta configurar el grupo de Telegram.";
    case "invalid-group":
      return "El grupo de Telegram configurado no es válido.";
    case "bot-not-authorized":
      return "El bot no puede consultar el grupo. Verifica que pertenezca al grupo y sea administrador.";
    case "telegram-unavailable":
      return "Telegram no respondió. Intenta validar nuevamente.";
    case "user-not-found":
    case "not-member":
      return "No encontramos ese Telegram ID dentro del grupo.";
  }
}

function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addDaysFromCurrent(value: string | null, days: number) {
  const now = Date.now();
  const base = value && Date.parse(value) > now ? Date.parse(value) : now;
  return new Date(base + days * 86_400_000).toISOString();
}

async function limitedResponseText(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Telegram response-size limit exceeded");
        return "";
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function checkCurrentTelegramGroupMember(
  telegramUserId: string,
): Promise<TelegramMembershipCheck> {
  if (!/^\d{4,24}$/u.test(telegramUserId)) {
    return { member: false, reason: "invalid-user-id" };
  }
  const token = telegramMembershipBotToken();
  const configuredGroup = authEnv().TELEGRAM_REQUIRED_GROUP_ID?.trim() ?? "";
  const inviteGroup = publicGroupReferenceFromInviteUrl(
    authEnv().TELEGRAM_GROUP_INVITE_URL,
  );
  const groupId = requiredGroupId();
  if (!token || (!configuredGroup && !inviteGroup)) {
    return { member: false, reason: "not-configured" };
  }
  if (!groupId) return { member: false, reason: "invalid-group" };

  // La consulta es de solo lectura. Una única repetición está permitida
  // únicamente para fallos transitorios de red/Telegram, evitando convertir
  // una caída breve del proveedor en un falso rechazo de identidad.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ chat_id: groupId, user_id: telegramUserId }),
        signal: AbortSignal.timeout(8_000),
      });
      const transientHttpFailure = response.status === 408
        || response.status === 425
        || response.status === 429
        || response.status >= 500;
      if (transientHttpFailure && attempt === 0) continue;
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > 16 * 1024) {
        return { member: false, reason: "telegram-unavailable" };
      }
      const text = await limitedResponseText(response, 16 * 1024);
      if (!text) {
        if (attempt === 0) continue;
        return { member: false, reason: "telegram-unavailable" };
      }
      const data = JSON.parse(text) as {
        ok?: boolean;
        description?: string;
        result?: { status?: string; is_member?: boolean };
      };
      if (!response.ok || !data.ok) {
        const description = (data.description ?? "").toLocaleLowerCase("en-US");
        if (description.includes("chat not found")) {
          return { member: false, reason: "invalid-group" };
        }
        if (
          description.includes("not enough rights")
          || description.includes("member list is inaccessible")
          || description.includes("bot is not a member")
        ) {
          return { member: false, reason: "bot-not-authorized" };
        }
        if (description.includes("user not found")) {
          return { member: false, reason: "user-not-found" };
        }
        return { member: false, reason: "telegram-unavailable" };
      }
      const status = data.result?.status ?? "";
      if (status === "creator" || status === "administrator" || status === "member") {
        return { member: true, status };
      }
      if (status === "restricted" && data.result?.is_member === true) {
        return { member: true, status };
      }
      return { member: false, reason: "not-member" };
    } catch {
      if (attempt === 0) continue;
      return { member: false, reason: "telegram-unavailable" };
    }
  }
  return { member: false, reason: "telegram-unavailable" };
}

export async function isCurrentTelegramGroupMember(telegramUserId: string) {
  return (await checkCurrentTelegramGroupMember(telegramUserId)).member;
}

export function telegramMembershipError(check: TelegramMembershipCheck) {
  return membershipFailureMessage(check);
}

export function telegramMembershipIsUnavailable(check: TelegramMembershipCheck) {
  return !check.member && (
    check.reason === "telegram-unavailable"
    || check.reason === "not-configured"
    || check.reason === "invalid-group"
    || check.reason === "bot-not-authorized"
  );
}

async function redeemReferralCode(telegramId: string, args: string) {
  const code = args.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
  if (!/^[A-Z0-9]{6,16}$/u.test(code)) throw new Error("Formato: /redeem CODIGO");
  const database = dbBinding();
  const referrer = await database.prepare(
    "SELECT id, display_name, telegram_user_id, access_expires_at, referral_redemption_count FROM users WHERE referral_code = ? AND status = 'active' LIMIT 1",
  ).bind(code).first<{
    id: string;
    display_name: string;
    telegram_user_id: string | null;
    access_expires_at: string | null;
    referral_redemption_count: number;
  }>();
  if (!referrer) throw new Error("Codigo no encontrado.");
  // TRIAL-002: bloquear self-redeem sin telegram ligado o por dueño del referral.
  if (!referrer.telegram_user_id) {
    throw new Error("Ese codigo no tiene Telegram vinculado; no se puede canjear.");
  }
  if (referrer.telegram_user_id === telegramId) throw new Error("No puedes canjear tu propio codigo.");
  if (!referrer.access_expires_at) throw new Error("Esa cuenta ya tiene acceso permanente.");
  if (!(await isCurrentTelegramGroupMember(telegramId))) {
    throw new Error("Primero debes estar en el grupo.");
  }

  const redeemer = await database.prepare("SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1")
    .bind(telegramId).first<{ id: string }>();
  if (redeemer?.id === referrer.id) {
    throw new Error("No puedes canjear tu propio codigo.");
  }

  if (Number(referrer.referral_redemption_count ?? 0) >= REFERRAL_REDEMPTION_LIMIT) {
    throw new Error("Esta cuenta ya agoto sus 3 canjes disponibles.");
  }

  const existingClaim = await database.prepare(
    "SELECT 1 AS found FROM referral_redeemer_claims WHERE telegram_user_id = ? LIMIT 1",
  ).bind(telegramId).first<{ found: number }>();
  if (existingClaim) {
    throw new Error("Tu ID de Telegram ya utilizo un canje. Cada ID solo puede canjear una vez.");
  }

  const key = monthKey();

  const now = new Date().toISOString();
  const nextAccess = addDaysFromCurrent(referrer.access_expires_at, REFERRAL_EXTENSION_DAYS);
  const redemptionId = crypto.randomUUID();
  const expectedCount = Number(referrer.referral_redemption_count ?? 0) + 1;
  const statements = isSupabaseDatabase()
    ? [
        database.prepare(
          "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
        ).bind(`referral:${referrer.id}`),
        database.prepare(
          "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
        ).bind(`redeemer:${telegramId}`),
        database.prepare(
          `WITH reserved AS (
             UPDATE users
             SET referral_redemption_count = referral_redemption_count + 1,
                 access_expires_at = ?,
                 updated_at = ?
             WHERE id = ?
               AND access_expires_at IS NOT NULL
               AND referral_redemption_count < ?
               AND NOT EXISTS (
                 SELECT 1
                 FROM referral_redeemer_claims
                 WHERE telegram_user_id = ?
               )
             RETURNING id
           ),
           claimed AS (
             INSERT INTO referral_redeemer_claims (
               telegram_user_id, referrer_user_id, redemption_id, created_at
             )
             SELECT ?, ?, ?, ?
             FROM reserved
             RETURNING telegram_user_id
           ),
           recorded AS (
             INSERT INTO referral_redemptions (
               id, referrer_user_id, redeemer_telegram_user_id, redeemed_by_user_id, month_key, created_at
             )
             SELECT ?, ?, ?, ?, ?, ?
             FROM claimed
             RETURNING id
           )
           SELECT id FROM recorded`,
        ).bind(
          nextAccess,
          now,
          referrer.id,
          REFERRAL_REDEMPTION_LIMIT,
          telegramId,
          telegramId,
          referrer.id,
          redemptionId,
          now,
          redemptionId,
          referrer.id,
          telegramId,
          redeemer?.id ?? null,
          key,
          now,
        ),
      ]
    : [
        database.prepare(
          `UPDATE users
           SET referral_redemption_count = referral_redemption_count + 1, updated_at = ?
           WHERE id = ? AND access_expires_at IS NOT NULL AND referral_redemption_count < ?
             AND NOT EXISTS (
               SELECT 1 FROM referral_redeemer_claims
               WHERE telegram_user_id = ?
             )`,
        ).bind(now, referrer.id, REFERRAL_REDEMPTION_LIMIT, telegramId),
        database.prepare(
          `INSERT INTO referral_redeemer_claims (
            telegram_user_id, referrer_user_id, redemption_id, created_at
          )
          SELECT ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM users
            WHERE id = ? AND referral_redemption_count = ? AND access_expires_at IS NOT NULL
          )`,
        ).bind(
          telegramId,
          referrer.id,
          redemptionId,
          now,
          referrer.id,
          expectedCount,
        ),
        database.prepare(
          `INSERT INTO referral_redemptions (
            id, referrer_user_id, redeemer_telegram_user_id, redeemed_by_user_id, month_key, created_at
          )
          SELECT ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM referral_redeemer_claims
            WHERE telegram_user_id = ? AND redemption_id = ?
          )`,
        ).bind(
          redemptionId,
          referrer.id,
          telegramId,
          redeemer?.id ?? null,
          key,
          now,
          telegramId,
          redemptionId,
        ),
        database.prepare(
          `UPDATE users SET access_expires_at = ?, updated_at = ?
           WHERE id = ? AND EXISTS (SELECT 1 FROM referral_redemptions WHERE id = ?)`,
        ).bind(nextAccess, now, referrer.id, redemptionId),
      ];

  try {
    const results = await database.batch(statements);
    const changes = results.map((result) => Number(result.meta.changes ?? 0));
    const successful = isSupabaseDatabase()
      ? changes[2] === 1
      : changes[0] === 1 && changes[1] === 1 && changes[2] === 1 && changes[3] === 1;
    if (!successful) {
      const claimed = await database.prepare(
        "SELECT 1 AS found FROM referral_redeemer_claims WHERE telegram_user_id = ? LIMIT 1",
      ).bind(telegramId).first<{ found: number }>();
      if (claimed) {
        throw new Error("Tu ID de Telegram ya utilizo un canje. Cada ID solo puede canjear una vez.");
      }

      const current = await database.prepare(
        "SELECT referral_redemption_count FROM users WHERE id = ? AND status = 'active' LIMIT 1",
      ).bind(referrer.id).first<{ referral_redemption_count: number }>();
      if (Number(current?.referral_redemption_count ?? 0) >= REFERRAL_REDEMPTION_LIMIT) {
        throw new Error("Esta cuenta ya agoto sus 3 canjes disponibles.");
      }
      throw new Error("No se pudo registrar el canje. Intenta nuevamente.");
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const claimed = await database.prepare(
        "SELECT 1 AS found FROM referral_redeemer_claims WHERE telegram_user_id = ? LIMIT 1",
      ).bind(telegramId).first<{ found: number }>();
      if (claimed) {
        throw new Error("Tu ID de Telegram ya utilizo un canje. Cada ID solo puede canjear una vez.");
      }
      throw new Error("No se pudo registrar el canje. Intenta nuevamente.");
    }
    throw error;
  }
  return "✅ Activación completada.";
}

async function audit(telegramId: string, command: string, outcome: string) {
  await dbBinding().prepare(
    "INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), telegramId, command.slice(0, 80), outcome.slice(0, 200), new Date().toISOString()).run();
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyToMessageId?: number,
) {
  const token = telegramCommandBotToken();
  if (!token) throw new Error("El bot de comandos de Telegram no esta configurado.");
  const payload = {
    chat_id: chatId,
    text: text.slice(0, 4000),
    protect_content: true,
    ...(replyToMessageId === undefined
      ? {}
      : {
          reply_parameters: {
            message_id: replyToMessageId,
            allow_sending_without_reply: false,
          },
        }),
  };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Telegram no pudo entregar la respuesta del manager.");
}

export async function processTelegramUpdate(update: TelegramUpdate): Promise<TelegramProcessingResult> {
  const message = update.message;
  const groupId = requiredGroupId();
  if (!message) return "ignored-no-message";
  if (!message.from) return "ignored-no-sender";
  if (!message.text) return "ignored-non-text";
  if (message.chat.type === "private") return "ignored-private";
  if (!groupId) return "ignored-unconfigured-group";
  if (!isRequiredGroupChat(message.chat, groupId)) return "ignored-other-chat";

  const { command, args } = commandParts(message.text);
  if (command !== "/redeem" && command !== "/me") return "ignored-command";

  await ensureAuthSchema();
  const updateId = String(update.update_id);
  const inserted = await dbBinding().prepare(
    "INSERT OR IGNORE INTO telegram_updates (update_id, received_at) VALUES (?, ?)",
  ).bind(updateId, new Date().toISOString()).run();
  if (Number(inserted.meta.changes ?? 0) !== 1) return "duplicate";

  const telegramId = String(message.from.id);
  if (command === "/me") {
    await audit(telegramId, command, "me reply ok");
    await sendTelegramMessage(message.chat.id, telegramId, message.message_id);
    return "processed-me";
  }

  try {
    const reply = await redeemReferralCode(telegramId, args);
    await audit(telegramId, command, "redeem ok");
    await sendTelegramMessage(message.chat.id, reply);
  } catch (error) {
    await audit(telegramId, command, `redeem error: ${error instanceof Error ? error.name : "desconocido"}`);
    await sendTelegramMessage(
      message.chat.id,
      safeClientMessage(error, "No se pudo completar la activacion."),
    );
  }
  return "processed-redeem";
}

export async function sameSecret(left: string, right: string) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < aa.length; index += 1) difference |= aa[index] ^ bb[index];
  return difference === 0;
}
