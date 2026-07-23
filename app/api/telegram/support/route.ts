import { authEnv } from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

function cleanTelegramUsername(value: string | undefined) {
  const username = (value ?? "").trim().replace(/^@/u, "");
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(username) ? username : "";
}

function cleanTelegramUserId(value: string | undefined) {
  const userId = (value ?? "").trim();
  return /^\d{4,24}$/u.test(userId) ? userId : "";
}

function supportMessage(url: URL) {
  return url.searchParams.get("source") === "change-number"
    ? "Hola, necesito solicitar un cambio de número."
    : "Hola, necesito ayuda con mi cuenta.";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const env = authEnv();
  const supportUsername = cleanTelegramUsername(env.TELEGRAM_SUPPORT_USERNAME);
  const supportUserId = cleanTelegramUserId(env.TELEGRAM_SUPPORT_USER_ID);
  const botUsername = cleanTelegramUsername(env.TELEGRAM_BOT_USERNAME);
  const message = supportMessage(requestUrl);

  if (supportUsername) {
    const telegramUrl = new URL(`https://t.me/${supportUsername}`);
    telegramUrl.searchParams.set("text", message);
    return Response.redirect(telegramUrl, 302);
  }

  if (supportUserId) {
    return Response.redirect(`tg://user?id=${encodeURIComponent(supportUserId)}`, 302);
  }

  if (botUsername) {
    const telegramUrl = new URL(`https://t.me/${botUsername}`);
    return Response.redirect(telegramUrl, 302);
  }

  const fallbackUrl = new URL("/", request.url);
  fallbackUrl.searchParams.set("telegram", "missing-support-account");
  return Response.redirect(fallbackUrl, 302);
}
