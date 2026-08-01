import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { authEnv } from "@/app/lib/auth-server";

/**
 * Keeps issued keys recoverable for authorized panel users without storing
 * plaintext tokens in Supabase. Redemption continues to use the one-way hash.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function encryptionKey() {
  const env = authEnv();
  const secret = env.TOKEN_ENCRYPTION_SECRET?.trim()
    || env.ADMIN_PROXY_SECRET?.trim()
    || env.AUTH_RATE_LIMIT_PEPPER?.trim();
  if (!secret) {
    throw new Error("TOKEN_ENCRYPTION_SECRET no está configurado.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function encode(value: Buffer) {
  return value.toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

export function encryptIssuedToken(token: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, encode(iv), encode(cipher.getAuthTag()), encode(ciphertext)].join(".");
}

export function decryptIssuedToken(payload: string | null | undefined) {
  if (!payload) return null;
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext] = payload.split(".");
    if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) return null;
    const iv = decode(encodedIv);
    const tag = decode(encodedTag);
    const ciphertext = decode(encodedCiphertext);
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
