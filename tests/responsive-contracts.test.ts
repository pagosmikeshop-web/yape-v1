import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const viewportStyles = readFileSync(
  path.join(projectRoot, "app", "mobile-viewport.css"),
  "utf8",
);

const responsiveContract = viewportStyles.slice(
  viewportStyles.lastIndexOf("* Responsive layout contract"),
);

describe("responsive layout contract", () => {
  it("keeps voucher branding relative to its banner", () => {
    expect(responsiveContract).toContain("--voucher-brand-center-x: 16%;");
    expect(responsiveContract).toMatch(
      /--movement-brand-center-x:\s*\d+(?:\.\d+)?%;/iu,
    );
    expect(responsiveContract).toContain("left: var(--voucher-brand-center-x);");
    expect(responsiveContract).toContain("left: var(--movement-brand-center-x);");
    expect(responsiveContract).toContain("position: relative;");
    expect(responsiveContract).not.toMatch(/left:\s*clamp\([^)]*vw/iu);
  });

  it("reserves space for the fixed home actions", () => {
    expect(responsiveContract).toContain("scroll-padding-block-end");
    expect(responsiveContract).toContain("var(--bottom-nav-height)");
    expect(responsiveContract).toContain("var(--app-safe-bottom)");
  });

  it("allows the shell and its flex children to shrink without horizontal overflow", () => {
    expect(responsiveContract).toContain("container-type: inline-size;");
    expect(responsiveContract).toContain("min-inline-size: 0;");
    expect(responsiveContract).toContain("max-inline-size: 100%;");
    expect(responsiveContract).toContain("overflow-wrap: anywhere;");
  });
});
