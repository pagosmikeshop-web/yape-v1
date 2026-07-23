import { dbBinding, normalizePeruvianMobile, routeError } from "@/app/lib/auth-server";
import { parsePaymentQrPayload, UUID_PATTERN } from "@/app/lib/payment-qr";

export const QR_CONTACT_PROVIDERS = [
  "Yape",
  "Plin",
  "BCP",
  "BBVA",
  "Interbank",
  "Scotiabank",
  "Bim",
  "Banco Falabella",
  "Banco Pichincha",
  "Dale!",
  "Izipay",
  "Agora / Oh!",
  "Tunki",
] as const;
export type QrContactProvider = (typeof QR_CONTACT_PROVIDERS)[number];
const LEGACY_INTERNAL_PROVIDER = "Mi Banco";

const HOLDER_NAME_PATTERN = /^[^\u0000-\u001f\u007f]{2,80}$/u;
const SAFE_QR_PAYLOAD_PATTERN = /^[^\u0000-\u001f\u007f]+$/u;
const MIN_QR_BYTES = 4;
const MAX_QR_BYTES = 2_048;
const MAX_CONTACTS_PER_USER = 50;
const MIN_ENCRYPTION_SECRET_LENGTH = 32;
let schemaReady: Promise<void> | null = null;

type QrContactEnv = {
  DB?: D1Database;
  QR_CONTACTS_ENCRYPTION_KEY?: string;
};

type QrContactRow = {
  id: string;
  holder_name: string;
  phone_e164: string | null;
  provider: string;
  recipient_user_id: string | null;
  created_at: string;
};

type VerifiedRecipientRow = {
  id: string;
  display_name: string;
  phone_e164: string | null;
};

export type QrContact = {
  id: string;
  holderName: string;
  phone: string | null;
  provider: QrContactProvider;
  recipientId: string | null;
  verified: boolean;
  createdAt: string;
};

export class QrContactError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "QR_CONTACT_INVALID",
  ) {
    super(message);
    this.name = "QrContactError";
  }
}

function env() {
  const globals = globalThis as typeof globalThis & {
    __YAPE_ENV?: QrContactEnv;
    process?: { env?: Record<string, string | undefined> };
  };
  return globals.__YAPE_ENV ?? (globals.process?.env as QrContactEnv | undefined) ?? {};
}

function encryptionSecret() {
  const secret = env().QR_CONTACTS_ENCRYPTION_KEY?.trim() ?? "";
  if (secret.length < MIN_ENCRYPTION_SECRET_LENGTH) {
    throw new QrContactError(
      "El guardado seguro de QR no está configurado.",
      503,
      "QR_ENCRYPTION_UNAVAILABLE",
    );
  }
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionSecret()));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
}

