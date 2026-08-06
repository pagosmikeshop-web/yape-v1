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
 * primero cuando existe. Así el botón principal siempre representa Yape.
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
  const isOnlyPlin = providers.length === 1 && providers[0] === "Plin";

  return {
    providers,
    primaryProvider,
    directYapear: hasYape || isOnlyPlin || (fromQr && otherProviders.length > 0),
    showOtherBanks:
      (fromQr && otherProviders.length > 0) ||
      (otherProviders.length > 0 &&
        (hasYape || otherProviders.length > 1 || otherProviders[0] !== "Plin")),
    otherProviders,
  };
}
