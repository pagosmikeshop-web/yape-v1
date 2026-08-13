const DEFAULT_MAX_JSON_BYTES = 32 * 1024;
const JSON_CONTENT_TYPES = new Set(["application/json", "application/problem+json"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type ApiEnvironment = {
  ADMIN_WEB_URL?: string;
};

type ReadJsonOptions = {
  maxBytes?: number;
  requireTrustedOrigin?: boolean;
};

function apiEnvironment() {
  const globals = globalThis as typeof globalThis & {
    __YAPE_ENV?: ApiEnvironment;
    process?: { env?: Record<string, string | undefined> };
  };
  return globals.__YAPE_ENV ?? (globals.process?.env as ApiEnvironment | undefined) ?? {};
}

function normalizedOrigin(value: string | undefined) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function trustedOrigins(request: Request) {
  const requestUrl = new URL(request.url);
  const origins = new Set([requestUrl.origin]);
  const adminOrigin = normalizedOrigin(apiEnvironment().ADMIN_WEB_URL);
  if (adminOrigin) origins.add(adminOrigin);

  // El panel local usa un proxy Vite en otro puerto. Esta excepción nunca se
  // aplica a hosts de producción.
  if (isLoopbackHost(requestUrl.hostname)) {
    origins.add("http://localhost:3002");
    origins.add("http://127.0.0.1:3002");
  }
  return origins;
}

export function assertTrustedMutation(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw jsonError("Solicitud de otro sitio bloqueada.", 403);
  }

  const origin = normalizedOrigin(request.headers.get("origin") ?? undefined);
  const refererOrigin = normalizedOrigin(request.headers.get("referer") ?? undefined);
  const candidate = origin || refererOrigin;
  if (!candidate || !trustedOrigins(request).has(candidate)) {
    throw jsonError("Solicitud de otro origen bloqueada.", 403);
  }
}

async function readTextWithinLimit(request: Request, maxBytes: number) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("JSON body-size limit exceeded");
        throw jsonError("La solicitud excede el tamaño permitido.", 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonText(request: Request, options: ReadJsonOptions = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) {
    throw new Error("Invalid JSON body-size policy.");
  }
  if (options.requireTrustedOrigin !== false) assertTrustedMutation(request);

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!JSON_CONTENT_TYPES.has(contentType)) {
    throw jsonError("El contenido debe enviarse como JSON.", 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw jsonError("La solicitud excede el tamaño permitido.", 413);
  }

  return readTextWithinLimit(request, maxBytes);
}

export function parseJsonObject(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw jsonError("El cuerpo JSON no es válido.", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw jsonError("El cuerpo JSON debe ser un objeto.", 400);
  }
  return value as Record<string, unknown>;
}

export async function readJson(request: Request, options: ReadJsonOptions = {}) {
  return parseJsonObject(await readJsonText(request, options));
}

export function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function jsonOk(data: Record<string, unknown> = {}, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return Response.json({ ok: true, ...data }, { ...init, headers });
}

export function jsonError(message: string, status = 400, code?: string) {
  return Response.json(
    { ok: false, error: message, ...(code ? { code } : {}) },
    { status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } },
  );
}
