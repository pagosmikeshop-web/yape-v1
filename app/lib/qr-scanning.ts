export const QR_SCAN_MAX_BYTES = 2_048;
export const QR_SCAN_MIN_BYTES = 4;

/** Normaliza el texto decodificado sin interpretar ni ejecutar su contenido. */
export function normalizeQrPayload(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().normalize("NFKC");
  const bytes = new TextEncoder().encode(normalized).byteLength;
  if (
    bytes < QR_SCAN_MIN_BYTES
    || bytes > QR_SCAN_MAX_BYTES
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) return "";
  return normalized;
}
