export const PAYMENT_PROVIDERS = [
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

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/** Proveedores que se pueden seleccionar al registrar un código QR. */
export const QR_PROVIDERS = PAYMENT_PROVIDERS;
export type QrProvider = PaymentProvider;

/**
 * Providers available when a user creates a new free autocomplete record.
 * Izipay remains part of the canonical list so existing records and legacy
 * transfer payloads continue to resolve correctly, but it is no longer
 * offered for new registrations.
 */
export const AUTOCOMPLETE_PROVIDERS = PAYMENT_PROVIDERS.filter(
  (provider) => provider !== "Izipay",
) as Exclude<PaymentProvider, "Izipay">[];

export type AutocompleteProvider = (typeof AUTOCOMPLETE_PROVIDERS)[number];

export function normalizePaymentProvider(value: unknown): PaymentProvider {
  if (typeof value !== "string") return "Yape";
  const normalized = value.trim().toLocaleLowerCase("es-PE");
  return PAYMENT_PROVIDERS.find(
    (provider) => provider.toLocaleLowerCase("es-PE") === normalized,
  ) ?? "Yape";
}
