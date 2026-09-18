import { base64UrlToBytes, bytesToBase64Url } from "../base64url";

const LEGACY_PBKDF2_ITERATIONS = 120_000;
const CURRENT_PBKDF2_ITERATIONS = 600_000;
const HASH_FORMAT = "pbkdf2-sha256";

export async function sha256(value: string | Uint8Array) {
  const source = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", source.buffer)));
}

export async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export function randomToken(size = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function publicSha256(value: string) {
  return sha256(value);
}

export function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function secureCompare(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  return constantTimeEqual(leftHash, rightHash);
}

async function deriveSecret(secret: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64UrlToBytes(salt), iterations },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function parseStoredSecretHash(value: string) {
  const match = /^pbkdf2-sha256\$(\d{5,7})\$([A-Za-z0-9_-]{32,64})$/u.exec(value);
  if (!match) {
    return { iterations: LEGACY_PBKDF2_ITERATIONS, digest: value, versioned: false };
  }
  const iterations = Number(match[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) {
    return null;
  }
  return { iterations, digest: match[2], versioned: true };
}

export async function hashSecret(secret: string, salt = randomToken(16)) {
  const digest = await deriveSecret(secret, salt, CURRENT_PBKDF2_ITERATIONS);
  return { salt, hash: `${HASH_FORMAT}$${CURRENT_PBKDF2_ITERATIONS}$${digest}` };
}

export async function verifySecret(secret: string, salt: string, expected: string) {
  const stored = parseStoredSecretHash(expected);
  if (!stored) return false;
  const actual = await deriveSecret(secret, salt, stored.iterations);
  return constantTimeEqual(actual, stored.digest);
}

export function secretHashNeedsUpgrade(expected: string) {
  const stored = parseStoredSecretHash(expected);
  return Boolean(!stored || !stored.versioned || stored.iterations < CURRENT_PBKDF2_ITERATIONS);
}