async function payloadHash(userId: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(encryptionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`mi-banco-qr-contact-hash-v1\n${userId}\n${payload}`),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function encryptPayload(userId: string, payload: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(`mi-banco-qr-contact-v1\n${userId}`),
      tagLength: 128,
    },
    await encryptionKey(),
    new TextEncoder().encode(payload),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

function parseProvider(value: string): QrContactProvider {
  const normalized = value.trim().toLocaleLowerCase("es-PE");
  if (normalized === LEGACY_INTERNAL_PROVIDER.toLocaleLowerCase("es-PE")) return "Yape";
  const provider = QR_CONTACT_PROVIDERS.find(
    (candidate) => candidate.toLocaleLowerCase("es-PE") === normalized,
  );
  if (!provider) throw new QrContactError("Selecciona un proveedor de QR permitido.");
  return provider;
}

function parseHolderName(value: string) {
  const holderName = value.trim().replace(/\s+/gu, " ");
  if (!HOLDER_NAME_PATTERN.test(holderName)) {
    throw new QrContactError("El nombre del titular debe tener entre 2 y 80 caracteres válidos.");
  }
  return holderName;
}

function parsePhone(value: string) {
  if (!value.trim()) return null;
  const phone = normalizePeruvianMobile(value);
  if (!phone) throw new QrContactError("Ingresa un celular peruano válido o deja el campo vacío.");
  return phone;
}

function validateDecodedPayload(rawValue: string) {
  const payload = rawValue.trim();
  const byteLength = new TextEncoder().encode(payload).byteLength;
  if (
    byteLength < MIN_QR_BYTES
    || byteLength > MAX_QR_BYTES
    || !SAFE_QR_PAYLOAD_PATTERN.test(payload)
    || /^(?:data|blob):/iu.test(payload)
  ) {
    throw new QrContactError("El contenido leído del QR no es válido o excede 2048 bytes.");
  }
  return payload;
}

export function assertSameOriginMutation(request: Request, requireJson: boolean) {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host")?.trim() ?? "";
  const origin = request.headers.get("origin")?.trim() ?? "";
  if (!host || host.toLocaleLowerCase("en-US") !== requestUrl.host.toLocaleLowerCase("en-US")) {
    throw new QrContactError("Solicitud no permitida.", 403, "INVALID_HOST");
  }
  try {
    if (!origin || new URL(origin).origin !== requestUrl.origin) throw new Error("Origin mismatch.");
  } catch {
    throw new QrContactError("Solicitud de otro origen bloqueada.", 403, "INVALID_ORIGIN");
  }
  if (requireJson && request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new QrContactError("El contenido debe enviarse como JSON.", 415, "JSON_REQUIRED");
  }
}

export async function ensureQrContactSchema() {
  if (schemaReady) return schemaReady;
  const database = dbBinding();
  schemaReady = database.batch([
    database.prepare(
      `CREATE TABLE IF NOT EXISTS qr_contacts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        holder_name TEXT NOT NULL,
        phone_e164 TEXT,
        provider TEXT NOT NULL CHECK (provider IN (
          'Mi Banco','Yape','Plin','BCP','BBVA','Interbank','Scotiabank','Bim',
          'Banco Falabella','Banco Pichincha','Dale!','Izipay','Agora / Oh!','Tunki'
        )),
        recipient_user_id TEXT,
        qr_payload_ciphertext TEXT NOT NULL,
        qr_payload_iv TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        encryption_version INTEGER NOT NULL DEFAULT 1 CHECK (encryption_version = 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (user_id, payload_hash)
      )`,
    ),
    database.prepare("CREATE INDEX IF NOT EXISTS qr_contacts_user_updated_idx ON qr_contacts(user_id, updated_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS qr_contacts_recipient_idx ON qr_contacts(recipient_user_id)"),
  ]).then(() => undefined).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function rowToContact(row: QrContactRow): QrContact {
  return {
    id: row.id,
    holderName: row.holder_name,
    phone: maskPhone(row.phone_e164),
    provider: row.provider === LEGACY_INTERNAL_PROVIDER ? "Yape" : row.provider as QrContactProvider,
    recipientId: row.recipient_user_id,
    verified: Boolean(row.recipient_user_id),
    createdAt: row.created_at,
  };
}

function maskPhone(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 3 ? `*** *** ${digits.slice(-3)}` : null;
}

export async function listQrContacts(userId: string) {
  await ensureQrContactSchema();
  const rows = await dbBinding().prepare(
    `SELECT id, holder_name, phone_e164, provider, recipient_user_id, created_at
     FROM qr_contacts WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
  ).bind(userId, MAX_CONTACTS_PER_USER).all<QrContactRow>();
  return (rows.results ?? []).map(rowToContact);
}

export async function createQrContact(userId: string, input: {
  holderName: string;
  phone: string;
  provider: string;
  payload: string;
}) {
  await ensureQrContactSchema();
  const provider = parseProvider(input.provider);
  const payload = validateDecodedPayload(input.payload);
  let holderName = "";
  let phone: string | null = null;
  let recipientId: string | null = null;

  const parsedRecipientId = provider === "Yape" ? parsePaymentQrPayload(payload) : "";
  if (parsedRecipientId) {
    if (parsedRecipientId === userId) {
      throw new QrContactError("No puedes guardar tu propio QR como contacto.", 409, "QR_CONTACT_SELF");
    }
    const recipient = await dbBinding().prepare(
      `SELECT u.id, u.display_name, d.phone_e164
       FROM users u
       LEFT JOIN payment_directory d ON d.user_id = u.id AND d.discoverable = 1
       WHERE u.id = ? AND u.role = 'client' AND u.status = 'active'
       LIMIT 1`,
    ).bind(parsedRecipientId).first<VerifiedRecipientRow>();
    if (!recipient) {
      throw new QrContactError("El destinatario de Yape no está activo.", 404, "QR_RECIPIENT_NOT_FOUND");
    }
    recipientId = recipient.id;
    holderName = parseHolderName(recipient.display_name);
    phone = recipient.phone_e164;
  } else {
    holderName = parseHolderName(input.holderName);
    phone = parsePhone(input.phone);
  }

  if (recipientId) {
    const existingRecipient = await dbBinding().prepare(
      "SELECT id FROM qr_contacts WHERE user_id = ? AND recipient_user_id = ? LIMIT 1",
    ).bind(userId, recipientId).first<{ id: string }>();
    if (existingRecipient) {
      throw new QrContactError("Este contacto de Yape ya está guardado.", 409, "QR_CONTACT_DUPLICATE");
    }
  }

  const hash = await payloadHash(userId, payload);
  const existing = await dbBinding().prepare(
    "SELECT id FROM qr_contacts WHERE user_id = ? AND payload_hash = ? LIMIT 1",
  ).bind(userId, hash).first<{ id: string }>();
  if (existing) throw new QrContactError("Este QR ya está guardado.", 409, "QR_CONTACT_DUPLICATE");

  const usage = await dbBinding().prepare(
    "SELECT COUNT(*) AS total FROM qr_contacts WHERE user_id = ?",
  ).bind(userId).first<{ total: number }>();
  if (Number(usage?.total ?? 0) >= MAX_CONTACTS_PER_USER) {
    throw new QrContactError("Alcanzaste el límite de 50 contactos QR.", 409, "QR_CONTACT_LIMIT");
  }

  const encrypted = await encryptPayload(userId, payload);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    const result = await dbBinding().prepare(
      `INSERT INTO qr_contacts (
        id, user_id, holder_name, phone_e164, provider, recipient_user_id,
        qr_payload_ciphertext, qr_payload_iv, payload_hash, encryption_version,
        created_at, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
        WHERE (SELECT COUNT(*) FROM qr_contacts WHERE user_id = ?) < ?`,
    ).bind(
      id,
      userId,
      holderName,
      phone,
      provider,
      recipientId,
      encrypted.ciphertext,
      encrypted.iv,
      hash,
      now,
      now,
      userId,
      MAX_CONTACTS_PER_USER,
    ).run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new QrContactError("Alcanzaste el límite de 50 contactos QR.", 409, "QR_CONTACT_LIMIT");
    }
  } catch (error) {
    if (error instanceof QrContactError) throw error;
    const duplicate = await dbBinding().prepare(
      "SELECT id FROM qr_contacts WHERE user_id = ? AND payload_hash = ? LIMIT 1",
    ).bind(userId, hash).first<{ id: string }>();
    if (duplicate) throw new QrContactError("Este QR ya está guardado.", 409, "QR_CONTACT_DUPLICATE");
    throw error;
  }

  return {
    id,
    holderName,
    phone: maskPhone(phone),
    provider,
    recipientId,
    verified: Boolean(recipientId),
    createdAt: now,
  } satisfies QrContact;
}

export async function deleteQrContact(userId: string, id: string) {
  if (!UUID_PATTERN.test(id)) throw new QrContactError("Contacto QR inválido.");
  await ensureQrContactSchema();
  const result = await dbBinding().prepare(
    "DELETE FROM qr_contacts WHERE id = ? AND user_id = ?",
  ).bind(id, userId).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new QrContactError("Contacto QR no encontrado.", 404, "QR_CONTACT_NOT_FOUND");
  }
}

export function qrJson(data: Record<string, unknown>, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
  });
}

export function qrRouteError(error: unknown) {
  if (error instanceof QrContactError) {
    return qrJson({ ok: false, error: error.message, code: error.code }, error.status);
  }
  const response = routeError(error);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
