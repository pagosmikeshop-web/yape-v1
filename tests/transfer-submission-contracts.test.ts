import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
function readSource(relativePath: string) {
  return readFileSync(resolve(root, relativePath), "utf8").replace(/\r\n/gu, "\n");
}

const transferView = readSource("app/components/bank/TransferView.tsx");
const transferSubmission = readSource("app/lib/transfer-submission.ts");

describe("contrato de envío de transferencias", () => {
  it("mantiene el payload completo del yapeo en un servicio dedicado", () => {
    expect(transferView).toContain("submitTransferRequest({");
    expect(transferView).toContain("idempotencyRef: transferIdempotencyRef");
    expect(transferSubmission).toContain('fetch("/api/payments/transfer"');
    expect(transferSubmission).toContain("amountCents");
    expect(transferSubmission).toContain("recipientId");
    expect(transferSubmission).toContain("recipientQrId");
    expect(transferSubmission).toContain("recipientPhone");
    expect(transferSubmission).toContain("recipientManualName");
    expect(transferSubmission).toContain("destination");
    expect(transferSubmission).toContain("message");
  });

  it("mantiene la idempotencia y la política de no cachear pagos", () => {
    expect(transferSubmission).toContain("crypto.randomUUID()");
    expect(transferSubmission).toContain('"idempotency-key": idempotencyKey');
    expect(transferSubmission).toContain('cache: "no-store"');
    expect(transferView).toContain('data.error === "Saldo insuficiente"');
    expect(transferView).toContain("clearBalanceCache()");
  });
});
