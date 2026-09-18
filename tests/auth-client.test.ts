import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRequestError, requestAuthJson } from "../app/lib/auth-client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("requestAuthJson", () => {
  it("preserves the authentication request contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, userId: "user-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestAuthJson("/api/auth/login", { username: "ana" }, { attemptId: "attempt-1" }))
      .resolves.toEqual({ ok: true, userId: "user-1" });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-auth-attempt": "attempt-1",
      },
      body: JSON.stringify({ username: "ana" }),
      signal: expect.any(AbortSignal),
    }));
  });

  it("keeps API status, code and referral information for failed requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: "Cuenta bloqueada.",
      code: "ACCOUNT_BLOCKED",
      referralCode: "REF-123",
    }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })));

    await expect(requestAuthJson("/api/auth/login", { username: "ana" })).rejects.toMatchObject({
      name: "AuthRequestError",
      kind: "http",
      status: 403,
      code: "ACCOUNT_BLOCKED",
      referralCode: "REF-123",
      retryable: false,
    } satisfies Partial<AuthRequestError>);
  });

  it("normalizes connection failures without leaking the original error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("socket reset")));

    await expect(requestAuthJson("/api/auth/login", { username: "ana" })).rejects.toMatchObject({
      name: "AuthRequestError",
      kind: "network",
      status: 0,
      retryable: true,
      message: "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.",
    } satisfies Partial<AuthRequestError>);
  });

  it("rejects an incomplete successful response as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(requestAuthJson("/api/auth/login", { username: "ana" })).rejects.toMatchObject({
      name: "AuthRequestError",
      kind: "invalid-response",
      status: 204,
      retryable: true,
    } satisfies Partial<AuthRequestError>);
  });
});
