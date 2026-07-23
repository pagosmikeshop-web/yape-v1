import {
  AppRole,
  authEnv,
  dbBinding,
  ensureAuthSchema,
  REFERRAL_EXTENSION_DAYS,
  REFERRAL_MONTHLY_LIMIT,
  validateSellerCode,
} from "@/app/lib/auth-server";

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
  new_chat_members?: Array<{ id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }>;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

type ManagerUser = {
  id: string;
  seller_code: string;
  username: string;
  display_name: string;
  role: AppRole;
  status: string;
  credits: number;
};

type Actor = { telegramId: string; admin: boolean; user: ManagerUser };

const ADMIN_HELP = [
  "Consultas de administrador (solo lectura):",
  "/clientes CODIGO",
  "/pendientes CODIGO",
  "/saldo CODIGO",
  "/id",
  "Las altas, activaciones, créditos y recuperaciones se gestionan en el panel web de Yape.",
].join("\n");

const SELLER_HELP = [
  "Consultas de vendedor (solo lectura):",
  "/clientes",
  "/pendientes",
  "/saldo",
  "/id",
  "Las altas, activaciones y recuperaciones se gestionan en el panel web de Yape.",
].join("\n");

const DISABLED_WRITE_COMMANDS = new Set(["/vendedor", "/creditos", "/cliente", "/activar", "/aprobar"]);

function fields(value: string) {
  return value.split("|").map((part) => part.trim());
}

function commandParts(text: string) {
  const trimmed = text.trim();
  const space = trimmed.search(/\s/u);
  const head = (space === -1 ? trimmed : trimmed.slice(0, space)).split("@")[0].toLocaleLowerCase("es-PE");
  return { command: head, args: space === -1 ? "" : trimmed.slice(space + 1).trim() };
}

function adminIds() {
  return new Set((authEnv().TELEGRAM_ADMIN_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

function requiredGroupId() {
  return (authEnv().TELEGRAM_REQUIRED_GROUP_ID ?? "").trim();
}

function displayTelegramName(user: { first_name?: string; last_name?: string; username?: string }) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return fullName || (user.username ? `@${user.username}` : "");
}

async function rememberGroupMember(chatId: number, member: { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }) {
  if (member.is_bot) return;
  const configuredGroup = requiredGroupId();
  if (configuredGroup && configuredGroup !== String(chatId)) return;
  const now = new Date().toISOString();
  await dbBinding().prepare(
    `INSERT INTO telegram_group_members (
      telegram_user_id, chat_id, username, display_name, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      chat_id = excluded.chat_id,
      username = excluded.username,
      display_name = excluded.display_name,
      last_seen_at = excluded.last_seen_at`,
  ).bind(String(member.id), String(chatId), member.username ?? "", displayTelegramName(member), now, now).run();
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

export async function isCurrentTelegramGroupMember(telegramUserId: string) {
  if (!/^\d{4,24}$/u.test(telegramUserId)) return false;
  const token = authEnv().TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const groupId = requiredGroupId();
  if (!token || !groupId) return false;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ chat_id: groupId, user_id: telegramUserId }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return false;
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 16 * 1024) return false;
    const text = await limitedResponseText(response, 16 * 1024);
    if (!text) return false;
    const data = JSON.parse(text) as { ok?: boolean; result?: { status?: string; is_member?: boolean } };
    if (!data.ok) return false;
    const status = data.result?.status ?? "";
    return status === "creator"
      || status === "administrator"
      || status === "member"
      || (status === "restricted" && data.result?.is_member === true);
  } catch {
    return false;
  }
}

