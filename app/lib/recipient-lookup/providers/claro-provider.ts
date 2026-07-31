import { recipientLookupEnv } from "../config";
import { RecipientLookupError } from "../errors";
import type { RecipientLookupProvider } from "../types";

const MAX_RESPONSE_BYTES = 64 * 1024;
const PROVIDER_TIMEOUT_MS = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Extrae exclusivamente data[0].titular.nombre del contrato real del proveedor. */
export function parseClaroRecipientResponse(value: unknown) {
  if (!isRecord(value) || value.success !== true) {
    throw new RecipientLookupError("RECIPIENT_NOT_FOUND", "No encontramos un titular para ese número.");
  }
  if (!Array.isArray(value.data) || value.data.length === 0 || !isRecord(value.data[0])) {
    throw new RecipientLookupError("PROVIDER_INVALID_RESPONSE", "El proveedor no devolvió un titular válido.");
  }
  const holder = value.data[0].titular;
  const fullName = isRecord(holder) && typeof holder.nombre === "string" ? holder.nombre.trim() : "";
  if (!fullName) {
    throw new RecipientLookupError("PROVIDER_INVALID_RESPONSE", "El proveedor no devolvió un titular válido.");
  }
  return { fullName };
}

async function readJsonResponse(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new RecipientLookupError("PROVIDER_INVALID_RESPONSE", "La respuesta del proveedor es demasiado grande.");
  }
  const reader = response.body?.getReader();
  if (!reader) return JSON.parse(await response.text()) as unknown;
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RecipientLookupError("PROVIDER_INVALID_RESPONSE", "La respuesta del proveedor es demasiado grande.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RecipientLookupError("PROVIDER_INVALID_RESPONSE", "La respuesta del proveedor no es válida.");
  }
}

function providerUrl(phone: string) {
  const env = recipientLookupEnv();
  const base = env.RECIPIENT_LOOKUP_API_BASE_URL?.trim() ?? "";
  const token = env.RECIPIENT_LOOKUP_API_TOKEN?.trim() ?? "";
  if (!base || !token) {
    throw new RecipientLookupError("PROVIDER_UNAVAILABLE", "La consulta de destinatarios no está configurada.");
  }
  let url: URL;
  try {
    url = new URL(`${base.replace(/\/+$/u, "")}/${phone}`);
  } catch {
    throw new RecipientLookupError("PROVIDER_UNAVAILABLE", "La consulta de destinatarios no está disponible.");
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new RecipientLookupError("PROVIDER_UNAVAILABLE", "La consulta de destinatarios no está disponible.");
  }
  url.searchParams.set("token", token);
  return url;
}

export const claroRecipientLookupProvider: RecipientLookupProvider = {
  name: "claro",
  async lookupByPhone(phone, signal) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    const abortListener = () => controller.abort();
    signal?.addEventListener("abort", abortListener, { once: true });
    try {
      const response = await fetch(providerUrl(phone), {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new RecipientLookupError("RATE_LIMITED", "La consulta no está disponible temporalmente.");
      }
      const body = await readJsonResponse(response);
      if (!response.ok) {
        if (isRecord(body) && body.success === false) {
          throw new RecipientLookupError("RECIPIENT_NOT_FOUND", "No encontramos un titular para ese número.");
        }
        throw new RecipientLookupError("PROVIDER_UNAVAILABLE", "La consulta no está disponible temporalmente.");
      }
      return parseClaroRecipientResponse(body);
    } catch (error) {
      if (error instanceof RecipientLookupError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        if (signal?.aborted) throw error;
        throw new RecipientLookupError("PROVIDER_TIMEOUT", "La consulta tardó demasiado.");
      }
      throw new RecipientLookupError("PROVIDER_UNAVAILABLE", "No pudimos consultar el destinatario.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortListener);
    }
  },
};
