import { authEnv } from "@/app/lib/auth-server";

const REQUEST_TIMEOUT_MS = 30_000;

export type InfobipSmsErrorCode =
  | "not_configured"
  | "invalid_configuration"
  | "timeout"
  | "network"
  | "provider"
  | "invalid_response";

export class InfobipSmsError extends Error {
  constructor(readonly code: InfobipSmsErrorCode) {
    super("No se pudo entregar el SMS.");
    this.name = "InfobipSmsError";
  }
}

export type InfobipSmsConfig = {
  apiKey: string;
  baseUrl: string;
  sender: string;
};

export type InfobipSmsDelivery = {
  state: "pending" | "delivered" | "failed";
  providerStatus: string;
  failureCode: string | null;
};

export type InfobipSmsDeliveryReport = {
  messageId: string;
  callbackData: string;
  delivery: InfobipSmsDelivery;
};

export function infobipSmsConfig(): InfobipSmsConfig {
  const environment = authEnv();
  const apiKey = environment.INFOBIP_API_KEY?.trim() ?? "";
  const baseUrl = environment.INFOBIP_BASE_URL?.trim().replace(/\/+$/u, "") ?? "";
  const sender = environment.INFOBIP_SENDER?.trim() ?? "";
  if (!apiKey || !baseUrl || !sender) throw new InfobipSmsError("not_configured");

  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("invalid");
    }
  } catch {
    throw new InfobipSmsError("invalid_configuration");
  }
  if (sender.length > 30 || /[\u0000-\u001f\u007f]/u.test(sender)) {
    throw new InfobipSmsError("invalid_configuration");
  }
  return { apiKey, baseUrl, sender };
}

export function buildPaymentSmsText(input: {
  displayName: string;
  amountCents: number;
  securityCode: string;
}) {
  return `${input.displayName} te envio un pago por S/ ${(input.amountCents / 100).toFixed(2)}. El Cód. de seguridad es: ${input.securityCode}`;
}

function deliveryWebhookUrl() {
  const configured = authEnv().PUBLIC_APP_URL?.trim() ?? "";
  try {
    const publicUrl = new URL(configured);
    if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password) return null;
    return new URL("/api/internal/infobip-delivery", publicUrl).toString();
  } catch {
    return null;
  }
}

function providerMessageId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || !messages[0] || typeof messages[0] !== "object") return null;
  const messageId = (messages[0] as { messageId?: unknown }).messageId;
  return typeof messageId === "string" && messageId.length <= 256 ? messageId : null;
}

function deliveryStatus(value: unknown): InfobipSmsDelivery | null {
  if (!value || typeof value !== "object") return null;
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results) || !results[0] || typeof results[0] !== "object") return null;
  const status = (results[0] as { status?: unknown }).status;
  if (!status || typeof status !== "object") return null;
  const groupName = (status as { groupName?: unknown }).groupName;
  const name = (status as { name?: unknown }).name;
  const rawStatus = typeof groupName === "string" && groupName.trim()
    ? groupName.trim()
    : typeof name === "string" && name.trim()
      ? name.trim()
      : "UNKNOWN";
  const normalizedStatus = rawStatus.toUpperCase();
  if (normalizedStatus === "DELIVERED") {
    return { state: "delivered", providerStatus: rawStatus.slice(0, 64), failureCode: null };
  }
  if (normalizedStatus === "EXPIRED" || normalizedStatus === "REJECTED" || normalizedStatus === "UNDELIVERABLE") {
    return {
      state: "failed",
      providerStatus: rawStatus.slice(0, 64),
      failureCode: `delivery_${normalizedStatus.toLowerCase()}`.slice(0, 48),
    };
  }
  return { state: "pending", providerStatus: rawStatus.slice(0, 64), failureCode: null };
}

export function parseInfobipSmsDeliveryReports(value: unknown): InfobipSmsDeliveryReport[] {
  if (!value || typeof value !== "object") return [];
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((result) => {
    if (!result || typeof result !== "object") return [];
    const messageId = (result as { messageId?: unknown }).messageId;
    const callbackData = (result as { callbackData?: unknown }).callbackData;
    const delivery = deliveryStatus({ results: [result] });
    if (
      typeof messageId !== "string"
      || !messageId.trim()
      || messageId.length > 256
      || typeof callbackData !== "string"
      || callbackData.trim().length < 16
      || callbackData.length > 256
      || !delivery
    ) return [];
    return [{ messageId: messageId.trim(), callbackData: callbackData.trim(), delivery }];
  });
}

export async function getInfobipSmsDelivery(messageId: string): Promise<InfobipSmsDelivery | null> {
  const normalizedMessageId = messageId.trim();
  if (!normalizedMessageId || normalizedMessageId.length > 256) throw new InfobipSmsError("invalid_response");
  const config = infobipSmsConfig();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/sms/1/logs?messageId=${encodeURIComponent(normalizedMessageId)}`, {
      headers: {
        authorization: `App ${config.apiKey}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new InfobipSmsError("timeout");
    }
    throw new InfobipSmsError("network");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new InfobipSmsError("provider");
  return deliveryStatus(payload);
}

export async function sendInfobipSms(input: { to: string; text: string; deliveryCallbackData?: string }) {
  const config = infobipSmsConfig();
  const callbackData = input.deliveryCallbackData?.trim() ?? "";
  const webhookUrl = callbackData.length >= 16 && callbackData.length <= 256 ? deliveryWebhookUrl() : null;
  const message: Record<string, unknown> = {
    sender: config.sender,
    destinations: [{ to: input.to }],
    content: { text: input.text },
  };
  if (webhookUrl) {
    message.webhooks = {
      delivery: { url: webhookUrl },
      contentType: "application/json",
      callbackData,
    };
  }
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/sms/3/messages`, {
      method: "POST",
      headers: {
        authorization: `App ${config.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ messages: [message] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new InfobipSmsError("timeout");
    }
    throw new InfobipSmsError("network");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new InfobipSmsError("provider");
  const messageId = providerMessageId(payload);
  if (!messageId) throw new InfobipSmsError("invalid_response");
  return { messageId };
}
