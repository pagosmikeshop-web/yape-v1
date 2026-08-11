import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("owner account cleanup safeguards", () => {
  it("uses one shared cleanup batch and removes the account row", () => {
    const cleanup = read("app/lib/admin-user-cleanup.ts");
    expect(cleanup).toContain("DELETE FROM users");
    expect(cleanup).toContain("DELETE FROM telegram_group_members");
    expect(cleanup).not.toContain("SET seller_code = ?");
    expect(read("app/api/admin/users/[id]/route.ts")).toContain("buildFullUserDeletionStatements");
    expect(read("app/api/admin/users/[id]/ban/route.ts")).toContain("buildBanUserStatements");
  });

  it("makes owner disable/delete actions atomic with the selected data cleanup", () => {
    const source = read("app/api/admin/users/[id]/database/route.ts");
    expect(source).toContain('action === "disable"');
    expect(source).toContain('action === "delete"');
    expect(source).toContain("buildDisableUserStatements");
    expect(source).toContain("buildFullUserDeletionStatements");
  });

  it("does not calculate a seller's permissions with the owner's roles", () => {
    expect(read("app/api/admin/users/[id]/permissions/route.ts")).toContain("roles: [target.role]");
  });

  it("rate limits global QR publication independently of the business count", () => {
    const source = read("app/api/qr-directory/route.ts");
    expect(source).toContain('bucket: "global-qr-user"');
    expect(source).toContain('bucket: "global-qr-ip"');
  });
});
