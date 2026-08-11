import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeQrPayload, QR_SCAN_MAX_BYTES } from "../app/lib/qr-scanning";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scannerServer = readFileSync(path.join(projectRoot, "app", "lib", "qr-scanning-server.ts"), "utf8");
const qrMigration = readFileSync(path.join(projectRoot, "supabase", "migrations", "20260802070000_qr_scanning.sql"), "utf8");

describe("normalización del lector QR", () => {
  it("recorta y normaliza contenido válido sin modificar su significado", () => {
    expect(normalizeQrPayload("  yape://pay?recipient=demo  ")).toBe("yape://pay?recipient=demo");
    expect(normalizeQrPayload("  ＱＲ１２  ")).toBe("QR12");
  });

  it("rechaza contenido vacío, de control o demasiado grande", () => {
    expect(normalizeQrPayload("")).toBe("");
    expect(normalizeQrPayload("a\nvalid")).toBe("");
    expect(normalizeQrPayload("x".repeat(QR_SCAN_MAX_BYTES + 1))).toBe("");
  });

  it("acepta QR inclinados representados como texto Unicode seguro", () => {
    expect(normalizeQrPayload("https://example.test/qr/á" )).toBe("https://example.test/qr/á");
  });

  it("permite lecturas repetidas sin límites y evita duplicar el mismo intento", () => {
    expect(scannerServer).toContain("UNIQUE (scanned_by_user_id, idempotency_key)");
    expect(qrMigration).toContain("qr_scan_events_idempotency_unique");
    expect(scannerServer).not.toContain("usage_count = usage_count + 1");
    expect(scannerServer).not.toContain("max_uses");
    expect(scannerServer).not.toContain("single_use");
  });

  it("no persiste el contenido completo del QR en el historial", () => {
    expect(scannerServer).toContain("scanned_value_hash");
    expect(scannerServer).not.toContain("value, input.user.id");
  });
});
