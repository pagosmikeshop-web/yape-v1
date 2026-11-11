import process from "node:process";

const allowedPaths = new Set([
  "/api/internal/retention",
  "/api/internal/sms-delivery-reconciliation",
]);
const path = process.env.CRON_PATH?.trim() ?? "";
const baseUrl = process.env.PUBLIC_APP_URL?.trim() ?? "";
const secret = process.env.CRON_SECRET?.trim() ?? "";

if (!allowedPaths.has(path)) {
  throw new Error("CRON_PATH no está configurado con una ruta interna permitida.");
}
if (!/^https:\/\//u.test(baseUrl)) {
  throw new Error("PUBLIC_APP_URL debe ser una URL HTTPS válida.");
}
if (secret.length < 32) {
  throw new Error("CRON_SECRET no está configurado.");
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30_000);
try {
  const response = await fetch(new URL(path, baseUrl), {
    headers: {
      authorization: `Bearer ${secret}`,
      "cache-control": "no-store",
    },
    signal: controller.signal,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`La tarea ${path} respondió HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
  console.log(`Railway cron ${path} completado: HTTP ${response.status}`);
} finally {
  clearTimeout(timer);
}

