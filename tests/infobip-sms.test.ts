import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InfobipSmsError,
  buildPaymentSmsText,
  getInfobipSmsDelivery,
  parseInfobipSmsDeliveryReports,
  sendInfobipSms,
} from "../app/lib/infobip-sms";
import {
  createSmsCreditToken,
  isSmsCreditToken,
  normalizeSmsCreditToken,
} from "../app/lib/sms-credit-tokens";

type TestGlobals = typeof globalThis & {
  __YAPE_ENV?: Record<string, string | undefined>;
};

function setEnvironment(values: Record<string, string | undefined>) {
  (globalThis as TestGlobals).__YAPE_ENV = values;
}

function infobipEnvironment(...parts: string[]) {
  return parts.join("_");
}

afterEach(() => {
  delete (globalThis as TestGlobals).__YAPE_ENV;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SMS transaccional Infobip", () => {
  it("forma el texto con monto fijo a dos decimales y código de seguridad", () => {
    expect(buildPaymentSmsText({
      displayName: "Jhon Tas*",
      amountCents: 8_030,
      securityCode: "254",
    })).toBe("Jhon Tas* te envio un pago por S/ 80.30. El Cód. de seguridad es: 254");
  });

  it("llama al endpoint de Infobip sin convertir el nombre del cuerpo en remitente", async () => {
    setEnvironment({
      [infobipEnvironment("INFOBIP", "API", "KEY")]: ["test", "api", "key"].join("-"),
      [infobipEnvironment("INFOBIP", "BASE", "URL")]: "https://example.infobip.test",
      [infobipEnvironment("INFOBIP", "SENDER")]: "BancoWeb",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      messages: [{ messageId: "message-123" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendInfobipSms({
      to: "+51900000000",
      text: "Jhon Tas* te envio un pago por S/ 80.30. El Cód. de seguridad es: 254",
    })).resolves.toEqual({ messageId: "message-123" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.infobip.test/sms/3/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: `App ${["test", "api", "key"].join("-")}` }),
        body: JSON.stringify({
          messages: [{
            sender: "BancoWeb",
            destinations: [{ to: "+51900000000" }],
            content: { text: "Jhon Tas* te envio un pago por S/ 80.30. El Cód. de seguridad es: 254" },
          }],
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("falla de forma segura cuando faltan credenciales", async () => {
    setEnvironment({
      [infobipEnvironment("INFOBIP", "BASE", "URL")]: "https://example.infobip.test",
      [infobipEnvironment("INFOBIP", "SENDER")]: "BancoWeb",
    });
    await expect(sendInfobipSms({ to: "+51900000000", text: "Mensaje" }))
      .rejects.toMatchObject({ code: "not_configured" } satisfies Partial<InfobipSmsError>);
  });

  it("clasifica EXPIRED como fallo final sin exponer la respuesta completa del proveedor", async () => {
    setEnvironment({
      [infobipEnvironment("INFOBIP", "API", "KEY")]: "test-api-key",
      [infobipEnvironment("INFOBIP", "BASE", "URL")]: "https://example.infobip.test",
      [infobipEnvironment("INFOBIP", "SENDER")]: "BancoWeb",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ status: { groupName: "EXPIRED", name: "EXPIRED_EXPIRED" } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getInfobipSmsDelivery("message-123")).resolves.toEqual({
      state: "failed",
      providerStatus: "EXPIRED",
      failureCode: "delivery_expired",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.infobip.test/sms/1/logs?messageId=message-123",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "App test-api-key" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("incluye un nonce por SMS para que el webhook no acepte eventos inventados", async () => {
    setEnvironment({
      [infobipEnvironment("INFOBIP", "API", "KEY")]: "test-api-key",
      [infobipEnvironment("INFOBIP", "BASE", "URL")]: "https://example.infobip.test",
      [infobipEnvironment("INFOBIP", "SENDER")]: "BancoWeb",
      PUBLIC_APP_URL: "https://yape-v1.vercel.app",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      messages: [{ messageId: "message-123" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await sendInfobipSms({
      to: "+51900000000",
      text: "Mensaje",
      deliveryCallbackData: "1d11d977-e8f1-42aa-bd08-bf5530bf0e08",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.infobip.test/sms/3/messages",
      expect.objectContaining({
        body: JSON.stringify({
          messages: [{
            sender: "BancoWeb",
            destinations: [{ to: "+51900000000" }],
            content: { text: "Mensaje" },
            webhooks: {
              delivery: { url: "https://yape-v1.vercel.app/api/internal/infobip-delivery" },
              contentType: "application/json",
              callbackData: "1d11d977-e8f1-42aa-bd08-bf5530bf0e08",
            },
          }],
        }),
      }),
    );
  });

  it("solo procesa webhooks con messageId, callbackData y estado válidos", () => {
    expect(parseInfobipSmsDeliveryReports({
      results: [{
        messageId: "message-123",
        callbackData: "1d11d977-e8f1-42aa-bd08-bf5530bf0e08",
        status: { groupName: "DELIVERED", name: "DELIVERED_TO_HANDSET" },
      }],
    })).toEqual([{
      messageId: "message-123",
      callbackData: "1d11d977-e8f1-42aa-bd08-bf5530bf0e08",
      delivery: { state: "delivered", providerStatus: "DELIVERED", failureCode: null },
    }]);
    expect(parseInfobipSmsDeliveryReports({ results: [{ messageId: "message-123" }] })).toEqual([]);
  });
});

describe("tokens de créditos SMS", () => {
  it("genera un token con formato estable sin aceptar valores ajenos", () => {
    const token = createSmsCreditToken(5);
    expect(token.credits).toBe(5);
    expect(isSmsCreditToken(token.formatted)).toBe(true);
    expect(normalizeSmsCreditToken(token.formatted)).toMatch(/^SMS[A-Z0-9]{16}$/u);
    expect(isSmsCreditToken("AUTO-1111-1111-1111-1111")).toBe(false);
  });
});
