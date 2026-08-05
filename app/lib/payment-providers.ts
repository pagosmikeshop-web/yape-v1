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

export function normalizePaymentProvider(value: unknown): PaymentProvider {
  if (typeof value !== "string") return "Yape";
  const normalized = value.trim().toLocaleLowerCase("es-PE");
  return PAYMENT_PROVIDERS.find(
    (provider) => provider.toLocaleLowerCase("es-PE") === normalized,
  ) ?? "Yape";
}
