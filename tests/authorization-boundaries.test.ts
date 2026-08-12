import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const readSource = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("límites de autorización para rutas sensibles", () => {
  it("vincula una transferencia a una sesión desbloqueada, su usuario e idempotencia", () => {
    const source = readSource("app/api/payments/transfer/route.ts");
    expect(source).toContain('requireUnlockedSession(request, ["admin", "seller", "client"])');
    expect(source).toContain('WHERE user_id = ? AND idempotency_key = ?');
    expect(source).toContain('bucket: "transfer-user"');
    expect(source).toContain('bucket: "transfer-ip"');
  });

  it("impide eliminar destinatarios globales de otros usuarios", () => {
    const source = readSource("app/api/account/recipient-contacts/[id]/route.ts");
    expect(source).toContain("assertSameOriginMutation(request, false)");
    expect(source).toContain('WHERE id = ? AND submitted_by_user_id = ?');
    expect(source).toContain(").bind(id, user.id)");
  });

  it("exige ámbito administrativo, cuenta gestionable y permiso granular al modificar usuarios", () => {
    const source = readSource("app/api/admin/users/[id]/route.ts");
    expect(source).toContain('requireUnlockedSession(request, ["admin"])');
    expect(source).toContain("await requireManagedAccount(actor, id)");
    expect(source).toContain("await requirePermission(");
  });

  it("restringe la gestión de clientes a los roles y permisos permitidos", () => {
    const source = readSource("app/api/seller/clients/route.ts");
    expect(source).toContain('requireUnlockedSession(request, ["seller", "admin"])');
    expect(source).toContain('requirePermission(actor, "clients:view")');
    expect(source).toContain('requirePermission(actor, "clients:create")');
  });
});
