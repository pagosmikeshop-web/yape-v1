import { describe, expect, it } from "vitest";
import {
  formatAutocompleteKey,
  isAutocompleteKey,
  normalizeAutocompleteKey,
} from "../app/lib/autocomplete-credits";

describe("claves globales de autocompletado", () => {
  it("normaliza separadores y mayúsculas sin cambiar el valor lógico", () => {
    expect(normalizeAutocompleteKey(" auto-abcd-efgh-ijkl-mnop ")).toBe(
      "AUTOABCDEFGH IJKLMNOP".replace(" ", ""),
    );
  });

  it("valida únicamente el formato emitido por el panel", () => {
    expect(isAutocompleteKey("AUTO-ABCD-EFGH-IJKL-MNOP")).toBe(true);
    expect(isAutocompleteKey("AUTO-ABCD-EFGH-IJKL-MNOP-QRST")).toBe(false);
    expect(isAutocompleteKey("YAPE-ABCD-EFGH-IJKL-MNOP")).toBe(false);
  });

  it("formatea una key cruda en grupos legibles", () => {
    expect(formatAutocompleteKey("AUTOABCDEFGHIJKLMNOP")).toBe(
      "AUTO-ABCD-EFGH-IJKL-MNOP",
    );
  });
});
