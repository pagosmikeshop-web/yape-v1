import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function readSource(relativePath: string) {
  return readFileSync(resolve(root, relativePath), "utf8").replace(/\r\n/gu, "\n");
}

function importantCount(relativePath: string) {
  return (readSource(relativePath).match(/!important\b/gu) ?? []).length;
}

describe("CSS cascade budget", () => {
  it("keeps the established stylesheet order", () => {
    const layout = readSource("app/layout.tsx");
    const imports = [
      'import "./globals.css";',
      'import "./bank.css";',
      'import "./apk-fidelity.css";',
      'import "./mobile-viewport.css";',
    ];

    let previous = -1;
    for (const stylesheetImport of imports) {
      const position = layout.indexOf(stylesheetImport);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
  });

  it("does not allow the existing important debt to grow", () => {
    expect(importantCount("app/bank.css")).toBeLessThanOrEqual(12);
    expect(importantCount("app/apk-fidelity.css")).toBeLessThanOrEqual(478);
    expect(importantCount("app/mobile-viewport.css")).toBeLessThanOrEqual(137);
  });
});
