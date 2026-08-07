/**
 * Límites y utilidades para importes mostrados y guardados como centavos.
 *
 * Los valores persistidos usan enteros para evitar errores de redondeo. La
 * entrada visible acepta separadores de miles, pero siempre se normaliza
 * antes de enviarse al servidor.
 */
export const MAX_ACCOUNT_BALANCE_CENTS = 100_000_000;

const ACCOUNT_BALANCE_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAccountBalance(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0.00";
  return ACCOUNT_BALANCE_FORMATTER.format(value);
}

/** Normaliza la edición sin perder los separadores de miles. */
export function normalizeAccountBalanceInput(value: string): string {
  const safeValue = value.replace(/\s/gu, "").replace(/[^\d.,]/gu, "");
  if (!safeValue) return "";

  const withoutGrouping = safeValue.replace(/,/gu, "");
  const [integerPartRaw = "", ...decimalParts] = withoutGrouping.split(".");
  const integerPart = integerPartRaw.replace(/^0+(?=\d)/u, "") || "0";
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const decimals = decimalParts.join("").slice(0, 2);

  return decimalParts.length > 0
    ? `${groupedInteger}.${decimals}`
    : groupedInteger;
}

export function parseAccountBalanceCents(value: string): number | null {
  const normalized = value.trim().replace(/\s/gu, "").replace(/,/gu, "");
  if (!/^\d+(?:\.\d{0,2})?$/u.test(normalized)) return null;

  const [wholePart, decimalPart = ""] = normalized.split(".");
  const whole = Number(wholePart);
  if (!Number.isSafeInteger(whole) || whole > Number.MAX_SAFE_INTEGER / 100) {
    return null;
  }

  const cents = whole * 100 + Number(decimalPart.padEnd(2, "0") || 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function isValidAccountBalanceCents(
  value: number | null,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_ACCOUNT_BALANCE_CENTS
  );
}
