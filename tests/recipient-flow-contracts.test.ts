import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
function readSource(relativePath: string) {
  return readFileSync(resolve(root, relativePath), "utf8").replace(/\r\n/gu, "\n");
}

const transferView = readSource("app/components/bank/TransferView.tsx");
const lookupRoute = readSource("app/api/payments/recipient-lookup/route.ts");
const transferRoute = readSource("app/api/payments/transfer/route.ts");
const bankApp = readSource("app/components/BankApp.tsx");
const qrView = readSource("app/components/bank/QrView.tsx");
const qrContactServer = readSource("app/lib/qr-contact-server.ts");
const qrScanningServer = readSource("app/lib/qr-scanning-server.ts");

describe("contrato del flujo de destinatarios", () => {
  it("mantiene los proveedores del directorio y prioriza Free antes del externo", () => {
    expect(lookupRoute).toContain("provider: globalRecipient.provider");
    expect(lookupRoute).toContain("providers: globalRecipient.providers");
    expect(lookupRoute).toContain("const free = await freeRecipientResponse();");
    expect(lookupRoute).toContain("if (configuredOnly)");
    expect(lookupRoute).toContain("const external = await externalRecipientResponse();");

    const freeIndex = lookupRoute.indexOf("const free = await freeRecipientResponse();");
    const externalIndex = lookupRoute.indexOf("const external = await externalRecipientResponse();");
    expect(freeIndex).toBeGreaterThanOrEqual(0);
    expect(externalIndex).toBeGreaterThan(freeIndex);
  });

  it("envía y valida el destino elegido contra los proveedores configurados", () => {
    expect(transferView).toContain("getRecipientProviderActions(");
    expect(transferView).toContain("void submitTransfer(primaryProvider");
    expect(transferView).toContain("destination: destinationValue");
    expect(transferRoute).toContain("recipient.providers.includes(destination)");
    expect(transferRoute).toContain("destination,");
  });

  it("mantiene el proveedor del QR desde el registro hasta el escaneo", () => {
    expect(qrView).toContain('provider,\n          payload: qrPayload');
    expect(qrContactServer).toContain("const provider = parseProvider(input.provider);");
    expect(qrContactServer).toContain("provider,");
    expect(qrScanningServer).toContain("provider: row.provider");
  });
});
