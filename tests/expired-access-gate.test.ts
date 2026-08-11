import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("expired access and lifetime redeem flow", () => {
  it("keeps expired clients authenticated so the PIN gate can render", () => {
    const source = read("app/api/auth/me/route.ts");
    expect(source).toContain('getSessionUserIncludingExpired(request, ["client"])');
    expect(source).toContain("if (session)");
  });

  it("allows only the PIN recovery endpoints to read an expired session", () => {
    const auth = read("app/lib/auth-server.ts");
    expect(auth).toContain("requireSessionIncludingExpired");
    expect(read("app/api/auth/pin/verify/route.ts")).toContain("requireSessionIncludingExpired");
    expect(read("app/api/auth/pin/route.ts")).toContain("requireSessionIncludingExpired");
  });

  it("renders a non-dismissible access gate with permanent and redeem paths", () => {
    const source = read("app/components/BankApp.tsx");
    expect(source).toContain("Tu prueba de 30 días terminó");
    expect(source).toContain("Este aviso no se puede cerrar.");
    expect(source).toContain('role="dialog"');
    expect(source).toContain("/api/access/redeem");
    expect(source).toContain("Ya hice /redeem, comprobar acceso");
  });

  it("uses a lifetime limit of exactly three redemptions", () => {
    const auth = read("app/lib/auth-server.ts");
    const telegram = read("app/lib/telegram-manager.ts");
    const referral = read("app/api/account/referral/route.ts");
    expect(auth).toContain("REFERRAL_REDEMPTION_LIMIT = 3");
    expect(telegram).toContain("referral_redemption_count < ?");
    expect(telegram).toContain("pg_advisory_xact_lock");
    expect(referral).toContain("redemptionLimit: REFERRAL_REDEMPTION_LIMIT");
    expect(referral).toContain("SELECT COUNT(*) AS total FROM referral_redemptions WHERE referrer_user_id = ?");
    expect(referral).not.toContain("currentMonthKey");
  });

  it("updates the Supabase referral owner and records the redemption atomically", () => {
    const telegram = read("app/lib/telegram-manager.ts");
    const start = telegram.indexOf("WITH reserved AS");
    const end = telegram.indexOf("    : [", start);
    const supabaseStatement = telegram.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(supabaseStatement).toContain("access_expires_at = ?");
    expect(supabaseStatement).toContain("INSERT INTO referral_redemptions");
    expect(supabaseStatement).not.toContain("FROM inserted");
    expect(supabaseStatement).not.toContain("UPDATE users\n           SET access_expires_at");
  });

  it("allows each redeemer Telegram ID to redeem only once for its lifetime", () => {
    const telegram = read("app/lib/telegram-manager.ts");
    const auth = read("app/lib/auth-server.ts");
    const migration = read("supabase/migrations/20260807000000_referral_redeemer_lifetime.sql");

    expect(telegram).toContain("referral_redeemer_claims");
    expect(telegram).toContain("telegram_user_id = ?");
    expect(telegram).not.toContain("month_key = ?");
    expect((telegram.match(/pg_advisory_xact_lock/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(auth).toContain('"referral_redeemer_claims"');
    expect(migration).toContain("telegram_user_id text primary key");
    expect(migration).toContain("group by redeemer_telegram_user_id");
  });

});
