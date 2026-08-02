import {
  dbBinding,
  isUniqueConstraintError,
  normalizePeruvianMobile,
  routeError,
} from "@/app/lib/auth-server";
import { base64UrlToBytes, bytesToBase64Url } from "@/app/lib/base64url";

const MIN_QR_BYTES = 4;
const MAX_QR_BYTES = 2_048;
const MIN_ENCRYPTION_SECRET_LENGTH = 32;
const SAFE_QR_PAYLOAD_PATTERN = /^[^\u0000-\u001f\u007f]+$/u;

type AccountPaymentDataEnvironment = {
  DB?: D1Database;
  QR_CONTACTS_ENCRYPTION_KEY?: string;
};

type AccountPaymentProfileRow = {
  user_id: string;
  phone_e164: string | null;
  qr_payload_ciphertext: string | null;
  qr_payload_iv: string | null;
  accuracy_confirmed_at: string;
  updated_at: string;
};

export type AccountPaymentData = {
  phone: string | null;
  qrPayload: string | null;
  updatedAt: string | null;
  accuracyConfirmedAt: string | null;
};

export class AccountPaymentDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "ACCOUNT_PAYMENT_DATA_INVALID",
  ) {
    super(message);
    this.name = "AccountPaymentDataError";
  }
}

function environment() {
  const globals = globalThis as typeof globalThis & {
    __YAPE_ENV?: AccountPaymentDataEnvironment;
    process?: { env?: Record<string, string | undefined> };
  };
  return globals.__YAPE_ENV ?? (globals.process?.env as AccountPaymentDataEnvironment | undefined) ?? {};
}

function encryptionSecret() {
  const secret = environment().QR_CONTACTS_ENCRYPTION_KEY?.trim() ?? "";
  if (secret.length < MIN_ENCRYPTION_SECRET_LENGTH) {
    throw new AccountPaymentDataError(
      "El guardado seguro del QR no está configurado.",
      503,
      "QR_ENCRYPTION_UNAVAILABLE",
    );
  }
  return secret;
}

async function encryptionKey(usage: KeyUsage) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(encryptionSecret()),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [usage]);
}

async function encryptQr(userId: string, payload: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(`mi-banco-account-qr-v1\n${userId}`),
      tagLength: 128,
    },
    await encryptionKey("encrypt"),
    new TextEncoder().encode(payload),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptQr(userId: string, ciphertext: string, iv: string) {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(iv),
        additionalData: new TextEncoder().encode(`mi-banco-account-qr-v1\n${userId}`),
        tagLength: 128,
      },
      await encryptionKey("decrypt"),
      base64UrlToBytes(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new AccountPaymentDataError(
      "No pudimos leer el QR guardado.",
      503,
      "QR_DECRYPTION_FAILED",
    );
  }
}

function parseQrPayload(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AccountPaymentDataError("El contenido del QR no es válido.");
  }
  const payload = value.trim();
  const byteLength = new TextEncoder().encode(payload).byteLength;
  if (
    byteLength < MIN_QR_BYTES
    || byteLength > MAX_QR_BYTES
    || !SAFE_QR_PAYLOAD_PATTERN.test(payload)
    || /^(?:data|blob):/iu.test(payload)
  ) {
    throw new AccountPaymentDataError(
      "El contenido del QR debe tener entre 4 y 2048 caracteres válidos.",
    );
  }
  return payload;
}

function parsePhone(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AccountPaymentDataError("Ingresa un número de celular peruano válido.");
  }
  const phone = normalizePeruvianMobile(value);
  if (!phone) {
    throw new AccountPaymentDataError("Ingresa un número de celular peruano válido.");
  }
  return phone;
}

export type AccountPaymentDataInput = {
  phone?: unknown;
  qrPayload?: unknown;
  acceptAccuracyWarning?: unknown;
};

