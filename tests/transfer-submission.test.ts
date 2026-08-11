import { afterEach, describe, expect, it, vi } from "vitest";
import {
  submitTransferRequest,
  type TransferIdempotencyRef,
} from "../app/lib/transfer-submission";

const baseRequest = (idempotencyRef: TransferIdempotencyRef) => ({
  amountValue: 15,
  recipientId: "recipient-123",
  recipientQrId: "",
  recipientPhone: "999 888 777",
  recipientName: "Josue Ten",
  destination: "Yape",
  message: "Pago de prueba",
  idempotencyRef,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("envío de transferencia", () => {
  it("envía el payload y reutiliza la clave para el mismo intento", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ balance: 485 }), { status: 200 }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const idempotencyRef: TransferIdempotencyRef = { current: null };

    await submitTransferRequest(baseRequest(idempotencyRef));
    await submitTransferRequest(baseRequest(idempotencyRef));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const secondOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(firstOptions.headers).get("idempotency-key")).toBe(
      new Headers(secondOptions.headers).get("idempotency-key"),
    );
    expect(JSON.parse(String(firstOptions.body))).toMatchObject({
      amountCents: 1500,
      recipientId: "recipient-123",
      recipientPhone: "",
      destination: "Yape",
      message: "Pago de prueba",
    });
  });

  it("regenera la clave cuando cambia el destino del intento", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ balance: 470 }), { status: 200 }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const idempotencyRef: TransferIdempotencyRef = { current: null };

    await submitTransferRequest(baseRequest(idempotencyRef));
    await submitTransferRequest({
      ...baseRequest(idempotencyRef),
      destination: "Plin",
    });

    const firstOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const secondOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(firstOptions.headers).get("idempotency-key")).not.toBe(
      new Headers(secondOptions.headers).get("idempotency-key"),
    );
    expect(JSON.parse(String(secondOptions.body))).toMatchObject({
      destination: "Plin",
    });
  });
});
