import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authServer = readFileSync(path.join(root, "app", "lib", "auth-server.ts"), "utf8");
const roleRoute = readFileSync(path.join(root, "app", "api", "admin", "users", "roles", "route.ts"), "utf8");
const adminPage = readFileSync(path.join(root, "..", "yape-admin-web", "src", "pages", "StaffPage.tsx"), "utf8");

describe("dual-role account contracts", () => {
  it("stores roles separately and backfills existing accounts", () => {
    expect(authServer).toContain("CREATE TABLE IF NOT EXISTS user_roles");
    expect(authServer).toContain("INSERT OR IGNORE INTO user_roles");
    expect(authServer).toContain("export async function getUserRoles");
    expect(authServer).toContain("export async function revokeUserRole");
  });

  it("requires the owner permission and never accepts an arbitrary target role", () => {
    expect(roleRoute).toContain('requirePermission(actor, "roles:manage")');
    expect(roleRoute).toContain("target.role !== \"client\"");
    expect(roleRoute).toContain("telegram_user_id = ?");
    expect(roleRoute).toContain("export async function DELETE");
  });

  it("exposes the promotion action in the administrative panel", () => {
    expect(adminPage).toContain("Dar acceso al panel sin duplicar la cuenta");
    expect(adminPage).toContain("/api/admin/users/roles");
    expect(adminPage).toContain("Quitar acceso panel");
  });
});
