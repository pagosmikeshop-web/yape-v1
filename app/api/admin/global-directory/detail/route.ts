import { jsonError, jsonOk } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import { decryptGlobalQrPayload, QrContactError } from "@/app/lib/qr-contact-server";
import { assertOwner } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

type DirectoryKind = "recipient" | "qr";
type DirectoryStatus = "active" | "revoked";

type DetailRow = {
  id: string;
  kind: DirectoryKind;
  name: string;
  phone_e164: string | null;
  source: string;
  provider: string | null;
  status: DirectoryStatus;
  submitted_by_user_id: string;
  submitter_telegram_id: string | null;
  submitter_name: string | null;
  submitter_username: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  qr_payload_ciphertext?: string | null;
  qr_payload_iv?: string | null;
};

function kindValue(value: string): DirectoryKind | "" {
  return value === "recipient" || value === "qr" ? value : "";
}

function rowDto(row: DetailRow) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    phone: row.phone_e164,
    source: row.source,
    provider: row.provider,
    status: row.status,
    submittedBy: {
      id: row.submitted_by_user_id,
      telegramId: row.submitter_telegram_id,
      name: row.submitter_name || row.submitter_username || "Cuenta no disponible",
      username: row.submitter_username,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

export async function GET(request: Request) {
  try {
    const { user: actor } = await requireUnlockedSession(request, ["admin"]);
    assertOwner(actor);
    await enforceAuthRateLimits([{ bucket: "global-directory-preview", subject: actor.id, limit: 120, windowSeconds: 60 * 60 }]);

    const url = new URL(request.url);
    const id = (url.searchParams.get("id") ?? "").trim();
    const kind = kindValue((url.searchParams.get("kind") ?? "").trim());
    if (!kind || !/^[0-9a-f-]{16,80}$/iu.test(id)) {
      return jsonError("El registro solicitado no es válido.", 400, "INVALID_DIRECTORY_ENTRY");
    }

    const database = dbBinding();
    const row = kind === "qr"
      ? await database.prepare(
        `SELECT q.id, 'qr' AS kind, q.holder_name AS name, q.phone_e164,
          'qr' AS source, q.provider, q.status, q.submitted_by_user_id,
          u.telegram_user_id AS submitter_telegram_id,
          u.display_name AS submitter_name, u.username AS submitter_username,
          q.created_at, q.updated_at, q.revoked_at, q.revoked_reason,
          q.qr_payload_ciphertext, q.qr_payload_iv
         FROM global_qr_directory q
         LEFT JOIN users u ON u.id = q.submitted_by_user_id
         WHERE q.id = ? LIMIT 1`,
      ).bind(id).first<DetailRow>()
      : await database.prepare(
        `SELECT d.id, 'recipient' AS kind, d.display_name AS name, d.phone_e164,
          d.source, d.provider, d.status, d.submitted_by_user_id,
          u.telegram_user_id AS submitter_telegram_id,
          u.display_name AS submitter_name, u.username AS submitter_username,
          d.created_at, d.updated_at, d.revoked_at, d.revoked_reason
         FROM global_recipient_directory d
         LEFT JOIN users u ON u.id = d.submitted_by_user_id
         WHERE d.id = ? LIMIT 1`,
      ).bind(id).first<DetailRow>();

    if (!row) return jsonError("El registro solicitado ya no está disponible.", 404, "DIRECTORY_ENTRY_NOT_FOUND");

    let qrDataUrl: string | null = null;
    if (row.kind === "qr") {
      if (!row.qr_payload_ciphertext || !row.qr_payload_iv) {
        throw new QrContactError("No pudimos preparar la vista previa del QR.", 503, "QR_PREVIEW_UNAVAILABLE");
      }
      const payload = await decryptGlobalQrPayload(row.qr_payload_ciphertext, row.qr_payload_iv);
      const { default: QRCode } = await import("qrcode");
      qrDataUrl = await QRCode.toDataURL(payload, {
        width: 360,
        margin: 1,
        errorCorrectionLevel: "H",
        color: { dark: "#5c1b6d", light: "#ffffff" },
      });
    }

    return jsonOk({ entry: rowDto(row), qrDataUrl });
  } catch (error) {
    return routeError(error);
  }
}
