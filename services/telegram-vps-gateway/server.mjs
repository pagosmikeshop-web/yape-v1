import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;
const REPLY_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_REPLY_CACHE_ENTRIES = 1_000;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const config = {
  port: Number(process.env.PORT ?? 3001),
  botToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
  webhookSecret: requiredEnv("TELEGRAM_WEBHOOK_SECRET"),
  forwardSecret: requiredEnv("TELEGRAM_VPS_FORWARD_SECRET"),
  vercelCommandUrl: requiredEnv("VERCEL_COMMAND_URL"),
};

if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}
if (config.webhookSecret.length < 32 || config.forwardSecret.length < 32) {
  throw new Error("Telegram gateway secrets must be at least 32 characters long.");
}
if (new URL(config.vercelCommandUrl).protocol !== "https:") {
  throw new Error("VERCEL_COMMAND_URL must use HTTPS.");
}

function secureEquals(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function json(response, status, body) {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "x-content-type-options": "nosniff",
  });
  response.end(data);
}

function commandName(text) {
  const trimmed = text.trim();
  const firstSpace = trimmed.search(/\s/u);
  const firstToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  return firstToken.split("@", 1)[0]?.toLocaleLowerCase("es-PE") ?? "";
}

function isRelevantCommandUpdate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  const chat = message.chat;
  if (!chat || typeof chat !== "object" || Array.isArray(chat) || chat.type === "private") return false;
  if (!message.from || typeof message.from !== "object" || typeof message.text !== "string") return false;
  const command = commandName(message.text);
  return command === "/redeem" || command === "/me";
}

async function readBody(request, maxBytes) {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("payload-too-large");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("payload-too-large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readResponseText(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("upstream-response-too-large");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("upstream response-size limit exceeded");
        throw new Error("upstream-response-too-large");
      }
      chunks.push(Buffer.from(chunk.value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

function forwardSignature(rawBody, timestamp) {
  return createHmac("sha256", config.forwardSecret)
    .update(`v1.${timestamp}.${rawBody}`)
    .digest("base64url");
}

async function processAtVercel(rawBody) {
  const timestamp = String(Date.now());
  const response = await fetch(config.vercelCommandUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-telegram-vps-timestamp": timestamp,
      "x-telegram-vps-signature": forwardSignature(rawBody, timestamp),
    },
    body: rawBody,
    signal: AbortSignal.timeout(10_000),
  });
  const responseText = await readResponseText(response, MAX_RESPONSE_BYTES);
  if (!response.ok) throw new Error(`vercel-${response.status}`);
  const result = JSON.parse(responseText);
  if (!result?.ok) throw new Error("vercel-rejected-command");
  return result;
}

function validReply(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!Number.isSafeInteger(value.chatId) || typeof value.text !== "string") return null;
  return {
    chatId: value.chatId,
    text: value.text.slice(0, 4000),
    replyToMessageId: Number.isSafeInteger(value.replyToMessageId) ? value.replyToMessageId : undefined,
  };
}

async function sendTelegramReply(reply) {
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      chat_id: reply.chatId,
      text: reply.text,
      protect_content: true,
      ...(reply.replyToMessageId === undefined
        ? {}
        : { reply_parameters: { message_id: reply.replyToMessageId, allow_sending_without_reply: false } }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`telegram-send-${response.status}`);
}

const replyCache = new Map();

function rememberReply(updateId, reply) {
  if (replyCache.size >= MAX_REPLY_CACHE_ENTRIES) {
    const oldestUpdateId = replyCache.keys().next().value;
    if (oldestUpdateId !== undefined) replyCache.delete(oldestUpdateId);
  }
  replyCache.set(updateId, { reply, delivered: false, expiresAt: Date.now() + REPLY_CACHE_TTL_MS });
}

function cachedReply(updateId) {
  const item = replyCache.get(updateId);
  if (!item || item.expiresAt <= Date.now()) {
    replyCache.delete(updateId);
    return null;
  }
  return item;
}

async function handleTelegramWebhook(request, response) {
  const receivedSecret = request.headers["x-telegram-bot-api-secret-token"] ?? "";
  if (typeof receivedSecret !== "string" || !secureEquals(receivedSecret, config.webhookSecret)) {
    json(response, 401, { ok: false });
    return;
  }

  let rawBody;
  let update;
  try {
    rawBody = await readBody(request, MAX_BODY_BYTES);
    update = JSON.parse(rawBody);
  } catch (error) {
    json(response, error instanceof Error && error.message === "payload-too-large" ? 413 : 400, { ok: false });
    return;
  }

  if (!isRelevantCommandUpdate(update)) {
    json(response, 200, { ok: true, ignored: true });
    return;
  }

  const updateId = Number.isSafeInteger(update.update_id) ? String(update.update_id) : "";
  const cached = updateId ? cachedReply(updateId) : null;
  try {
    if (cached) {
      if (!cached.delivered) {
        await sendTelegramReply(cached.reply);
        cached.delivered = true;
      }
      json(response, 200, { ok: true });
      return;
    }

    const result = await processAtVercel(rawBody);
    const reply = validReply(result.reply);
    if (reply && updateId) rememberReply(updateId, reply);
    if (reply) {
      await sendTelegramReply(reply);
      if (updateId) {
        const item = cachedReply(updateId);
        if (item) item.delivered = true;
      }
    }
    console.info("[telegram-vps-gateway]", { result: result.result ?? "unknown", forwarded: true });
    json(response, 200, { ok: true });
  } catch (error) {
    // A non-200 makes Telegram retry. No request body, Telegram IDs or tokens are logged.
    console.error("[telegram-vps-gateway]", { outcome: "failure", reason: error instanceof Error ? error.message : "unknown" });
    json(response, 502, { ok: false });
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && request.url === "/telegram/webhook") {
    await handleTelegramWebhook(request, response);
    return;
  }
  json(response, 404, { ok: false });
});

server.listen(config.port, "127.0.0.1", () => {
  console.info(`[telegram-vps-gateway] listening on 127.0.0.1:${config.port}`);
});
