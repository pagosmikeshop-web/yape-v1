import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, projectRoot), "utf8");
}

async function builtWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("security-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

function testEnvironment() {
  return {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
}

function productionEnvironment() {
  return Object.assign({
    ...testEnvironment(),
    APP_ENV: "production",
    PUBLIC_APP_URL: "https://app.example.test",
    ADMIN_WEB_URL: "https://admin.example.test",
    AUTH_OWNER_TELEGRAM_ID: "10000",
    TELEGRAM_REQUIRED_GROUP_ID: "test-group",
    TELEGRAM_GROUP_INVITE_URL: "https://t.me/test_group",
  }, Object.fromEntries([
    ["AUTH_RATE_LIMIT_PEPPER", "x".repeat(32)],
    ["QR_CONTACTS_ENCRYPTION_KEY", "y".repeat(32)],
    ["TELEGRAM_WEBHOOK_SECRET", "z".repeat(32)],
    ["TELEGRAM_BOT_TOKEN", "test-token"],
  ]));
}

function executionContext() {
  return { waitUntil() {}, passThroughOnException() {} };
}

test("el Worker aplica encabezados defensivos y no permite cachear una pantalla protegida", async () => {
  const worker = await builtWorker();
  const response = await worker.fetch(
    new Request("http://localhost/inicio", { headers: { accept: "text/html" } }),
    testEnvironment(),
    executionContext(),
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(self\)/u);
  assert.match(response.headers.get("content-security-policy") ?? "", /object-src 'none'/u);
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/u);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
  assert.match(response.headers.get("x-request-id") ?? "", /^[A-Za-z0-9-]{8,64}$/u);
});

test("una mutación JSON sin Origin se rechaza antes de consultar autenticación", async () => {
  const worker = await builtWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sellerId: "YAPE", username: "test", password: "not-a-secret" }),
    }),
    testEnvironment(),
    executionContext(),
  );
  assert.equal(response.status, 403);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(JSON.stringify(body), /stack|sql|password_hash|AUTH_/iu);
});

