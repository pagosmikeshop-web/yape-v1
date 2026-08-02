import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("password reset approval flow", () => {
  it("creates a pending request without exposing a reset token", () => {
    const source = read("app/api/auth/password/reset/request/route.ts");
    expect(source).toContain("password_reset_requests");
    expect(source).toContain("pending: requestCreated");
    expect(source).not.toContain("resetToken: challenge.token");
  });

  it("requires approval before issuing the short-lived challenge", () => {
    const source = read("app/api/auth/password/reset/status/route.ts");
    expect(source).toContain('reset.status === "pending"');
    expect(source).toContain("issuePasswordResetChallenge");
  });

  it("keeps the approval endpoint server-authorized", () => {
    const source = read("app/api/seller/password-resets/[id]/approve/route.ts");
    expect(source).toContain("requireUnlockedSession");
    expect(source).toContain("status = 'approved'");
    expect(source).not.toContain("manager de Telegram");
  });

  it("does not render the legacy recovery-code field", () => {
    expect(read("app/components/AuthScreen.tsx")).not.toContain("id=\"recovery-code\"");
  });

  it("keeps the authenticated session when PIN inactivity locks the UI", () => {
    const source = read("app/lib/auth-server.ts");
    expect(source).toContain("DELETE FROM sessions WHERE token_hash = ? AND expires_at <= ?");
    expect(source).not.toContain("last_seen_at <= idleCutoff");
    expect(source).toContain("AUTH_UNLOCK_IDLE_MINUTES");
  });
});