async function redeemReferralCode(telegramId: string, args: string) {
  const code = args.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
  if (!/^[A-Z0-9]{6,16}$/u.test(code)) throw new Error("Formato: /redeem CODIGO");
  const referrer = await dbBinding().prepare(
    "SELECT id, display_name, telegram_user_id, access_expires_at FROM users WHERE referral_code = ? AND status = 'active' LIMIT 1",
  ).bind(code).first<{ id: string; display_name: string; telegram_user_id: string | null; access_expires_at: string | null }>();
  if (!referrer) throw new Error("Codigo no encontrado.");
  if (referrer.telegram_user_id === telegramId) throw new Error("No puedes canjear tu propio codigo.");
  if (!referrer.access_expires_at) throw new Error("Esa cuenta ya tiene acceso permanente.");
  if (!(await isCurrentTelegramGroupMember(telegramId))) {
    throw new Error("Primero debes estar en el grupo.");
  }

  const key = monthKey();
  const current = await dbBinding().prepare(
    "SELECT COUNT(*) AS total FROM referral_redemptions WHERE referrer_user_id = ? AND month_key = ?",
  ).bind(referrer.id, key).first<{ total: number }>();
  if (Number(current?.total ?? 0) >= REFERRAL_MONTHLY_LIMIT) throw new Error("Ese codigo llego al limite mensual.");

  const redeemer = await dbBinding().prepare("SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1")
    .bind(telegramId).first<{ id: string }>();
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
  return `Codigo canjeado.\n${referrer.display_name} recibio ${REFERRAL_EXTENSION_DAYS} dias mas.\nLimite mensual: ${Number(current?.total ?? 0) + 1}/${REFERRAL_MONTHLY_LIMIT}`;
}

async function adminDatabaseUser() {
  return dbBinding().prepare(
    "SELECT id, seller_code, username, display_name, role, status, credits FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1",
  ).first<ManagerUser>();
}

async function actorFor(telegramId: string): Promise<Actor | null> {
  if (adminIds().has(telegramId)) {
    const user = await adminDatabaseUser();
    if (!user) throw new Error("Primero crea la cuenta Owner desde el panel administrativo externo.");
    return { telegramId, admin: true, user };
  }
  const user = await dbBinding().prepare(
    `SELECT u.id, u.seller_code, u.username, u.display_name, u.role, u.status, u.credits
     FROM telegram_identities t JOIN users u ON u.id = t.user_id
     WHERE t.telegram_user_id = ? AND u.role = 'seller' AND u.status = 'active' LIMIT 1`,
  ).bind(telegramId).first<ManagerUser>();
  return user ? { telegramId, admin: false, user } : null;
}

async function sellerByCode(code: string) {
  return dbBinding().prepare(
    "SELECT id, seller_code, username, display_name, role, status, credits FROM users WHERE role = 'seller' AND seller_code = ? LIMIT 1",
  ).bind(code.trim().toUpperCase()).first<ManagerUser>();
}

