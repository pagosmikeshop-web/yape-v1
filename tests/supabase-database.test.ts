import { describe, expect, it } from "vitest";
import { normalizePostgresStatement } from "../app/lib/database-server";

describe("Supabase Postgres adapter", () => {
  it("converts D1 placeholders without changing quoted question marks", () => {
    expect(normalizePostgresStatement({
      sql: "SELECT * FROM users WHERE username = ? AND display_name = '?'",
      args: ["seller"],
    })).toEqual({
      sqlText: "SELECT * FROM users WHERE username = $1 AND display_name = '?'",
      args: ["seller"],
    });
  });

  it("converts SQLite INSERT OR IGNORE into an idempotent Postgres insert", () => {
    expect(normalizePostgresStatement({
      sql: "INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)",
      args: ["user-1", "seller"],
    })).toEqual({
      sqlText: "INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      args: ["user-1", "seller"],
    });
  });

  it("does not send SQLite PRAGMA statements to Supabase", () => {
    expect(normalizePostgresStatement({ sql: "PRAGMA foreign_keys = ON", args: [] })).toBeNull();
  });
});
