import { recipientLookupEnv } from "../config";
import { RecipientLookupError } from "../errors";
import { claroRecipientLookupProvider } from "./claro-provider";
import type { RecipientLookupProvider } from "../types";

const providers: Record<string, RecipientLookupProvider> = {
  claro: claroRecipientLookupProvider,
};

export function activeRecipientLookupProvider() {
  const name = recipientLookupEnv().RECIPIENT_LOOKUP_PROVIDER?.trim().toLowerCase() || "claro";
  const provider = providers[name];
  if (!provider) throw new RecipientLookupError("PROVIDER_UNAVAILABLE", "La consulta no está disponible.");
  return provider;
}
