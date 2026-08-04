import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const serviceWorker = readFileSync(
  path.join(projectRoot, "public", "sw.js"),
  "utf8",
);
const authServer = readFileSync(
  path.join(projectRoot, "app", "lib", "auth-server.ts"),
  "utf8",
);
const nextConfig = readFileSync(
  path.join(projectRoot, "next.config.ts"),
  "utf8",
);

describe("security contracts", () => {
  it("never handles API requests through the public Service Worker cache", () => {
    expect(serviceWorker).toContain("if (!isSameOriginGet(request, url) || isApiRequest(url)) return;");
    expect(serviceWorker).toContain("!policy.includes(\"no-store\")");
  });

  it("restricts Service Worker update commands to a validated same-origin message", () => {
    expect(serviceWorker).toContain("event.origin !== self.location.origin");
    expect(serviceWorker).toContain("new URL(source.url).origin");
    expect(serviceWorker).toContain('data.type !== "SKIP_WAITING"');
  });

  it("marks unauthenticated API responses as non-cacheable", () => {
    expect(authServer).toContain('"cache-control": "no-store, max-age=0"');
    expect(authServer).toContain('pragma: "no-cache"');
    expect(nextConfig).toContain('source: "/api/:path*"');
    expect(nextConfig).toContain('value: "no-store, max-age=0"');
  });

  it("keeps session cookies HttpOnly and SameSite=Strict", () => {
    expect(authServer).toContain("HttpOnly; SameSite=Strict");
  });

  it("cleans up old sessions with PostgreSQL-compatible pagination", () => {
    expect(authServer).toContain("ORDER BY created_at DESC LIMIT ? OFFSET ?");
    expect(authServer).not.toContain("LIMIT -1 OFFSET ?");
    expect(authServer).toContain("SESSION_CLEANUP_LIMIT");
  });
});