function parseInput(input: AccountPaymentDataInput) {
  if (input.acceptAccuracyWarning !== true) {
    throw new AccountPaymentDataError(
      "Confirma que los datos son reales para guardarlos.",
    );
  }
  const phone = parsePhone(input.phone);
  const qrPayload = parseQrPayload(input.qrPayload);
  if (!phone && !qrPayload) {
    throw new AccountPaymentDataError("Ingresa un celular o el contenido de un QR.");
  }
  return { phone, qrPayload };
}

async function rowToDto(row: AccountPaymentProfileRow | null, fallbackPhone: string | null) {
  if (!row) {
    return {
      phone: fallbackPhone,
      qrPayload: null,
      updatedAt: null,
      accuracyConfirmedAt: null,
    } satisfies AccountPaymentData;
  }
  const qrPayload = row.qr_payload_ciphertext && row.qr_payload_iv
    ? await decryptQr(row.user_id, row.qr_payload_ciphertext, row.qr_payload_iv)
    : null;
  return {
    phone: row.phone_e164 ?? fallbackPhone,
    qrPayload,
    updatedAt: row.updated_at,
    accuracyConfirmedAt: row.accuracy_confirmed_at,
  } satisfies AccountPaymentData;
}

export async function getAccountPaymentData(userId: string) {
  const db = dbBinding();
  const row = await db.prepare(
    `SELECT user_id, phone_e164, qr_payload_ciphertext, qr_payload_iv,
            accuracy_confirmed_at, updated_at
     FROM account_payment_profiles WHERE user_id = ? LIMIT 1`,
  ).bind(userId).first<AccountPaymentProfileRow>();
  const fallback = await db.prepare(
    "SELECT phone_e164 FROM payment_directory WHERE user_id = ? LIMIT 1",
  ).bind(userId).first<{ phone_e164: string | null }>();
  return rowToDto(row, fallback?.phone_e164 ?? null);
}

export async function saveAccountPaymentData(userId: string, input: AccountPaymentDataInput) {
  const { phone, qrPayload } = parseInput(input);
  const now = new Date().toISOString();
  const encrypted = qrPayload ? await encryptQr(userId, qrPayload) : null;
  const db = dbBinding();
  try {
    const statements = [
      db.prepare(
        `INSERT INTO account_payment_profiles (
           user_id, phone_e164, qr_payload_ciphertext, qr_payload_iv,
           accuracy_confirmed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           phone_e164 = excluded.phone_e164,
           qr_payload_ciphertext = excluded.qr_payload_ciphertext,
           qr_payload_iv = excluded.qr_payload_iv,
           accuracy_confirmed_at = excluded.accuracy_confirmed_at,
           updated_at = excluded.updated_at`,
      ).bind(userId, phone, encrypted?.ciphertext ?? null, encrypted?.iv ?? null, now, now, now),
      ...(phone
        ? [
            db.prepare(
              `INSERT INTO payment_directory (
                 id, user_id, phone_e164, discoverable, verified_at, created_at, updated_at
               ) VALUES (?, ?, ?, 1, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 phone_e164 = excluded.phone_e164,
                 discoverable = 1,
                 verified_at = excluded.verified_at,
                 updated_at = excluded.updated_at`,
            ).bind(crypto.randomUUID(), userId, phone, now, now, now),
          ]
        : [db.prepare("DELETE FROM payment_directory WHERE user_id = ?").bind(userId)]),
    ];
    await db.batch(statements);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AccountPaymentDataError(
        "Ese número ya está asociado a otra cuenta.",
        409,
        "PHONE_ALREADY_REGISTERED",
      );
    }
    throw error;
  }
  return getAccountPaymentData(userId);
}

export function accountPaymentDataRouteError(error: unknown) {
  if (error instanceof AccountPaymentDataError) {
    return Response.json(
      { ok: false, error: error.message, code: error.code },
      {
        status: error.status,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }
  const response = routeError(error);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
