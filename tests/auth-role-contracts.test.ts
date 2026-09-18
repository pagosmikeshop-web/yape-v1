import { describe, expect, it } from "vitest";
import {
  normalizeSellerCode,
  normalizeUsername,
  userHasRole,
  validateUsername,
} from "../app/lib/auth-server";

describe("contratos de identidad y roles", () => {
  it("normaliza los identificadores de acceso de forma estable", () => {
    expect(normalizeUsername("  Ána.SOTO  ")).toBe("ána.soto");
    expect(normalizeSellerCode("  yape-01  ")).toBe("YAPE-01");
  });

  it("no acepta espacios en el nombre de usuario", () => {
    expect(validateUsername("cuenta nueva")).toBe(false);
    expect(validateUsername("cuenta-nueva_01")).toBe(true);
  });

  it("autoriza el rol principal y los roles adicionales explícitos", () => {
    const user: { role: "seller"; roles: Array<"seller" | "client"> } = {
      role: "seller",
      roles: ["seller", "client"],
    };

    expect(userHasRole(user, "seller")).toBe(true);
    expect(userHasRole(user, "client")).toBe(true);
    expect(userHasRole(user, "admin")).toBe(false);
  });

  it("no concede roles ausentes cuando no hay roles adicionales", () => {
    const user = { role: "client" as const };

    expect(userHasRole(user, "client")).toBe(true);
    expect(userHasRole(user, "seller")).toBe(false);
    expect(userHasRole(user, "admin")).toBe(false);
  });
});
