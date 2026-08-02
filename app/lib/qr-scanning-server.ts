import { authEnv, dbBinding, isUniqueConstraintError, requireUnlockedSession, type AuthUser } from "@/app/lib/auth-server";
import { isSupabaseDatabase } from "@/app/lib/database-server";
import { parsePaymentQrPayload } from "@/app/lib/payment-qr";
import { globalQrPayloadHash } from "@/app/lib/qr-contact-server";
import { maskRecipientName } from "@/app/lib/recipient-lookup/name-masker";
import { normalizeQrPayload } from "@/app/lib/qr-scanning";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** El lector expone únicamente estos dos resultados al cliente. */
export type QrScanStatus = "valid" | "invalid";

export type QrScanResult = {
  status: QrScanStatus;
  message: string;
  qr?: {
    id: string;
    name: string;
    provider: string;
    recipientId: string | null;
  };
};

export class QrScanError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "QR_SCAN_INVALID") {
    super(message);
    this.name = "QrScanError";
  }
}

type QrRow = {
  id: string;
  holder_name: string;
  provider: string;
  recipient_user_id: string | null;
  status: "active" | "revoked";
  expires_at: string | null;
};

type ExistingEvent = {
  scan_status: QrScanStatus;
  response_payload: string | null;
};

type RecipientRow = { id: string; display_name: string };

function normalizeQrValue(value: unknown) {
  const normalized = normalizeQrPayload(value);
  if (!normalized) {
    throw new QrScanError("El QR es inválido.", 400, "QR_VALUE_INVALID");
  }
  return normalized;
}

function normalizeScanId(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new QrScanError("No se pudo identificar la lectura.", 400, "SCAN_ID_INVALID");
  }
  return value.trim().toLowerCase();
}

function safeUserAgent(value: string | null) {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 240) || null;
}

function deviceInformation(request: Request) {
  const mobile = request.headers.get("sec-ch-ua-mobile")?.trim();
  return mobile === "?1" ? "mobile" : mobile === "?0" ? "desktop" : "unknown";
}

function responseForEvent(payload: string | null) {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as QrScanResult;
    return parsed && (parsed.status === "valid" || parsed.status === "invalid") ? parsed : null;
  } catch {
    return null;
  }
}

function resultMessage(status: QrScanStatus) {
  return status === "valid" ? "QR válido." : "QR inválido.";
}

function result(status: QrScanStatus, qr?: QrScanResult["qr"]): QrScanResult {
  return { status, message: resultMessage(status), ...(qr ? { qr } : {}) };
}

