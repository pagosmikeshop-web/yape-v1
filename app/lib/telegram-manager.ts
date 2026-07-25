import {
  authEnv,
  dbBinding,
  ensureAuthSchema,
  REFERRAL_EXTENSION_DAYS,
  REFERRAL_MONTHLY_LIMIT,
} from "@/app/lib/auth-server";

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
};

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
  const token = authEnv().TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const configuredGroup = authEnv().TELEGRAM_REQUIRED_GROUP_ID?.trim() ?? "";
  const inviteGroup = publicGroupReferenceFromInviteUrl(
    authEnv().TELEGRAM_GROUP_INVITE_URL,
  );
  const groupId = requiredGroupId();
  if (!token || (!configuredGroup && !inviteGroup)) {
    return { member: false, reason: "not-configured" };
  }
  if (!groupId) return { member: false, reason: "invalid-group" };

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ chat_id: groupId, user_id: telegramUserId }),
      signal: AbortSignal.timeout(8_000),
    });
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 16 * 1024) {
      return { member: false, reason: "telegram-unavailable" };
    }
    const text = await limitedResponseText(response, 16 * 1024);
    if (!text) return { member: false, reason: "telegram-unavailable" };
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
    return { member: false, reason: "telegram-unavailable" };
  }
}

export async function isCurrentTelegramGroupMember(telegramUserId: string) {
  return (await checkCurrentTelegramGroupMember(telegramUserId)).member;
}

export function telegramMembershipError(check: TelegramMembershipCheck) {
  return membershipFailureMessage(check);
}

async function redeemReferralCode(telegramId: string, args: string) {
  const code = args.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
  if (!/^[A-Z0-9]{6,16}$/u.test(code)) throw new Error("Formato: /redeem CODIGO");
  const referrer = await dbBinding().prepare(
    "SELECT id, display_name, telegram_user_id, access_expires_at FROM users WHERE referral_code = ? AND status = 'active' LIMIT 1",
  ).bind(code).first<{ id: string; display_name: string; telegram_user_id: string | null; access_expires_at: string | null }>();
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

  const redeemer = await dbBinding().prepare("SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1")
    .bind(telegramId).first<{ id: string }>();
  if (redeemer?.id === referrer.id) {
    throw new Error("No puedes canjear tu propio codigo.");
  }

  const key = monthKey();
  const current = await dbBinding().prepare(
    "SELECT COUNT(*) AS total FROM referral_redemptions WHERE referrer_user_id = ? AND month_key = ?",
  ).bind(referrer.id, key).first<{ total: number }>();
  if (Number(current?.total ?? 0) >= REFERRAL_MONTHLY_LIMIT) throw new Error("Ese codigo llego al limite mensual.");

  const now = new Date().toISOString();
  const nextAccess = addDaysFromCurrent(referrer.access_expires_at, REFERRAL_EXTENSION_DAYS);
  const redemptionId = crypto.randomUUID();
  const results = await dbBinding().batch([
    dbBinding().prepare(
      `INSERT OR IGNORE INTO referral_redemptions (
        id, referrer_user_id, redeemer_telegram_user_id, redeemed_by_user_id, month_key, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?
      WHERE (
        SELECT COUNT(*) FROM referral_redemptions
        WHERE referrer_user_id = ? AND month_key = ?
      ) < ?`,
    ).bind(
      redemptionId,
      referrer.id,
      telegramId,
      redeemer?.id ?? null,
      key,
      now,
      referrer.id,
      key,
      REFERRAL_MONTHLY_LIMIT,
    ),
    dbBinding().prepare(
      `UPDATE users SET access_expires_at = ?, updated_at = ?
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM referral_redemptions WHERE id = ?
       )`,
    ).bind(nextAccess, now, referrer.id, redemptionId),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1 || Number(results[1]?.meta.changes ?? 0) !== 1) {
    throw new Error("Ese usuario ya canjeo el codigo o se alcanzo el limite mensual.");
  }
  return "✅ Activación completada.";
}

async function audit(telegramId: string, command: string, outcome: string) {
  await dbBinding().prepare(
    "INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), telegramId, command.slice(0, 80), outcome.slice(0, 200), new Date().toISOString()).run();
}

export async function sendTelegramMessage(chatId: number, text: string) {
  const token = authEnv().TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN no esta configurado.");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), protect_content: true }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Telegram no pudo entregar la respuesta del manager.");
}

export async function processTelegramUpdate(update: TelegramUpdate) {
  const message = update.message;
  const groupId = requiredGroupId();
  if (
    !message?.from
    || !message.text
    || message.chat.type === "private"
    || !groupId
    || !isRequiredGroupChat(message.chat, groupId)
  ) return;

  const { command, args } = commandParts(message.text);
  if (command !== "/redeem") return;

  await ensureAuthSchema();
  const updateId = String(update.update_id);
  const inserted = await dbBinding().prepare(
    "INSERT OR IGNORE INTO telegram_updates (update_id, received_at) VALUES (?, ?)",
  ).bind(updateId, new Date().toISOString()).run();
  if (Number(inserted.meta.changes ?? 0) !== 1) return;

  const telegramId = String(message.from.id);
  try {
    const reply = await redeemReferralCode(telegramId, args);
    await audit(telegramId, command, "redeem ok");
    await sendTelegramMessage(message.chat.id, reply);
  } catch (error) {
    await audit(telegramId, command, `redeem error: ${error instanceof Error ? error.name : "desconocido"}`);
    await sendTelegramMessage(
      message.chat.id,
      error instanceof Error ? error.message : "No se pudo completar la activacion.",
    );
  }
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
