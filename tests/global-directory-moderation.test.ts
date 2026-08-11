import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const route = readFileSync(path.join(projectRoot, "app", "api", "admin", "global-directory", "route.ts"), "utf8");

describe("moderación del directorio global", () => {
  it("limita la ruta al Owner y no expone payloads QR", () => {
    expect(route).toContain("assertOwner(actor)");
    expect(route).toContain("global_qr_directory");
    expect(route).toContain("global_recipient_directory");
    expect(route).toContain("phone: row.phone_e164");
    expect(route).not.toContain("qr_payload_ciphertext");
    expect(route).not.toContain("qr_payload_iv");
  });

  it("mantiene acciones de moderación auditables y con campos estrictos", () => {
    expect(route).toContain("web_global_directory_revoke");
    expect(route).toContain("web_global_directory_restore");
    expect(route).toContain("web_global_directory_delete");
    expect(route).toContain("La solicitud contiene campos no permitidos.");
  });
});
