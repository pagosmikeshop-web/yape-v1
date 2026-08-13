import { authEnv } from "@/app/lib/auth-server";
import { bytesToBase64Url } from "@/app/lib/base64url";
import { sameSecret } from "@/app/lib/telegram-manager";

export const TELEGRAM_VPS_TIMESTAMP_HEADER = "x-telegram-vps-timestamp";
export const TELEGRAM_VPS_SIGNATURE_HEADER = "x-telegram-vps-signature";

const MAX_FORWARD_AGE_MS = 90_000;

export function telegramVpsForwardSecret() {
  return authEnv().TELEGRAM_VPS_FORWARD_SECRET?.trim() ?? "";
}

async function hmacSha256Base64Url(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function signTelegramVpsForwardBody(
  rawBody: string,
  timestamp: string,
  secret = telegramVpsForwardSecret(),
) {
  if (secret.length < 32) throw new Error("Telegram VPS forward secret is not configured.");
  return hmacSha256Base64Url(secret, `v1.${timestamp}.${rawBody}`);
}

export async function verifyTelegramVpsForward(
  rawBody: string,
  timestamp: string,
  signature: string,
) {
  const secret = telegramVpsForwardSecret();
  if (secret.length < 32 || !/^\d{13}$/u.test(timestamp) || !signature) return false;
  const sentAt = Number(timestamp);
  if (!Number.isSafeInteger(sentAt) || Math.abs(Date.now() - sentAt) > MAX_FORWARD_AGE_MS) return false;
  return sameSecret(signature, await signTelegramVpsForwardBody(rawBody, timestamp, secret));
}
