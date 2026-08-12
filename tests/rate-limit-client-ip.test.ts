import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "app", "lib", "auth-server.ts"),
  "utf8",
);

describe("fuente de IP para rate limits", () => {
  it("prioriza la cabecera inyectada por Vercel antes de evaluar Cloudflare", () => {
    expect(source.indexOf('headers.get("x-vercel-forwarded-for")'))
      .toBeLessThan(source.indexOf('headers.get("cf-connecting-ip")'));
  });

  it("rechaza cf-connecting-ip cuando producción no entrega la cabecera de Vercel", () => {
    expect(source).toContain('if (isHostedEnvironment()) return "unavailable";');
  });
});
