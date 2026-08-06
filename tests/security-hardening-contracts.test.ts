import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const read = (rel: string) => readFileSync(path.join(projectRoot, rel), "utf8");

describe("security hardening contracts", () => {
  it("SEC-SESS-01: password change rotates the current session token", () => {
    const source = read("app/api/auth/password/change/route.ts");
    expect(source).toContain("rotateSessionToken");
    expect(source).toContain('"set-cookie": cookie');
    expect(source).toContain("DELETE FROM sessions WHERE user_id = ? AND id <> ?");
  });

  it("SEC-SESS-02: rotateSessionToken can clear unlock without keeping the old token", () => {
    const source = read("app/lib/auth-server.ts");
    expect(source).toContain("export async function rotateSessionToken");
    expect(source).toContain("unlock?: boolean");
    expect(source).toContain("SET token_hash = ?");
  });

  it("SEC-AUTHZ-01: non-owner cannot grant permanent VIP via admin PATCH", () => {
    const source = read("app/api/admin/users/[id]/route.ts");
    expect(source).toContain("requestedPermanent && actor.isOwner");
    expect(source).toContain("admin.user_permanent_denied");
  });

  it("SEC-AUTHZ-03: access route permanent is Owner-only", () => {
    const source = read("app/api/admin/users/[id]/access/route.ts");
    expect(source).toContain('mode === "permanent" && !admin.isOwner');
    expect(source).toContain("Solo el Owner puede otorgar acceso permanente.");
    expect(source).toContain("NON_OWNER_MAX_DAYS");
  });

  it("SEC-CRYPTO-01: token vault requires dedicated TOKEN_ENCRYPTION_SECRET", () => {
    const vault = read("app/lib/token-vault.ts");
    expect(vault).toContain("TOKEN_ENCRYPTION_SECRET");
    expect(vault).not.toContain("ADMIN_PROXY_SECRET");
    expect(vault).not.toContain("AUTH_RATE_LIMIT_PEPPER");
    expect(read("proxy.ts")).toContain("TOKEN_ENCRYPTION_SECRET");
  });

  it("SEC-CRYPTO-02: password pepper is optional and versioned for compatibility", () => {
    const source = read("app/lib/auth-server.ts");
    expect(source).toContain("AUTH_PASSWORD_PEPPER");
    expect(source).toContain("pbkdf2-sha256-p1");
    expect(source).toContain("materializePasswordSecret");
  });

  it("SEC-HEALTH-01: public health does not probe the database", () => {
    const source = read("app/api/health/route.ts");
    expect(source).toContain("liveness del proceso");
    expect(source).toContain("CRON_SECRET");
    expect(source).toContain("secureCompare");
  });

  it("SEC-RL-01: admin mutations enforce per-actor rate limits", () => {
    expect(read("app/api/admin/users/[id]/route.ts")).toContain("admin-user-patch");
    expect(read("app/api/admin/users/[id]/access/route.ts")).toContain("admin-user-access");
    expect(read("app/api/admin/users/[id]/permissions/route.ts")).toContain("admin-permissions-put");
    expect(read("app/api/admin/users/roles/route.ts")).toContain("admin-roles-mutate");
    expect(read("app/api/seller/password-resets/[id]/approve/route.ts")).toContain("password-reset-approve");
  });
});