async function ensureQrScanningSchemaUncached() {
  const database = dbBinding();
  if (!isSupabaseDatabase(authEnv())) {
    try { await database.prepare("ALTER TABLE global_qr_directory ADD COLUMN expires_at TEXT").run(); } catch (error) {
      if (!/duplicate column|already exists/iu.test(error instanceof Error ? error.message : String(error))) throw error;
    }
    await database.exec(`
      CREATE TABLE IF NOT EXISTS qr_scan_events (
        id TEXT PRIMARY KEY,
        qr_id TEXT,
        scanned_value_hash TEXT NOT NULL,
        scanned_by_user_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        scan_status TEXT NOT NULL,
        error_code TEXT,
        response_payload TEXT,
        device_information TEXT,
        user_agent TEXT,
        scanned_at TEXT NOT NULL,
        UNIQUE (scanned_by_user_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS qr_scan_events_qr_time_idx ON qr_scan_events(qr_id, scanned_at);
      CREATE INDEX IF NOT EXISTS qr_scan_events_user_time_idx ON qr_scan_events(scanned_by_user_id, scanned_at);
    `);
    return;
  }

  const columns = await database.prepare(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'global_qr_directory'
       AND column_name IN ('payload_hash', 'status', 'expires_at')`,
  ).all<{ column_name: string }>().catch(() => ({ results: [] }));
  const found = new Set((columns.results ?? []).map((row) => row.column_name));
  if (found.size < 3) {
    throw new QrScanError("El lector QR todavía no está configurado.", 503, "QR_SCHEMA_UNAVAILABLE");
  }
  const eventTable = await database.prepare("SELECT to_regclass('public.qr_scan_events') AS table_name").first<{ table_name: string | null }>();
  if (!eventTable?.table_name) {
    throw new QrScanError("El historial QR todavía no está configurado.", 503, "QR_SCHEMA_UNAVAILABLE");
  }
}

let qrSchemaReady: Promise<void> | null = null;

function ensureQrScanningSchema() {
  if (qrSchemaReady) return qrSchemaReady;
  qrSchemaReady = ensureQrScanningSchemaUncached().catch((error) => {
    qrSchemaReady = null;
    throw error;
  });
  return qrSchemaReady;
}

async function findExistingEvent(userId: string, scanId: string) {
  return dbBinding().prepare(
    `SELECT scan_status, response_payload FROM qr_scan_events
     WHERE scanned_by_user_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(userId, scanId).first<ExistingEvent>();
}

async function logEvent(input: {
  user: AuthUser;
  scanId: string;
  valueHash: string;
  qrId: string | null;
  status: QrScanStatus;
  errorCode?: string | null;
  result: QrScanResult;
  request: Request;
}) {
  const now = new Date().toISOString();
  try {
    await dbBinding().prepare(
      `INSERT INTO qr_scan_events (
        id, qr_id, scanned_value_hash, scanned_by_user_id, idempotency_key,
        scan_status, error_code, response_payload, device_information, user_agent, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scanned_by_user_id, idempotency_key) DO NOTHING`,
    ).bind(
      crypto.randomUUID(), input.qrId, input.valueHash, input.user.id, input.scanId,
      input.status, input.errorCode ?? null, JSON.stringify(input.result),
      deviceInformation(input.request), safeUserAgent(input.request.headers.get("user-agent")), now,
    ).run();
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
  return input.result;
}

async function invalidResult(
  user: AuthUser,
  scanId: string,
  valueHash: string,
  qrId: string | null,
  request: Request,
  errorCode: string,
) {
  const invalid = result("invalid");
  return logEvent({ user, scanId, valueHash, qrId, status: "invalid", errorCode, result: invalid, request });
}

export async function scanQr(input: {
  user: AuthUser;
  value: unknown;
  scanId: unknown;
  request: Request;
}) {
  await ensureQrScanningSchema();
  const value = normalizeQrValue(input.value);
  const scanId = normalizeScanId(input.scanId);
  const existing = await findExistingEvent(input.user.id, scanId);
  if (existing) return responseForEvent(existing.response_payload) ?? result("invalid");

  const valueHash = await globalQrPayloadHash(value);
  const database = dbBinding();
  const row = await database.prepare(
    `SELECT id, holder_name, provider, recipient_user_id, status, expires_at
     FROM global_qr_directory WHERE payload_hash = ? LIMIT 1`,
  ).bind(valueHash).first<QrRow>();

  if (!row) {
    const recipientId = parsePaymentQrPayload(value);
    if (!recipientId || recipientId === input.user.id) {
      return invalidResult(input.user, scanId, valueHash, null, input.request, "QR_NOT_FOUND");
    }
    const recipient = await database.prepare(
      `SELECT u.id, u.display_name FROM users u
       WHERE u.id = ? AND (u.role = 'client' OR EXISTS (
         SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'client'
       )) AND u.status = 'active' AND u.deleted_at IS NULL LIMIT 1`,
    ).bind(recipientId).first<RecipientRow>();
    if (!recipient) return invalidResult(input.user, scanId, valueHash, null, input.request, "RECIPIENT_NOT_FOUND");
    return logEvent({
      user: input.user,
      scanId,
      valueHash,
      qrId: null,
      status: "valid",
      result: result("valid", {
        id: "payment",
        name: maskRecipientName(recipient.display_name),
        provider: "Yape",
        recipientId: recipient.id,
      }),
      request: input.request,
    });
  }

  if (row.status !== "active" || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) {
    return invalidResult(input.user, scanId, valueHash, row.id, input.request, "QR_NOT_ACTIVE");
  }

  return logEvent({
    user: input.user,
    scanId,
    valueHash,
    qrId: row.id,
    status: "valid",
    result: result("valid", {
      id: row.id,
      name: row.holder_name,
      provider: row.provider,
      recipientId: row.recipient_user_id,
    }),
    request: input.request,
  });
}

export async function requireQrScannerSession(request: Request) {
  return requireUnlockedSession(request, ["admin", "seller", "client"]);
}

export { normalizeQrValue };
