import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const accountDetailsSource = readFileSync(
  path.join(projectRoot, "app", "components", "BankApp.tsx"),
  "utf8",
);

describe("account details surface contract", () => {
  it("keeps removed email and registration blocks out of the account screen", () => {
    expect(accountDetailsSource).not.toContain("Constancias a correo");
    expect(accountDetailsSource).not.toContain("Seguridad de acceso");
    expect(accountDetailsSource).not.toContain("Correo de recuperación");
    expect(accountDetailsSource).not.toContain("Registrar datos");
    expect(accountDetailsSource).not.toContain("account-details-submit");
  });

  it("keeps the useful account sections visible", () => {
    expect(accountDetailsSource).toContain("Autocompletado");
    expect(accountDetailsSource).toContain("Mis credenciales");
  });
});
