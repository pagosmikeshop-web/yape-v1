import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthRequestError,
  authErrorMessage,
  requestAuthJson,
} from "../app/lib/auth-client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("autenticación determinista", () => {
  it("envía un único intento con caché desactivada y credenciales de sesión", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, user: { id: "user-1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await requestAuthJson("/api/auth/login", { sellerId: "YAPE", username: "demo" }, { attemptId: "attempt-1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("x-auth-attempt")).toBe("attempt-1");
  });

  it("clasifica una caída de red sin convertirla en credenciales inválidas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await requestAuthJson("/api/auth/login", {}).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AuthRequestError);
    expect(error).toMatchObject({ kind: "network", retryable: true, status: 0 });
    expect(authErrorMessage(error)).toContain("conectar con el servidor");
  });

  it("mantiene los errores de credenciales como no reintentables", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: "Credenciales invalidas." }, 401)));

    const error = await requestAuthJson("/api/auth/login", {}).catch((value: unknown) => value);

    expect(error).toMatchObject({ kind: "http", status: 401, retryable: false });
    expect(authErrorMessage(error)).toBe("Credenciales invalidas.");
  });

  it("marca un 503 como recuperable y no como identidad inválida", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: "Telegram no respondió." }, 503)));

    const error = await requestAuthJson("/api/auth/register/status", {}).catch((value: unknown) => value);

    expect(error).toMatchObject({ kind: "http", status: 503, retryable: true });
    expect(authErrorMessage(error)).toContain("Telegram no respondió");
  });

  it("expira una petición que queda pendiente", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_: string, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));

    const pending = requestAuthJson("/api/auth/login", {}, { timeoutMs: 25 }).catch((value: unknown) => value);
    await vi.advanceTimersByTimeAsync(25);
    const error = await pending;

    expect(error).toMatchObject({ kind: "timeout", retryable: true });
  });

});
