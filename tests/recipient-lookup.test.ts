import { afterEach, describe, expect, it, vi } from "vitest";
import { RecipientLookupError } from "../app/lib/recipient-lookup/errors";
import { normalizePaymentProvider } from "../app/lib/payment-providers";
import { getRecipientProviderActions } from "../app/lib/recipient-providers";
import {
  protectRecipientName,
  tryMaskRecipientName,
} from "../app/lib/recipient-lookup/name-masker";
import { normalizeRecipientPhone } from "../app/lib/recipient-lookup/phone";
import { parseClaroRecipientResponse } from "../app/lib/recipient-lookup/providers/claro-provider";
import { claroRecipientLookupProvider } from "../app/lib/recipient-lookup/providers/claro-provider";

afterEach(() => vi.unstubAllGlobals());

describe("lookup seguro de destinatarios", () => {
  it("normaliza solamente celulares peruanos", () => {
    expect(normalizeRecipientPhone("+51 996 111 333")).toEqual({
      e164: "+51996111333",
      local: "996111333",
    });
    expect(() => normalizeRecipientPhone("12345678")).toThrowError(RecipientLookupError);
  });

  it("mantiene el proveedor configurado para el destino", () => {
    expect(normalizePaymentProvider("plin")).toBe("Plin");
    expect(normalizePaymentProvider("Banco Falabella")).toBe("Banco Falabella");
    expect(normalizePaymentProvider("proveedor-desconocido")).toBe("Yape");
  });

  it("prioriza Yape y deja Plin para Otros bancos cuando ambos están configurados", () => {
    const actions = getRecipientProviderActions(["Plin", "Yape"]);

    expect(actions.providers).toEqual(["Yape", "Plin"]);
    expect(actions.primaryProvider).toBe("Yape");
    expect(actions.directYapear).toBe(true);
    expect(actions.showOtherBanks).toBe(true);
    expect(actions.otherProviders).toEqual(["Plin"]);
  });

  it("permite Plin directo cuando es el único proveedor Free", () => {
    const actions = getRecipientProviderActions(["Plin"]);

    expect(actions.directYapear).toBe(true);
    expect(actions.showOtherBanks).toBe(true);
    expect(actions.primaryProvider).toBe("Plin");
  });

  it("mantiene Otros bancos visible cuando solo existe Yape", () => {
    const actions = getRecipientProviderActions(["Yape"]);

    expect(actions.directYapear).toBe(true);
    expect(actions.showOtherBanks).toBe(true);
    expect(actions.primaryProvider).toBe("Yape");
  });

  it("mantiene un banco distinto en Otros bancos si no existe Yape", () => {
    const actions = getRecipientProviderActions(["Banco Falabella"]);

    expect(actions.directYapear).toBe(false);
    expect(actions.showOtherBanks).toBe(true);
    expect(actions.otherProviders).toEqual(["Banco Falabella"]);
  });

  it.each([
    ["ANGEL MIGUEL SALVADOR RUIZ", "Angel Sal*"],
    ["ÁNGEL MIGUEL SALVADOR RUIZ", "Ángel Sal*"],
    ["LAURA FRANCISCA QUISPE LEON", "Laura Qui*"],
    ["Juan Pérez", "Juan Pér*"],
    ["Li Wu", "Li Wu*"],
  ])("protege %s como %s", (fullName, expected) => {
    expect(protectRecipientName(fullName)).toBe(expected);
  });

  it("rechaza titulares vacíos, numéricos o con HTML", () => {
    expect(() => protectRecipientName("")).toThrowError(RecipientLookupError);
    expect(() => protectRecipientName("12345")).toThrowError(RecipientLookupError);
    expect(() => protectRecipientName("<script>alert(1)</script>")).toThrowError(RecipientLookupError);
  });

  it("extrae únicamente data[0].titular.nombre de la respuesta real", () => {
    const result = parseClaroRecipientResponse({
      success: true,
      tipo_busqueda: "CELULAR",
      total_registros: 1,
      data: [{
        titular: { nombre: "LAURA FRANCISCA QUISPE LEON", documento: "02150643" },
        informacion_adicional: { correo: "privado@example.test" },
      }],
      creditos_diarios_restantes: 995,
    });
    expect(result).toEqual({ fullName: "LAURA FRANCISCA QUISPE LEON" });
  });

  it("protege un nombre manual y devuelve vacío para una entrada inválida", () => {
    expect(tryMaskRecipientName("Laura Quispe")).toBe("Laura Qui*");
    expect(tryMaskRecipientName("Laura Qui*")).toBe("Laura Qui*");
    expect(tryMaskRecipientName("<script>alert(1)</script>")).toBe("");
  });

  it("construye la consulta del proveedor con el celular y el token del servidor", async () => {
    const globals = globalThis as typeof globalThis & {
      __YAPE_ENV?: Record<string, string>;
    };
    const previous = globals.__YAPE_ENV;
    const providerTokenField = ["RECIPIENT", "LOOKUP", "API", "TOKEN"].join("_");
    globals.__YAPE_ENV = {
      RECIPIENT_LOOKUP_API_BASE_URL: "https://api.anubisbot2.xyz/api/v1/claro",
      [providerTokenField]: "fixture-value",
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: [{ titular: { nombre: "LAURA FRANCISCA QUISPE LEON" } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await claroRecipientLookupProvider.lookupByPhone("996111333");
      const [request] = fetchMock.mock.calls[0] as [URL, RequestInit];
      expect(request.pathname).toBe("/api/v1/claro/996111333");
      expect(request.searchParams.get("token")).toBe("fixture-value");
    } finally {
      globals.__YAPE_ENV = previous;
    }
  });

  it("trata success:false y éxito sin nombre como no válidos", () => {
    expect(() => parseClaroRecipientResponse({
      success: false,
      message: "Formato inválido",
      creditos_diarios_restantes: 489,
    })).toThrowError(RecipientLookupError);
    expect(() => parseClaroRecipientResponse({
      success: true,
      data: [{ titular: {} }],
    })).toThrowError(RecipientLookupError);
  });

});