test("tipo de contenido y tamaño se validan centralmente", async () => {
  const worker = await builtWorker();
  const common = {
    origin: "http://localhost",
    "sec-fetch-site": "same-origin",
  };
  const wrongType = await worker.fetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { ...common, "content-type": "text/plain" },
      body: "{}",
    }),
    testEnvironment(),
    executionContext(),
  );
  assert.equal(wrongType.status, 415);

  const tooLarge = await worker.fetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        ...common,
        "content-type": "application/json",
        "content-length": String(40 * 1024),
      },
      body: JSON.stringify({ filler: "x".repeat(40 * 1024) }),
    }),
    testEnvironment(),
    executionContext(),
  );
  assert.equal(tooLarge.status, 413);

  const encoder = new TextEncoder();
  const streamedTooLarge = await worker.fetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { ...common, "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`{"filler":"${"x".repeat(34 * 1024)}`));
          controller.enqueue(encoder.encode('"}'));
          controller.close();
        },
      }),
      duplex: "half",
    }),
    testEnvironment(),
    executionContext(),
  );
  assert.equal(streamedTooLarge.status, 413);
});

test("el service worker sólo almacena recursos públicos explícitos", async () => {
  const serviceWorker = await source("public/sw.js");
  assert.doesNotMatch(serviceWorker, /["']\/inicio["']/u);
  assert.doesNotMatch(serviceWorker, /cache\.put\(request,\s*copy\)[\s\S]*url\.pathname\.startsWith\(["']\/api\//u);
  assert.match(serviceWorker, /PUBLIC_ASSET_PREFIXES/u);
  assert.match(serviceWorker, /no-store/u);
  assert.match(serviceWorker, /private/u);
});

test("registro y webhook no exponen endpoints GET de diagnóstico", async () => {
  const [statusRoute, registerRoute, authScreen, webhookRoute, setupRoute, telegramManager] = await Promise.all([
    source("app/api/auth/register/status/route.ts"),
    source("app/api/auth/register/route.ts"),
    source("app/components/AuthScreen.tsx"),
    source("app/api/telegram/webhook/route.ts"),
    source("app/api/telegram/setup/route.ts"),
    source("app/lib/telegram-manager.ts"),
  ]);
  assert.match(statusRoute, /export async function POST/u);
  assert.doesNotMatch(statusRoute, /export async function GET/u);
  assert.doesNotMatch(authScreen, /register\/status\?\$\{/u);
  assert.doesNotMatch(webhookRoute, /export async function GET/u);
  assert.match(webhookRoute, /maxBytes:\s*64 \* 1024/u);
  assert.match(statusRoute, /isCurrentTelegramGroupMember/u);
  assert.match(registerRoute, /isCurrentTelegramGroupMember/u);
  assert.doesNotMatch(statusRoute, /FROM telegram_group_members/u);
  assert.doesNotMatch(registerRoute, /FROM telegram_group_members/u);
  assert.match(setupRoute, /bootstrapIsEnabled\(\)/u);
  assert.match(telegramManager, /DISABLED_WRITE_COMMANDS/u);
  assert.doesNotMatch(telegramManager, /Clave temporal:/u);
  assert.doesNotMatch(telegramManager, /telegram_(?:initial|topup|activation|password_reset)/u);
});

test("las operaciones críticas tienen idempotencia y autorización por propietario", async () => {
  const [transfer, schema, qrDelete, adminDelete] = await Promise.all([
    source("app/api/payments/transfer/route.ts"),
    source("db/schema.ts"),
    source("app/lib/qr-contact-server.ts"),
    source("app/api/admin/users/[id]/route.ts"),
  ]);
  assert.match(transfer, /idempotency-key/u);
  assert.match(transfer, /findIdempotentMovement/u);
  assert.match(transfer, /recipient_user_id/u);
  assert.doesNotMatch(transfer, /recipientName\s*=\s*cleanText\(body\.recipientName/u);
  assert.match(schema, /account_movements_user_idempotency_unique/u);
  assert.match(qrDelete, /DELETE FROM qr_contacts WHERE id = \? AND user_id = \?/u);
  assert.match(adminDelete, /requireManagedAccount/u);
});

test("no se publican source maps ni identificadores privilegiados literales", async () => {
  const [authServer, bootstrap, bootstrapUi, distFiles] = await Promise.all([
    source("app/lib/auth-server.ts"),
    source("app/api/auth/bootstrap/route.ts"),
    source("app/components/BootstrapAdmin.tsx"),
    readdir(new URL("../dist/client/", import.meta.url), { recursive: true }),
  ]);
  assert.doesNotMatch(authServer, /telegram_user_id\s*=\s*'\d{4,24}'/u);
  assert.doesNotMatch(bootstrap, /sellerCode\s*!==\s*"\d{4,24}"/u);
  assert.doesNotMatch(bootstrapUi, /ADMIN_TELEGRAM_ID/u);
  assert.equal(distFiles.some((file) => String(file).endsWith(".map")), false);
});

test("la sesión tiene expiración absoluta, por inactividad y cookie prefijada en HTTPS", async () => {
  const [authServer, pinVerification] = await Promise.all([
    source("app/lib/auth-server.ts"),
    source("app/api/auth/pin/verify/route.ts"),
  ]);
  assert.match(authServer, /SECURE_SESSION_COOKIE\s*=\s*"__Host-yape_session"/u);
  assert.match(authServer, /SESSION_DAYS\s*=\s*30/u);
  assert.match(authServer, /AUTH_SESSION_IDLE_MINUTES/u);
  assert.match(authServer, /last_seen_at > \?/u);
  assert.match(authServer, /HttpOnly; SameSite=Strict/u);
  assert.match(authServer, /rotateAndUnlockSession/u);
  assert.match(authServer, /SET token_hash = \?, pin_verified_at = \?/u);
  assert.match(pinVerification, /"set-cookie": cookie/u);
});

test("solo los clientes quedan vinculados a un dispositivo y el panel puede liberarlos", async () => {
  const [authServer, loginRoute, resetDeviceRoute] = await Promise.all([
    source("app/lib/auth-server.ts"),
    source("app/api/auth/login/route.ts"),
    source("app/api/admin/users/[id]/device/route.ts"),
  ]);
  assert.match(loginRoute, /if \(user\.role === "client"\)\s*\{\s*const bound = await bindDevice/u);
  assert.match(loginRoute, /role <> 'client'/u);
  assert.match(authServer, /EXISTS \(SELECT 1 FROM users WHERE id = \? AND role = 'client'/u);
  assert.match(resetDeviceRoute, /requireUnlockedSession\(request, \["admin"\]\)/u);
  assert.match(resetDeviceRoute, /requireManagedAccount\(actor, id\)/u);
  assert.match(resetDeviceRoute, /SET device_id = NULL, device_public_key = NULL/u);
  assert.match(resetDeviceRoute, /DELETE FROM sessions/u);
  assert.match(resetDeviceRoute, /web_reset_client_device/u);
  assert.doesNotMatch(resetDeviceRoute, /fingerprint_id_hash = NULL/u);
});

test("las credenciales legadas migran a un hash versionado y bootstrap falla cerrado", async () => {
  const [authServer, login, worker, environmentExample] = await Promise.all([
    source("app/lib/auth-server.ts"),
    source("app/api/auth/login/route.ts"),
    source("worker/index.ts"),
    source(".env.example"),
  ]);
  assert.match(authServer, /LEGACY_PBKDF2_ITERATIONS\s*=\s*120_000/u);
  assert.match(authServer, /CURRENT_PBKDF2_ITERATIONS\s*=\s*600_000/u);
  assert.match(authServer, /HASH_FORMAT\s*=\s*"pbkdf2-sha256"/u);
  assert.match(login, /secretHashNeedsUpgrade\(user\.password_hash\)/u);
  assert.match(worker, /const ownerTelegramId = env\.AUTH_OWNER_TELEGRAM_ID\?\.trim\(\) \?\? ""/u);
  assert.match(environmentExample, /^AUTH_BOOTSTRAP_ENABLED=false$/mu);
});

test("producción rechaza hosts alternativos y obliga a usar el origen HTTPS canónico", async () => {
  const worker = await builtWorker();
  const missingMode = await worker.fetch(
    new Request("https://app.example.test/inicio"),
    testEnvironment(),
    executionContext(),
  );
  assert.equal(missingMode.status, 503);

  const wrongHost = await worker.fetch(
    new Request("https://alias.example.test/inicio"),
    productionEnvironment(),
    executionContext(),
  );
  assert.equal(wrongHost.status, 421);
  assert.match(wrongHost.headers.get("cache-control") ?? "", /no-store/u);

  const insecure = await worker.fetch(
    new Request("http://app.example.test/inicio"),
    productionEnvironment(),
    executionContext(),
  );
  assert.equal(insecure.status, 308);
  assert.equal(insecure.headers.get("location"), "https://app.example.test/inicio");
});

test("el build no incorpora valores del archivo .env local", async () => {
  const viteConfig = await source("vite.config.ts");
  assert.match(viteConfig, /includeLocalEnvironment \? localEnvVars\(mode\) : \{\}/u);
  assert.match(viteConfig, /localBindingConfig\(mode, command === "serve"\)/u);
});

test("Vercel usa Turso exclusivamente desde el servidor y conserva los controles HTTP", async () => {
  const [database, authServer, environmentExample, packageJson, nextConfig, nextProxy, vercelConfig] = await Promise.all([
    source("app/lib/database-server.ts"),
    source("app/lib/auth-server.ts"),
    source(".env.example"),
    source("package.json"),
    source("next.config.ts"),
    source("proxy.ts"),
    source("vercel.json"),
  ]);
  assert.match(database, /@tursodatabase\/serverless\/compat/u);
  assert.match(database, /if \(environment\.DB\) return environment\.DB/u);
  assert.match(database, /environment\.TURSO_DATABASE_URL/u);
  assert.match(database, /environment\.TURSO_AUTH_TOKEN/u);
  assert.match(database, /this\.client\.batch\(input, \{ mode: "write" \}\)/u);
  assert.match(authServer, /databaseForEnvironment\(env\)/u);
  assert.match(environmentExample, /^TURSO_DATABASE_URL=$/mu);
  assert.match(environmentExample, /^TURSO_AUTH_TOKEN=$/mu);
  assert.doesNotMatch(environmentExample, /^NEXT_PUBLIC_TURSO_/mu);
  assert.equal(JSON.parse(packageJson).scripts.build, "next build");
  assert.equal(JSON.parse(packageJson).dependencies["@tursodatabase/serverless"], "1.3.1");
  assert.match(nextConfig, /poweredByHeader:\s*false/u);
  assert.match(nextProxy, /hostedConfigurationErrors/u);
  assert.match(nextProxy, /TURSO_AUTH_TOKEN/u);
  assert.equal(JSON.parse(vercelConfig).framework, "nextjs");
});
