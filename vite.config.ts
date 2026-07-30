import vinext from "vinext";
import { existsSync, readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

function loadHostingConfig() {
  const hostingConfigUrl = new URL("./.openai/hosting.json", import.meta.url);
  if (!existsSync(hostingConfigUrl)) {
    return {} as { d1?: string; r2?: string };
  }

  try {
    return JSON.parse(readFileSync(hostingConfigUrl, "utf8")) as {
      d1?: string;
      r2?: string;
    };
  } catch {
    return {} as { d1?: string; r2?: string };
  }
}

const { d1, r2 } = loadHostingConfig();

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const APP_ENV_KEYS = [
  "APP_ENV",
  "ALLOW_CLIENT_BALANCE_EDIT",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "PUBLIC_APP_URL",
  "ADMIN_WEB_URL",
  "ADMIN_PROXY_SECRET",
  "AUTH_BOOTSTRAP_ENABLED",
  "AUTH_BOOTSTRAP_SECRET",
  "AUTH_OWNER_PASSWORD_RESET_ENABLED",
  "AUTH_OWNER_TELEGRAM_ID",
  "AUTH_RATE_LIMIT_PEPPER",
  "AUTH_SESSION_IDLE_MINUTES",
  "ACCOUNT_SMS_VALIDATION_TOKEN",
  "ACCOUNT_AUTO_VALIDATION_TOKEN",
  "QR_CONTACTS_ENCRYPTION_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_ADMIN_IDS",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_SUPPORT_USERNAME",
  "TELEGRAM_SUPPORT_USER_ID",
  "TELEGRAM_REQUIRED_GROUP_ID",
  "TELEGRAM_GROUP_INVITE_URL",
] as const;

function localEnvVars(mode: string) {
  const loaded = loadEnv(mode, process.cwd(), "");
  return Object.fromEntries(
    APP_ENV_KEYS
      .map((key) => [key, loaded[key] ?? process.env[key]] as const)
      .filter((entry): entry is [typeof APP_ENV_KEYS[number], string] => Boolean(entry[1])),
  );
}

const localBindingConfig = (mode: string, includeLocalEnvironment: boolean) => ({
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // `.env` is a local-development input only. Production receives runtime
  // values from the hosting secret store after the source has been built.
  vars: includeLocalEnvironment ? localEnvVars(mode) : {},
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
});

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig(mode, command === "serve"),
      }),
    ],
  };
});
