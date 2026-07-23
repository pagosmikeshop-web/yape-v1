export const YAPE_QR_PROTOCOL = "yape:";
export const YAPE_QR_HOST = "pay";
const LEGACY_MI_BANCO_QR_PROTOCOL = "mi-banco:";
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function buildPaymentQrPayload(recipientId: string) {
  if (!UUID_PATTERN.test(recipientId)) throw new Error("Invalid Yape recipient identifier.");
  const payload = new URL(`${YAPE_QR_PROTOCOL}//${YAPE_QR_HOST}`);
  payload.searchParams.set("recipient", recipientId);
  return payload.toString();
}

export function parsePaymentQrPayload(rawValue: string) {
  try {
    const payload = new URL(rawValue.trim());
    const supportedProtocol = payload.protocol === YAPE_QR_PROTOCOL
      || payload.protocol === LEGACY_MI_BANCO_QR_PROTOCOL;
    if (!supportedProtocol || payload.hostname !== YAPE_QR_HOST) return "";
    const recipientId = payload.searchParams.get("recipient") ?? "";
    return UUID_PATTERN.test(recipientId) ? recipientId : "";
  } catch {
    return "";
  }
}
