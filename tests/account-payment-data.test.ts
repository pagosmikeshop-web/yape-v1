import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const route = readFileSync(resolve(root, "app/api/account/payment-data/route.ts"), "utf8");
const service = readFileSync(resolve(root, "app/lib/account-payment-data-server.ts"), "utf8");
const migration = readFileSync(resolve(root, "supabase/migrations/20260801030000_account_payment_profiles.sql"), "utf8");
const bankApp = readFileSync(resolve(root, "app/components/BankApp.tsx"), "utf8");
const qrView = readFileSync(resolve(root, "app/components/bank/QrView.tsx"), "utf8");
const paymentPage = readFileSync(resolve(root, "app/datos-cuenta/recepcion/page.tsx"), "utf8");
const recipientView = readFileSync(resolve(root, "app/components/bank/RecipientContactsView.tsx"), "utf8");
const recipientRoute = readFileSync(resolve(root, "app/api/account/recipient-contacts/route.ts"), "utf8");
const recipientDeleteRoute = readFileSync(resolve(root, "app/api/account/recipient-contacts/[id]/route.ts"), "utf8");
const lookupRoute = readFileSync(resolve(root, "app/api/payments/recipient-lookup/route.ts"), "utf8");
const globalMigration = readFileSync(resolve(root, "supabase/migrations/20260801040000_global_recipient_directory.sql"), "utf8");
const qrDirectoryRoute = readFileSync(resolve(root, "app/api/qr-directory/route.ts"), "utf8");
const qrServer = readFileSync(resolve(root, "app/lib/qr-contact-server.ts"), "utf8");

describe("datos de destinatarios globales", () => {
  it("protege el perfil de cuenta y no requiere creditos", () => {
    expect(route).toContain('requireUnlockedSession(request, ["client"])');
    expect(route).toContain('bucket: "account-payment-data-put"');
    expect(service).toContain("payment_directory");
    expect(service).toContain("ON CONFLICT(user_id) DO UPDATE");
    expect(service).not.toContain("credits");
  });

  it("mantiene QR cifrado y limita el tamano del payload", () => {
    expect(service).toContain("qr_payload_ciphertext");
    expect(service).toContain("AES-GCM");
    expect(service).toContain("MAX_QR_BYTES = 2_048");
    expect(service).toContain("data|blob");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("account_payment_profiles_phone_unique");
  });

  it("abre la pantalla global y reutiliza la camara existente", () => {
    expect(bankApp).toContain('href="/datos-cuenta/recepcion"');
    expect(bankApp).toContain("RecipientContactsView");
    expect(recipientView).toContain("/api/account/recipient-contacts");
    expect(recipientView).toContain("/mi-qr");
    expect(qrView).toContain("/api/qr-directory");
  });

  it("publica contactos globales con terminos y permite retirarlos autenticadamente", () => {
    expect(recipientRoute).toContain('requireUnlockedSession(request, ["admin", "seller", "client"])');
    expect(recipientRoute).toContain("global_recipient_directory");
    expect(recipientRoute).toContain("termsAccepted");
    expect(recipientRoute).toContain("GLOBAL_DIRECTORY_TERMS_VERSION");
    expect(recipientRoute).toContain("validateRecipientDisplayName");
    expect(recipientDeleteRoute).toContain("submitted_by_user_id = ?");
    expect(globalMigration).toContain("global_recipient_directory");
    expect(globalMigration).toContain("enable row level security");
  });

  it("usa el directorio global antes de gastar creditos", () => {
    expect(lookupRoute).toContain("lookupGlobalRecipient");
    expect(lookupRoute).toContain("payment_directory");
    expect(lookupRoute).toContain("const reservation = await reserveAutocompleteCredit");
  });

  it("permite consultar solo configuraciones guardadas desde frecuentes", () => {
    expect(lookupRoute).toContain('"configuredOnly"');
    expect(lookupRoute).toContain("No hay un proveedor configurado para este número.");
    expect(lookupRoute).toContain("configuredOnly");
  });

  it("publica QR global sin limite de cantidad y exige terminos", () => {
    expect(qrDirectoryRoute).toContain("createGlobalQrContact");
    expect(qrDirectoryRoute).toContain("termsAccepted");
    expect(qrServer).toContain("global_qr_directory");
    expect(qrServer).toContain("No existe un límite de cantidad");
    expect(qrServer).not.toContain("MAX_CONTACTS_PER_USER");
  });

  it("abre los destinatarios en una pantalla independiente", () => {
    expect(paymentPage).toContain('view="account-payment-data"');
  });
});
