import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requestIpRateLimitSubject,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import { assertSameOriginMutation } from "@/app/lib/qr-contact-server";
import {
  GlobalDirectoryError,
  GLOBAL_DIRECTORY_TERMS_VERSION,
  requireGlobalDirectoryTerms,
} from "@/app/lib/global-recipient-directory";
import { RecipientLookupError } from "@/app/lib/recipient-lookup/errors";
import { tryMaskRecipientName } from "@/app/lib/recipient-lookup/name-masker";
import { normalizeRecipientPhone } from "@/app/lib/recipient-lookup/phone";

export const dynamic = "force-dynamic";

type GlobalRecipientRow = {
  id: string;
  phone_e164: string;
  display_name: string;
  source: "manual" | "qr";
  status: "active" | "revoked";
  updated_at: string;
};

function contactDto(row: GlobalRecipientRow) {
  return {
    id: row.id,
    phone: row.phone_e164,
    displayName: row.display_name,
    source: row.source,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

async function enforceContactLimits(userId: string, request: Request) {
  await enforceAuthRateLimits([
    {
      bucket: "global-recipient-user",
      subject: userId,
      limit: 30,
      windowSeconds: 60 * 60,
    },
    {
      bucket: "global-recipient-ip",
      subject: await requestIpRateLimitSubject(request),
      limit: 90,
      windowSeconds: 60 * 60,
    },
  ]);
}

export async function GET(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin", "seller", "client"]);
    const rows = await dbBinding().prepare(
      `SELECT id, phone_e164, display_name, source, status, updated_at
       FROM global_recipient_directory
       WHERE submitted_by_user_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 500`,
    ).bind(user.id).all<GlobalRecipientRow>();
    return jsonOk({ contacts: (rows.results ?? []).map(contactDto), termsVersion: GLOBAL_DIRECTORY_TERMS_VERSION });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginMutation(request, true);
    const { user } = await requireUnlockedSession(request, ["admin", "seller", "client"]);
    await enforceContactLimits(user.id, request);
    const body = await readJson(request);
    if (Object.keys(body).some((key) => !["phone", "name", "termsAccepted", "termsVersion"].includes(key))) {
      return jsonError("La solicitud contiene campos no permitidos.", 400);
    }
    requireGlobalDirectoryTerms(body.termsAccepted, body.termsVersion);

    const normalized = normalizeRecipientPhone(asString(body.phone));
    const displayName = tryMaskRecipientName(asString(body.name));
    if (!displayName) return jsonError("Ingresa un nombre válido para el destinatario.", 400);

    const database = dbBinding();
    const now = new Date().toISOString();
    const existing = await database.prepare(
      `SELECT id, submitted_by_user_id, display_name, status
       FROM global_recipient_directory
       WHERE phone_e164 = ?
       LIMIT 1`,
    ).bind(normalized.e164).first<{
      id: string;
      submitted_by_user_id: string;
      display_name: string;
      status: "active" | "revoked";
    }>();

    if (existing && existing.submitted_by_user_id !== user.id) {
      return jsonError("Este celular ya tiene un destinatario publicado globalmente. Solicita una revisión si el dato es incorrecto.", 409);
    }

    const id = existing?.id ?? crypto.randomUUID();
    const contact = await database.prepare(
      existing
        ? `UPDATE global_recipient_directory
           SET display_name = ?, source = 'manual', terms_version = ?, terms_accepted_at = ?,
               status = 'active', revoked_at = NULL, revoked_reason = NULL, updated_at = ?
           WHERE id = ? AND submitted_by_user_id = ?
           RETURNING id, phone_e164, display_name, source, status, updated_at`
        : `INSERT INTO global_recipient_directory (
             id, phone_e164, display_name, source, submitted_by_user_id,
             terms_version, terms_accepted_at, status, created_at, updated_at
           ) VALUES (?, ?, ?, 'manual', ?, ?, ?, 'active', ?, ?)
           RETURNING id, phone_e164, display_name, source, status, updated_at`,
    ).bind(
      ...(existing
        ? [displayName, GLOBAL_DIRECTORY_TERMS_VERSION, now, now, existing.id, user.id]
        : [id, normalized.e164, displayName, user.id, GLOBAL_DIRECTORY_TERMS_VERSION, now, now, now]),
    ).first<GlobalRecipientRow>();

    if (!contact) return jsonError("No pudimos publicar el destinatario.", 503);
    return jsonOk({ contact: contactDto(contact), termsVersion: GLOBAL_DIRECTORY_TERMS_VERSION }, { status: 201 });
  } catch (error) {
    if (error instanceof RecipientLookupError || error instanceof GlobalDirectoryError) {
      return jsonError(error.message, error instanceof GlobalDirectoryError ? error.status : 400);
    }
    return routeError(error);
  }
}
