import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InfobipSmsError,
  buildPaymentSmsText,
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
