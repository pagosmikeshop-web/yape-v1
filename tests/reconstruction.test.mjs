import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, projectRoot), "utf8");
}

async function assertFile(relativePath) {
  const file = await stat(new URL(relativePath, projectRoot));
  assert.ok(file.isFile(), `${relativePath} debe existir`);
  assert.ok(file.size > 0, `${relativePath} no puede estar vacío`);
}

test("la reconstrucción conserva todas las rutas principales", async () => {
  const routes = [
    "admin",
    "activar-cuenta",
    "aprobar-compras",
    "ayuda",
    "biometria",
    "cambiar-contrasena",
    "compras-internet",
    "configurar-admin",
    "confirmacion-montos",
    "creditos",
    "datos-cuenta",
    "direcciones",
    "dolares",
    "escanear-qr",
    "inicio",
    "limites-transaccionales",
    "mi-qr",
    "movimientos",
    "notificaciones",
    "notificaciones-transferencias",
    "perfil",
    "qr-personal",
    "recargar",
    "recargar-transportes",
    "recuperar",
    "registro",
    "seguro-vehicular",
    "servicios",
    "transferir",
    "vendedor",
  ];

  await Promise.all(routes.map((route) => assertFile(`app/${route}/page.tsx`)));
});

test("el QR es individual, se genera dinámicamente y se puede leer con cámara o galería", async () => {
  const [bankApp, paymentQr] = await Promise.all([
    source("app/components/BankApp.tsx"),
    source("app/lib/payment-qr.ts"),
  ]);

  assert.match(paymentQr, /YAPE_QR_PROTOCOL\s*=\s*"yape:"/u);
  assert.match(paymentQr, /YAPE_QR_HOST\s*=\s*"pay"/u);
  assert.match(paymentQr, /LEGACY_MI_BANCO_QR_PROTOCOL\s*=\s*"mi-banco:"/u);
  assert.match(paymentQr, /payload\.searchParams\.set\("recipient", recipientId\)/u);
  assert.match(bankApp, /QRCode\.toDataURL\(payload/u);
  assert.match(bankApp, /BrowserQRCodeReader/u);
  assert.match(bankApp, /decodeFromConstraints/u);
  assert.match(bankApp, /decodeFromImageUrl/u);
  assert.match(bankApp, /applyConstraints\(\{\s*advanced:\s*\[\{\s*torch:/u);
  assert.match(bankApp, /router\.push\(`\/transferir\?recipient=/u);
  assert.doesNotMatch(bankApp, /qr_code_sample\.png/u);
});

test("cada cliente puede guardar QR cifrados y únicamente usar destinatarios internos verificados", async () => {
  const [schema, qrServer, listRoute, deleteRoute, bankApp, migration, brandMigration] = await Promise.all([
    source("db/schema.ts"),
    source("app/lib/qr-contact-server.ts"),
    source("app/api/qr-contacts/route.ts"),
    source("app/api/qr-contacts/[id]/route.ts"),
    source("app/components/BankApp.tsx"),
    source("drizzle/0005_optimal_echo.sql"),
    source("drizzle/0006_restore_yape_brand.sql"),
  ]);

  assert.match(schema, /sqliteTable\("qr_contacts"/u);
  assert.match(schema, /qrPayloadCiphertext/u);
  assert.match(schema, /recipientUserId/u);
  assert.match(qrServer, /AES-GCM/u);
  assert.match(qrServer, /QR_CONTACTS_ENCRYPTION_KEY/u);
  assert.match(qrServer, /MAX_CONTACTS_PER_USER\s*=\s*50/u);
  assert.match(qrServer, /parsePaymentQrPayload/u);
  assert.match(qrServer, /provider === "Yape"/u);
  assert.match(qrServer, /recipient_user_id = \? LIMIT 1/u);
  assert.match(qrServer, /u\.role = 'client' AND u\.status = 'active'/u);
  assert.doesNotMatch(qrServer, /console\.(?:log|error)\([^\n]*payload/iu);
  assert.match(listRoute, /requireUnlockedSession\(request, \["client"\]\)/u);
  assert.match(listRoute, /createQrContact/u);
  assert.match(deleteRoute, /deleteQrContact/u);
  assert.match(bankApp, /fetch\("\/api\/qr-contacts"/u);
  assert.match(bankApp, /Escanear con cámara/u);
  assert.match(bankApp, /Tus QR guardados/u);
  assert.match(bankApp, /view === "personal-qr"/u);
  assert.match(migration, /CREATE TABLE `qr_contacts`/u);
  assert.match(migration, /recipient_user_id/u);
  assert.match(brandMigration, /SET `provider` = 'Yape'/u);
});

test("el directorio resuelve un número únicamente a un cliente activo y limita consultas", async () => {
  const [schema, authServer, lookupRoute, bankApp, migration] = await Promise.all([
    source("db/schema.ts"),
    source("app/lib/auth-server.ts"),
    source("app/api/payments/recipient-lookup/route.ts"),
    source("app/components/BankApp.tsx"),
    source("drizzle/0002_orange_saracen.sql"),
  ]);

  assert.match(schema, /sqliteTable\("payment_directory"/u);
  assert.match(schema, /uniqueIndex\("payment_directory_phone_unique"\)/u);
  assert.match(schema, /sqliteTable\("recipient_lookup_attempts"/u);
  assert.match(authServer, /normalizePeruvianMobile/u);
  assert.match(lookupRoute, /LOOKUP_LIMIT_PER_HOUR\s*=\s*60/u);
  assert.match(lookupRoute, /d\.discoverable = 1/u);
  assert.match(lookupRoute, /u\.role = 'client' AND u\.status = 'active'/u);
  assert.match(lookupRoute, /No puedes transferirte a tu propia cuenta/u);
  assert.match(bankApp, /fetch\("\/api\/payments\/recipient-lookup"/u);
  assert.match(migration, /CREATE TABLE `payment_directory`/u);
  assert.match(migration, /CREATE TABLE `recipient_lookup_attempts`/u);
});

test("Owner, administradores y vendedores gestionan su jerarquía desde la web", async () => {
  const [manager, adminPage, adminPortal, sellerPage, clientsRoute, activationRoute, adminRoute, userRoute, management, creditsRoute, invitationRoute] = await Promise.all([
    source("app/components/ClientManager.tsx"),
    source("app/admin/page.tsx"),
    source("app/api/admin/portal/route.ts"),
    source("app/vendedor/page.tsx"),
    source("app/api/seller/clients/route.ts"),
    source("app/api/seller/clients/[id]/activate/route.ts"),
    source("app/api/admin/users/route.ts"),
    source("app/api/admin/users/[id]/route.ts"),
    source("app/lib/management-server.ts"),
    source("app/api/admin/sellers/[id]/credits/route.ts"),
    source("app/api/auth/invitations/redeem/route.ts"),
  ]);

  assert.match(manager, /name="phone"/u);
  assert.doesNotMatch(manager, /name="password"/u);
  assert.match(manager, /invitation\.activationUrl/u);
  assert.match(manager, /\/api\/seller\/clients/u);
  assert.match(manager, /\/api\/admin\/users/u);
  assert.match(manager, /idempotency-key/u);
  assert.match(manager, /\/activate/u);
  assert.match(adminPage, /notFound\(\)/u);
  assert.match(adminPortal, /ADMIN_WEB_URL/u);
  assert.match(adminPortal, /status:\s*307/u);
  assert.match(sellerPage, /<ClientManager role="seller"/u);
  assert.match(clientsRoute, /createUser\(/u);
  assert.match(clientsRoute, /\bphone,\s*\n\s*role:\s*"client"/u);
  assert.match(clientsRoute, /mustChangePassword:\s*true/u);
  assert.match(clientsRoute, /createInvitation\(id\)/u);
  assert.match(adminRoute, /requestedRole !== "seller" && requestedRole !== "admin"/u);
  assert.match(adminRoute, /Solo el Owner puede crear administradores/u);
  assert.match(adminRoute, /let ownerId = actor\.id/u);
  assert.match(adminRoute, /Administrador activo no encontrado/u);
  assert.match(adminRoute, /createInvitation\(id\)/u);
  assert.match(userRoute, /export async function DELETE/u);
  assert.match(userRoute, /No puedes eliminar tu propia cuenta/u);
  assert.match(userRoute, /Primero reasigna o elimina las cuentas/u);
  assert.match(management, /actor\.isOwner/u);
  assert.match(management, /target\.owner_id === actor\.id/u);
  assert.match(creditsRoute, /web_credit_assignment/u);
  assert.match(creditsRoute, /idempotency-key/u);
  assert.match(activationRoute, /database\.batch/u);
  assert.match(activationRoute, /INSERT INTO activations/u);
  assert.doesNotMatch(activationRoute, /credits = credits -/u);
  assert.match(invitationRoute, /redeemInvitation/u);
});

test("la prueba gratuita, los referidos y los tokens permanentes usan estados separados", async () => {
  const [schema, accessServer, redeemRoute, accessRoute, activationRoute, telegramManager, bankApp] = await Promise.all([
    source("db/schema.ts"),
    source("app/lib/access-server.ts"),
    source("app/api/access/redeem/route.ts"),
    source("app/api/admin/users/[id]/access/route.ts"),
    source("app/api/seller/clients/[id]/activate/route.ts"),
    source("app/lib/telegram-manager.ts"),
    source("app/components/BankApp.tsx"),
  ]);

  assert.match(schema, /sqliteTable\("permanent_access_tokens"/u);
  assert.match(accessServer, /permanent_access_token/u);
  assert.match(accessServer, /credits = credits - 1/u);
  assert.match(accessServer, /access_expires_at = NULL/u);
  assert.match(redeemRoute, /getSessionUserIncludingExpired/u);
  assert.match(accessRoute, /mode === "permanent"/u);
  assert.match(activationRoute, /recibió 3 días gratis/u);
  assert.match(telegramManager, /REFERRAL_MONTHLY_LIMIT/u);
  assert.match(telegramManager, /Esa cuenta ya tiene acceso permanente/u);
  assert.match(bankApp, /Reclamar token/u);
  assert.match(bankApp, /días restantes/u);
});

test("el acceso aplica límites, recuperación de un solo uso y PIN verificado por el servidor", async () => {
  const [schema, authServer, authScreen, bootstrapRoute, loginRoute, pinRoute, resetRequest, resetComplete, telegramManager] = await Promise.all([
    source("db/schema.ts"),
    source("app/lib/auth-server.ts"),
    source("app/components/AuthScreen.tsx"),
    source("app/api/auth/bootstrap/route.ts"),
    source("app/api/auth/login/route.ts"),
    source("app/api/auth/pin/verify/route.ts"),
    source("app/api/auth/password/reset/request/route.ts"),
    source("app/api/auth/password/reset/complete/route.ts"),
    source("app/lib/telegram-manager.ts"),
  ]);

  assert.match(schema, /sqliteTable\("auth_rate_limits"/u);
  assert.match(schema, /sqliteTable\("password_reset_tokens"/u);
  assert.match(schema, /sqliteTable\("account_invitations"/u);
  assert.match(authServer, /AUTH_RATE_LIMIT_PEPPER/u);
  assert.match(authServer, /export async function requireUnlockedSession/u);
  assert.match(authServer, /unlocked_until/u);
  assert.doesNotMatch(authScreen, /Owner \/ administrador/u);
  assert.doesNotMatch(authScreen, /owner-bootstrap-secret/u);
  assert.match(
    authScreen,
    /function rolePath\(user: AuthUser\)\s*\{\s*if \(user\.role === "seller"\) return "\/vendedor";\s*return "\/inicio";\s*\}/u,
  );
  assert.doesNotMatch(authScreen, /\/api\/admin\/portal/u);
  assert.match(bootstrapRoute, /secureCompare\(secret, configuredSecret\)/u);
  assert.match(loginRoute, /bucket:\s*"login-account"/u);
  assert.match(loginRoute, /limit:\s*5/u);
  assert.match(pinRoute, /bucket:\s*"pin-account"/u);
  assert.match(resetRequest, /createDecoyPasswordResetChallenge/u);
  assert.match(resetRequest, /status:\s*202/u);
  assert.match(resetComplete, /completePasswordReset/u);
  assert.match(telegramManager, /DISABLED_WRITE_COMMANDS/u);
});

test("la compilación incluye las rutas nuevas de pagos y clientes", async () => {
  const buildManifestCandidates = [
    "dist/server/index.js",
    "dist/client/.vite/manifest.json",
  ];

  for (const candidate of buildManifestCandidates) await assertFile(candidate);

  await Promise.all([
    assertFile("app/api/payments/recipient-lookup/route.ts"),
    assertFile("app/api/seller/clients/route.ts"),
    assertFile("app/api/seller/clients/[id]/activate/route.ts"),
    assertFile("app/api/auth/invitations/redeem/route.ts"),
    assertFile("app/api/auth/password/reset/complete/route.ts"),
    assertFile("app/api/admin/users/[id]/device/route.ts"),
    assertFile("app/api/qr-contacts/route.ts"),
    assertFile("app/api/qr-contacts/[id]/route.ts"),
    assertFile("app/qr-personal/page.tsx"),
    assertFile("public/assets/apk/icons/ic_yape_logo_r_yape_primary_700.svg"),
  ]);
});

test("la PWA ofrece instalación directa en Android con iconos válidos", async () => {
  const [manifestText, installGate] = await Promise.all([
    source("public/manifest.webmanifest"),
    source("app/components/AppInstallGate.tsx"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/?source=pwa");
  assert.equal(manifest.prefer_related_applications, false);
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.type === "image/png"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.type === "image/png"));
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  assert.match(installGate, /beforeinstallprompt/u);
  assert.match(installGate, /appinstalled/u);
  assert.match(installGate, />Instalar app</u);

  await Promise.all([
    assertFile("public/icons/yape-192.png"),
    assertFile("public/icons/yape-512.png"),
    assertFile("public/icons/yape-maskable-512.png"),
  ]);
});
