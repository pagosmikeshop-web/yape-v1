import { describe, expect, it } from "vitest";
import { safeApiMessage, safeClientMessage } from "../app/lib/client-error";

describe("mensajes visibles al cliente", () => {
  it("conserva mensajes funcionales de la API", () => {
    expect(safeApiMessage("Saldo insuficiente", "No se pudo completar la operación.")).toBe("Saldo insuficiente");
  });

  it("oculta detalles técnicos del navegador o del servidor", () => {
    expect(safeClientMessage(new TypeError("Cannot read properties of undefined"), "No se pudo completar la operación.")).toBe(
      "No se pudo completar la operación.",
    );
    expect(safeApiMessage("SQLITE_CONSTRAINT: database is locked", "No se pudo guardar la información.")).toBe(
      "No se pudo guardar la información.",
    );
  });

  it("usa el fallback para errores vacíos o excesivamente largos", () => {
    const fallback = "Inténtalo nuevamente.";
    expect(safeClientMessage("", fallback)).toBe(fallback);
    expect(safeClientMessage("x".repeat(181), fallback)).toBe(fallback);
  });
});
