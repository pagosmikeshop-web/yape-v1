import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
function readSource(relativePath: string) {
  return readFileSync(resolve(root, relativePath), "utf8").replace(/\r\n/gu, "\n");
}

const transferView = readSource("app/components/bank/TransferView.tsx");
const transferRecipient = readSource(
  "app/components/bank/useTransferRecipient.ts",
);
const lookupClient = readSource("app/lib/recipient-lookup-client.ts");

describe("contrato del cliente de búsqueda de destinatarios", () => {
  it("centraliza las consultas por id y por celular", () => {
    expect(transferRecipient).toContain("lookupRecipientById(");
    expect(transferRecipient).toContain("lookupRecipientByPhone(");
    expect(lookupClient).toContain('fetch("/api/payments/recipient-lookup"');
    expect(lookupClient).toContain("recipientId");
    expect(lookupClient).toContain("phone");
  });

  it("mantiene la consulta configurada y la cancelación de solicitudes", () => {
    expect(transferRecipient).toContain("configuredOnly: true");
    expect(lookupClient).toContain("signal?: AbortSignal");
    expect(lookupClient).toContain('cache: "no-store"');
  });
});
