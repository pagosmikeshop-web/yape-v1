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

function providerMessageId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || !messages[0] || typeof messages[0] !== "object") return null;
  const messageId = (messages[0] as { messageId?: unknown }).messageId;
  return typeof messageId === "string" && messageId.length <= 256 ? messageId : null;
}

export async function sendInfobipSms(input: { to: string; text: string }) {
  const config = infobipSmsConfig();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/sms/3/messages`, {
      method: "POST",
      headers: {
        authorization: `App ${config.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        messages: [{
          sender: config.sender,
          destinations: [{ to: input.to }],
          content: { text: input.text },
        }],
      }),
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
