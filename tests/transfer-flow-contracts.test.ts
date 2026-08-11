import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
function readSource(relativePath: string) {
  return readFileSync(resolve(root, relativePath), "utf8").replace(/\r\n/gu, "\n");
}

const transferView = readSource("app/components/bank/TransferView.tsx");
const stageViews = readSource("app/components/bank/TransferStageViews.tsx");
const transferRoute = readSource("app/api/payments/transfer/route.ts");

describe("contrato del flujo completo de TransferView", () => {
  it("mantiene la prioridad del proveedor primario y el acceso a otros bancos", () => {
    expect(transferView).toContain("const { primaryProvider } = getRecipientProviderActions(");
    expect(transferView).toContain("void submitTransfer(primaryProvider, \"amount-processing\")");
    expect(transferView).toContain("setStage(\"entities\")");
    expect(stageViews).toContain("requestOtherBanks");
    expect(stageViews).toContain("requestYapear");
  });

  it("mantiene las transiciones de procesamiento, confirmación y comprobante", () => {
    expect(transferView).toContain("setStage(processingStage)");
    expect(transferView).toContain("setStage(\"confirm\")");
    expect(transferView).toContain("setStage(\"success\")");
    expect(transferView).toContain("setVoucher({");
    expect(stageViews).toContain("confirmTransfer");
    expect(stageViews).toContain("shareTransferVoucher");
    expect(transferRoute).toContain("recipient.providers.includes(destination)");
  });

  it("conserva las salidas seguras para saldo insuficiente y errores", () => {
    expect(transferView).toContain("data.error === \"Saldo insuficiente\"");
    expect(transferView).toContain("showInsufficientBalance()");
    expect(transferView).toContain("safeClientMessage(error");
    expect(stageViews).toContain("aria-labelledby=\"insufficient-balance-title\"");
  });
});
