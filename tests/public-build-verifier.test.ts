import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const verifier = resolve(root, "scripts", "verify-public-build.mjs");

function verifyBundle(content: string) {
  const directory = mkdtempSync(resolve(tmpdir(), "yape-public-build-"));
  try {
    writeFileSync(resolve(directory, "bundle.js"), content, "utf8");
    execFileSync(process.execPath, [verifier, directory], {
      encoding: "utf8",
      stdio: "pipe",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("public build verifier", () => {
  it("allows the Turbopack virtual ROOT identifier", () => {
    expect(() => verifyBundle('const virtualUrl = "file:///ROOT/runtime";')).not.toThrow();
  });

  it("still rejects a real local file URL", () => {
    expect(() => verifyBundle('const localUrl = "file:///C:/Users/example/secret";')).toThrow();
  });
});
