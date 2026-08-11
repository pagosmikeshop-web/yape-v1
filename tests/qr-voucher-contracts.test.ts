import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bankApp = readFileSync(path.join(projectRoot, "app", "components", "BankApp.tsx"), "utf8");
const qrView = readFileSync(path.join(projectRoot, "app", "components", "bank", "QrView.tsx"), "utf8");
const qrServer = readFileSync(path.join(projectRoot, "app", "lib", "qr-contact-server.ts"), "utf8");
const qrScanner = readFileSync(path.join(projectRoot, "app", "components", "bank", "QRCodeScanner.tsx"), "utf8");
const transferView = readFileSync(path.join(projectRoot, "app", "components", "bank", "TransferView.tsx"), "utf8");
const transferStageViews = readFileSync(path.join(projectRoot, "app", "components", "bank", "TransferStageViews.tsx"), "utf8");
const transferRoute = readFileSync(path.join(projectRoot, "app", "api", "payments", "transfer", "route.ts"), "utf8");
const transferRecipientResolution = readFileSync(path.join(projectRoot, "app", "lib", "transfer-recipient-resolution.ts"), "utf8");
const voucher = readFileSync(path.join(projectRoot, "app", "components", "bank", "MovementVoucher.tsx"), "utf8");
const migration = readFileSync(path.join(projectRoot, "supabase", "migrations", "20260805100000_allow_qr_without_phone.sql"), "utf8");

describe("registro y comprobante de QR", () => {
  it("limita Yape a los últimos 3 dígitos y oculta celular para otros bancos", () => {
    expect(qrView).toContain("Últimos 3 dígitos del celular");
    expect(qrView).toContain("nextProvider !== \"Yape\"");
    expect(qrView).toContain("!isYapeProvider");
    expect(qrServer).toContain("provider === \"Yape\" && inputDigits.length !== 3");
  });

  it("permite QR sin celular y omite el celular del comprobante externo", () => {
    expect(migration).toContain("pg_get_constraintdef");
    expect(voucher).toContain("await navigator.share({ files: [file] });");
    expect(voucher).not.toContain("text: buildVoucherShareText");
    expect(voucher).toContain("inlineVoucherImages(voucherContent)");
    expect(voucher).toContain("rasterBlobAsPng");
    expect(voucher).toContain("cacheBust: false");
    expect(voucher).toContain("El banner del comprobante no pudo decodificarse.");
    expect(transferStageViews).toContain("isYapeDestination(destination)");
    expect(bankApp).toContain("isYapeDestination(voucher.destination)");
  });

  it("reconoce QR bancarios guardados aunque no tengan celular", () => {
    expect(qrScanner).toContain("!data.qr.recipientId && !data.qr.phone && !data.qr.id");
    expect(qrScanner).toContain("qrId: data.qr.id === \"payment\" ? \"\" : data.qr.id");
    expect(transferView).toContain("recipientQrId");
    expect(transferRecipientResolution).toContain("FROM global_qr_directory");
  });

});
