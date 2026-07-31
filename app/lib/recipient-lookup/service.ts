import { RecipientLookupError } from "./errors";
import { protectRecipientName } from "./name-masker";
import { normalizeRecipientPhone } from "./phone";
import { activeRecipientLookupProvider } from "./providers/registry";
import type { RecipientLookupResult } from "./types";

/**
 * Consulta un titular únicamente para sugerirlo en el formulario.
 * La respuesta no crea credenciales ni prueba la identidad del destinatario.
 */
export async function lookupRecipientPhone(input: {
  rawPhone: string;
  signal?: AbortSignal;
}): Promise<RecipientLookupResult> {
  const normalized = normalizeRecipientPhone(input.rawPhone);
  let providerResult;
  try {
    providerResult = await activeRecipientLookupProvider().lookupByPhone(
      normalized.local,
      input.signal,
    );
  } catch (error) {
    if (error instanceof RecipientLookupError) throw error;
    throw new RecipientLookupError("PROVIDER_UNAVAILABLE", "No pudimos consultar el destinatario.");
  }

  return {
    phone: normalized.local,
    displayName: protectRecipientName(providerResult.fullName),
  };
}
