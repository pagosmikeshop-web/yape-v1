import { dbBinding } from "@/app/lib/auth-server";
import type { PaymentProvider } from "@/app/lib/payment-providers";

export const GLOBAL_DIRECTORY_TERMS_VERSION = "global-recipient-v1";

export class GlobalDirectoryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "GLOBAL_DIRECTORY_INVALID",
  ) {
    super(message);
    this.name = "GlobalDirectoryError";
  }
}

export type GlobalRecipientLookup = {
  displayName: string;
  provider: PaymentProvider;
  providers: PaymentProvider[];
  source: "manual" | "qr";
};

export function requireGlobalDirectoryTerms(
  accepted: unknown,
  version: unknown,
) {
  if (accepted !== true || version !== GLOBAL_DIRECTORY_TERMS_VERSION) {
    throw new GlobalDirectoryError(
      "Debes aceptar los términos antes de publicar un dato global.",
      400,
      "TERMS_REQUIRED",
    );
  }
}

/**
 * Busca solamente entradas activas publicadas globalmente. El nombre ya se
 * guarda protegido por el endpoint de alta; nunca se devuelve un nombre crudo.
 */
export async function lookupGlobalRecipient(phoneE164: string) {
  const database = dbBinding();
  const directory = await database.prepare(
    `SELECT display_name, provider, 'manual' AS source
     FROM global_recipient_directory
     WHERE phone_e164 = ? AND status = 'active'
     ORDER BY CASE WHEN provider = 'Yape' THEN 0 ELSE 1 END,
              updated_at DESC, id DESC`,
  ).bind(phoneE164).all<{
    display_name: string;
    provider: PaymentProvider;
    source: "manual";
  }>();
  const directoryRows = directory.results ?? [];
  if (directoryRows.length > 0) {
    const primary = directoryRows[0];
    return {
      displayName: primary.display_name,
      provider: primary.provider,
      providers: directoryRows.map((row) => row.provider),
      source: "manual",
    } satisfies GlobalRecipientLookup;
  }

  const qr = await database.prepare(
    `SELECT holder_name AS display_name, provider, 'qr' AS source
     FROM global_qr_directory
     WHERE phone_e164 = ? AND status = 'active'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  ).bind(phoneE164).first<{
    display_name: string;
    provider: PaymentProvider;
    source: "qr";
  }>();
  return qr
    ? {
      displayName: qr.display_name,
      provider: qr.provider,
      providers: [qr.provider],
      source: "qr",
      } satisfies GlobalRecipientLookup
    : null;
}
