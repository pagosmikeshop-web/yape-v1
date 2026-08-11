import { describe, expect, it } from "vitest";
import {
  AUTOCOMPLETE_PROVIDERS,
  QR_PROVIDERS,
} from "../app/lib/payment-providers";
import { getRecipientProviderActions } from "../app/lib/recipient-providers";
import {
  maskRecipientName,
  validateRecipientDisplayName,
} from "../app/lib/recipient-lookup/name-masker";

describe("proveedores de registros", () => {
  it("ofrece Izipay para QR, pero no para autocompletado de celular", () => {
    expect(QR_PROVIDERS).toContain("Izipay");
    expect(AUTOCOMPLETE_PROVIDERS).not.toContain("Izipay");
  });
});

describe("acciones de proveedores del destinatario", () => {
  it("permite pagar directamente con el único proveedor alternativo", () => {
    const actions = getRecipientProviderActions(["Plin"]);

    expect(actions.primaryProvider).toBe("Plin");
    expect(actions.directYapear).toBe(true);
    expect(actions.showOtherBanks).toBe(true);
    expect(actions.otherProviders).toEqual(["Plin"]);
  });

  it("mantiene el pago directo del QR con varios destinos no-Yape", () => {
    const actions = getRecipientProviderActions(["Plin", "Interbank"], true);

    expect(actions.primaryProvider).toBe("Plin");
    expect(actions.directYapear).toBe(true);
    expect(actions.showOtherBanks).toBe(true);
    expect(actions.otherProviders).toEqual(["Plin", "Interbank"]);
  });

  it("mantiene Yape y Otros bancos cuando ambos destinos existen", () => {
    const actions = getRecipientProviderActions(["Yape", "Plin"]);

    expect(actions.directYapear).toBe(true);
    expect(actions.showOtherBanks).toBe(true);
    expect(actions.primaryProvider).toBe("Yape");
    expect(actions.otherProviders).toEqual(["Plin"]);
  });

  it("prioriza Yape aunque se configure después del proveedor alternativo", () => {
    const actions = getRecipientProviderActions(["Plin", "Yape"]);

    expect(actions.providers).toEqual(["Yape", "Plin"]);
    expect(actions.primaryProvider).toBe("Yape");
    expect(actions.directYapear).toBe(true);
    expect(actions.otherProviders).toEqual(["Plin"]);
  });

  it("conserva únicamente los proveedores configurados y elimina duplicados", () => {
    const actions = getRecipientProviderActions(["Plin", "plin", "Interbank"]);

    expect(actions.providers).toEqual(["Plin", "Interbank"]);
    expect(actions.primaryProvider).toBe("Plin");
    expect(actions.otherProviders).toEqual(["Plin", "Interbank"]);
  });

  it("mantiene Otros bancos cuando solo existe Yape", () => {
    const actions = getRecipientProviderActions(["Yape"]);

    expect(actions.directYapear).toBe(true);
    expect(actions.showOtherBanks).toBe(true);
  });

  it("mantiene Otros bancos cuando no hay proveedores configurados", () => {
    const actions = getRecipientProviderActions([]);

    expect(actions.directYapear).toBe(true);
    expect(actions.showOtherBanks).toBe(true);
  });
});

describe("nombre visible de registros", () => {
  it("conserva el formato que escribe el usuario", () => {
    expect(validateRecipientDisplayName("  Laura   Qui* ")).toBe("Laura Qui*");
    expect(validateRecipientDisplayName("Angel Miguel Salvador Ruiz")).toBe(
      "Angel Miguel Salvador Ruiz",
    );
  });

  it("rechaza valores vacíos o con controles", () => {
    expect(validateRecipientDisplayName(" ")).toBe("");
    expect(validateRecipientDisplayName("A\nB")).toBe("");
  });

  it("conserva nombres protegidos con el asterisco en medio", () => {
    expect(maskRecipientName("Izi*Butri")).toBe("Izi*Butri");
    expect(maskRecipientName("Alex San*")).toBe("Alex San*");
  });

  it("no acepta valores con varios asteriscos como nombres protegidos", () => {
    expect(maskRecipientName("Izi**Butri")).toBe("");
  });
});
