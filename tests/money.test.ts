import { describe, expect, it } from "vitest";
import {
  formatAccountBalance,
  isValidAccountBalanceCents,
  MAX_ACCOUNT_BALANCE_CENTS,
  normalizeAccountBalanceInput,
  parseAccountBalanceCents,
} from "../app/lib/money";

describe("account balance money helpers", () => {
  it("formats thousands and the maximum with grouping and two decimals", () => {
    expect(formatAccountBalance(1_000)).toBe("1,000.00");
    expect(formatAccountBalance(1_000_000)).toBe("1,000,000.00");
  });

  it("keeps the input readable while editing", () => {
    expect(normalizeAccountBalanceInput("1000")).toBe("1,000");
    expect(normalizeAccountBalanceInput("1,000.5")).toBe("1,000.5");
    expect(normalizeAccountBalanceInput("1,000.567")).toBe("1,000.56");
    expect(normalizeAccountBalanceInput("")).toBe("");
  });

  it("parses cents without floating-point rounding", () => {
    expect(parseAccountBalanceCents("1,000.00")).toBe(100_000);
    expect(parseAccountBalanceCents("1,000,000.00")).toBe(
      MAX_ACCOUNT_BALANCE_CENTS,
    );
    expect(parseAccountBalanceCents("1000.001")).toBeNull();
    expect(parseAccountBalanceCents("1,000,000.01")).toBe(
      MAX_ACCOUNT_BALANCE_CENTS + 1,
    );
  });

  it("accepts only values up to one million soles", () => {
    expect(isValidAccountBalanceCents(MAX_ACCOUNT_BALANCE_CENTS)).toBe(true);
    expect(isValidAccountBalanceCents(MAX_ACCOUNT_BALANCE_CENTS + 1)).toBe(
      false,
    );
    expect(isValidAccountBalanceCents(null)).toBe(false);
  });
});
