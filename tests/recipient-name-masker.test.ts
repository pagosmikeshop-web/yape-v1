import { describe, expect, it } from "vitest";
import {
  maskRecipientName,
  tryMaskRecipientName,
} from "../app/lib/recipient-lookup/name-masker";

describe("nombres de destinatarios", () => {
  it("conserva las razones sociales con puntuación comercial", () => {
    expect(tryMaskRecipientName("Mentagge-peru S.a.c.")).toBe("Mentagge-peru S.a.c.");
    expect(tryMaskRecipientName("Comercial (Norte) & Sur S.R.L.")).toBe("Comercial (Norte) & Sur S.R.L.");
    expect(maskRecipientName("Inversiones 3M E.I.R.L.")).toBe("Inversiones 3M E.I.R.L.");
  });

  it("mantiene protegidos los nombres personales y rechaza símbolos inseguros", () => {
    expect(tryMaskRecipientName("Ana Perez")).toBe("Ana Per*");
    expect(tryMaskRecipientName("Empresa <prueba> S.A.C.")).toBe("");
  });
});
