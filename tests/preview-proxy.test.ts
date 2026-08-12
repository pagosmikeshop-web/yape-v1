import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "../proxy";

const ENVIRONMENT_KEYS = [
  "APP_ENV",
  "VERCEL_ENV",
  "VERCEL_BRANCH_URL",
  "VERCEL_URL",
  "DATABASE_PROVIDER",
  "SUPABASE_DATABASE_URL",
  "PUBLIC_APP_URL",
  "PUBLIC_APP_ALLOWED_ORIGINS",
  "ADMIN_WEB_URL",
  "ADMIN_PROXY_SECRET",
  "AUTH_OWNER_TELEGRAM_ID",
  "AUTH_RATE_LIMIT_PEPPER",
  "QR_CONTACTS_ENCRYPTION_KEY",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_REQUIRED_GROUP_ID",
  "TELEGRAM_GROUP_INVITE_URL",
  "AUTH_BOOTSTRAP_ENABLED",
] as const;

const originalEnvironment = Object.fromEntries(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
);

function fixtureSecret(character: string) {
  return Array.from({ length: 32 }, () => character).join("");
}

function setPreviewEnvironment() {
  Object.assign(process.env, {
    VERCEL_ENV: "preview",
    VERCEL_BRANCH_URL: "yape-v1-git-feature-yape-1.vercel.app",
    DATABASE_PROVIDER: "supabase",
    SUPABASE_DATABASE_URL: "postgresql://preview.example/postgres",
    PUBLIC_APP_URL: "https://yape-v1.vercel.app",
    ADMIN_WEB_URL: "https://panel-admin-yape.vercel.app",
    ADMIN_PROXY_SECRET: "a".repeat(32),
    AUTH_OWNER_TELEGRAM_ID: "123456789",
    AUTH_RATE_LIMIT_PEPPER: fixtureSecret("b"),
    QR_CONTACTS_ENCRYPTION_KEY: "c".repeat(32),
    TELEGRAM_WEBHOOK_SECRET: "d".repeat(32),
    TELEGRAM_BOT_TOKEN: fixtureSecret("preview-token"),
    TELEGRAM_REQUIRED_GROUP_ID: "-1001234567890",
    TELEGRAM_GROUP_INVITE_URL: "https://t.me/preview_group",
    AUTH_BOOTSTRAP_ENABLED: "false",
  });
  delete process.env.APP_ENV;
  delete process.env.VERCEL_URL;
}

function setProductionEnvironment() {
  setPreviewEnvironment();
  Object.assign(process.env, {
    APP_ENV: "production",
    PUBLIC_APP_ALLOWED_ORIGINS: "https://yape.pro,https://yape-v1.vercel.app",
  });
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_BRANCH_URL;
}

afterEach(() => {
  for (const key of ENVIRONMENT_KEYS) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("proxy de Preview", () => {
  it("acepta el host estable de una rama de Vercel sin APP_ENV manual", () => {
    setPreviewEnvironment();

    const response = proxy(
      new NextRequest("https://yape-v1-git-feature-yape-1.vercel.app/"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("mantiene el rechazo de hosts ajenos en Preview", () => {
    setPreviewEnvironment();

    const response = proxy(new NextRequest("https://unexpected.example/"));

    expect(response.status).toBe(421);
  });

  it("acepta solo los dominios de producción configurados", () => {
    setProductionEnvironment();

    expect(proxy(new NextRequest("https://yape.pro/")).status).toBe(200);
    expect(proxy(new NextRequest("https://yape-v1.vercel.app/")).status).toBe(200);
    expect(proxy(new NextRequest("https://unexpected.example/")).status).toBe(421);
  });
});