async function audit(telegramId: string, command: string, outcome: string) {
  await dbBinding().prepare(
    "INSERT INTO manager_audit_log (id, telegram_user_id, command, outcome, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), telegramId, command.slice(0, 80), outcome.slice(0, 200), new Date().toISOString()).run();
}

async function targetSeller(actor: Actor, code?: string) {
  if (!actor.admin) return actor.user;
  if (!code || !validateSellerCode(code)) throw new Error("Indica un codigo de vendedor valido.");
  const seller = await sellerByCode(code);
  if (!seller) throw new Error("Vendedor no encontrado.");
  return seller;
}

async function listClients(actor: Actor, args: string) {
  const seller = await targetSeller(actor, actor.admin ? fields(args)[0] : actor.user.seller_code);
  const result = await dbBinding().prepare(
    "SELECT username, display_name, status FROM users WHERE owner_id = ? AND role = 'client' ORDER BY created_at DESC LIMIT 30",
  ).bind(seller.id).all<{ username: string; display_name: string; status: string }>();
  const rows = result.results ?? [];
  if (!rows.length) return "No hay clientes registrados.";
  return [`Clientes de ${seller.seller_code}:`, ...rows.map((row) => `${row.username} — ${row.display_name} — ${row.status}`)].join("\n");
}

async function listPending(actor: Actor, args: string) {
  const seller = await targetSeller(actor, actor.admin ? fields(args)[0] : actor.user.seller_code);
  const result = await dbBinding().prepare(
    `SELECT r.id, r.price_credits, u.username, u.display_name
     FROM password_reset_requests r JOIN users u ON u.id = r.user_id
     WHERE r.seller_id = ? AND r.status = 'pending' ORDER BY r.created_at LIMIT 30`,
  ).bind(seller.id).all<{ id: string; price_credits: number; username: string; display_name: string }>();
  const rows = result.results ?? [];
  if (!rows.length) return "No hay restablecimientos pendientes.";
  return ["Restablecimientos pendientes:", ...rows.map((row) => `${row.id}\n${row.username} — ${row.display_name} — costo ${row.price_credits}`)].join("\n\n");
}

async function balance(actor: Actor, args: string) {
  const seller = await targetSeller(actor, actor.admin ? fields(args)[0] : actor.user.seller_code);
  return `Vendedor: ${seller.display_name}\nCodigo: ${seller.seller_code}\nCreditos disponibles: ${seller.credits}`;
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
  await ensureAuthSchema();
  const updateId = String(update.update_id);
  const previous = await dbBinding().prepare("SELECT update_id FROM telegram_updates WHERE update_id = ? LIMIT 1").bind(updateId).first();
  if (previous) return;
  await dbBinding().prepare("INSERT INTO telegram_updates (update_id, received_at) VALUES (?, ?)").bind(updateId, new Date().toISOString()).run();

  const message = update.message ?? update.edited_message;
  if (!message?.from) return;
  if (message.chat.type !== "private") {
    for (const member of message.new_chat_members ?? []) await rememberGroupMember(message.chat.id, member);
    await rememberGroupMember(message.chat.id, message.from);
  }
  if (!message.text) return;
  const telegramId = String(message.from.id);
  const { command, args } = commandParts(message.text);

  if (message.chat.type !== "private") {
    if (command === "/redeem") {
      try {
        const reply = await redeemReferralCode(telegramId, args);
        await audit(telegramId, command, "redeem ok");
        await sendTelegramMessage(message.chat.id, reply);
      } catch (error) {
        await audit(telegramId, command, `redeem error: ${error instanceof Error ? error.name : "desconocido"}`);
        await sendTelegramMessage(message.chat.id, error instanceof Error ? error.message : "No se pudo canjear el codigo.");
      }
      return;
    }
    if (command === "/id") {
      await sendTelegramMessage(message.chat.id, `Tu Telegram ID es: ${telegramId}`);
      return;
    }
    return;
  }
  if (command === "/id") {
    await sendTelegramMessage(message.chat.id, `Tu Telegram ID es: ${telegramId}`);
    return;
  }

  try {
    const actor = await actorFor(telegramId);
    if (!actor) {
      await audit(telegramId, command || "mensaje", "denegado");
      await sendTelegramMessage(message.chat.id, `Acceso no autorizado.\nTu Telegram ID es: ${telegramId}`);
      return;
    }

    if (DISABLED_WRITE_COMMANDS.has(command)) {
      await audit(telegramId, command, "bloqueado: usa panel web");
      await sendTelegramMessage(
        message.chat.id,
        "Esta operación está deshabilitada en Telegram. Usa el panel web autenticado de Yape.",
      );
      return;
    }

    let reply: string;
    switch (command) {
      case "/start":
      case "/ayuda":
        reply = actor.admin ? ADMIN_HELP : SELLER_HELP;
        break;
      case "/clientes": reply = await listClients(actor, args); break;
      case "/pendientes": reply = await listPending(actor, args); break;
      case "/saldo": reply = await balance(actor, args); break;
      default: reply = actor.admin ? ADMIN_HELP : SELLER_HELP;
    }
    await audit(telegramId, command || "mensaje", "ok");
    await sendTelegramMessage(message.chat.id, reply);
  } catch (error) {
    await audit(telegramId, command || "mensaje", `error: ${error instanceof Error ? error.name : "desconocido"}`);
    await sendTelegramMessage(message.chat.id, "No se completó la operación. Revisa el panel web o inténtalo más tarde.");
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
