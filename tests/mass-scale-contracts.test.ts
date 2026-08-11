import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("mass-scale hardening", () => {
  it("keeps the Supabase pool bounded and queries time-limited", () => {
    const source = read("app/lib/database-server.ts");
    expect(source).toContain("max: 8");
    expect(source).toContain("statement_timeout: 8_000");
    expect(source).toContain("max_lifetime: 600");
  });

  it("protects scheduled retention with a server-only secret", () => {
    const source = read("app/api/internal/retention/route.ts");
    expect(source).toContain("CRON_SECRET");
    expect(source).toContain("yape_operational_retention");
    expect(source).toContain('status: 401');
  });

  it("configures a Vercel cron instead of request-time cleanup", () => {
    const source = read("vercel.json");
    expect(source).toContain('"crons"');
    expect(source).toContain("/api/internal/retention");
  });

  it("supports distributed rate limits without losing the database fallback", () => {
    const source = read("app/lib/auth-server.ts");
    expect(source).toContain("RATE_LIMIT_REDIS_URL");
    expect(source).toContain('"EVAL"');
    expect(source).toContain("fallback seguro");
  });
});
