import {
  normalizePaymentProvider,
  type PaymentProvider,
} from "./payment-providers";

export type RecipientProviderActions = {
  providers: PaymentProvider[];
  primaryProvider: PaymentProvider;
  directYapear: boolean;
  showOtherBanks: boolean;
  otherProviders: PaymentProvider[];
};

/**
 * Normaliza la lista de destinos configurados para un número y deja Yape
 * primero cuando existe. El botón principal usa el único proveedor configurado
 * o Yape cuando está disponible; los destinos alternativos se mantienen en
 * “Otros bancos”.
 */
export function normalizeRecipientProviders(
  value: unknown,
  fallback: PaymentProvider = "Yape",
) {
  const values = Array.isArray(value) ? value : [value];
  const providers: PaymentProvider[] = [];

  for (const item of values) {
    if (typeof item !== "string") continue;
    const provider = normalizePaymentProvider(item);
    if (!providers.includes(provider)) providers.push(provider);
  }

  if (providers.length === 0) providers.push(fallback);
  if (providers.includes("Yape")) {
    return ["Yape", ...providers.filter((provider) => provider !== "Yape")] as PaymentProvider[];
  }
  return providers;
}

export function getRecipientProviderActions(
  value: unknown,
  fromQr = false,
): RecipientProviderActions {
  const providers = normalizeRecipientProviders(value);
  const primaryProvider = providers[0];
  const otherProviders = providers.filter((provider) => provider !== "Yape");
  const hasYape = providers.includes("Yape");
  const isSingleProvider = providers.length === 1;

  return {
    providers,
    primaryProvider,
    // Un único proveedor puede procesarse directamente. Para QR mantenemos
    // también la acción directa cuando hay varios destinos no-Yape, usando el
    // proveedor principal y dejando los demás en “Otros bancos”.
    directYapear: hasYape || isSingleProvider || (fromQr && otherProviders.length > 0),
    // Keep the action available even when there is no alternate entity. The
    // entities screen explains the empty state instead of hiding the action.
    showOtherBanks: true,
    otherProviders,
  };
}
