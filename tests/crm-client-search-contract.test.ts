import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientsRoute = readFileSync(path.join(root, "app", "api", "crm", "clients", "route.ts"), "utf8");

describe("CRM client search", () => {
  it("matches both the account ID and Telegram ID", () => {
    expect(clientsRoute).toContain("LOWER(u.id) LIKE ?");
    expect(clientsRoute).toContain("LOWER(COALESCE(u.telegram_user_id, '')) LIKE ?");
  });
});
