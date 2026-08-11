export type TransferSubmissionData = {
  balance?: number;
  movement?: {
    recipientName?: string;
    recipientReference?: string;
    securityCode?: string;
    operationNumber?: string;
    createdAt?: string;
  };
  error?: string;
};

export type TransferIdempotencyRef = {
  current: {
    key: string;
    payload: string;
  } | null;
};

export type SubmitTransferRequest = {
  amountValue: number;
  recipientId: string;
  recipientQrId: string;
  recipientPhone: string;
  recipientName: string;
  destination: string;
  message: string;
  idempotencyRef: TransferIdempotencyRef;
};

export async function submitTransferRequest(
  input: SubmitTransferRequest,
): Promise<{ response: Response; data: TransferSubmissionData }> {
  const transferRecipientPhone =
    input.recipientId || input.recipientQrId ? "" : input.recipientPhone;
  const transferPayload = JSON.stringify({
    amountCents: Math.round(input.amountValue * 100),
    recipientId: input.recipientId,
    recipientQrId: input.recipientQrId,
    recipientPhone: transferRecipientPhone,
    recipientManualName: input.recipientName.trim(),
    destination: input.destination,
    message: input.message,
  });

  if (input.idempotencyRef.current?.payload !== transferPayload) {
    input.idempotencyRef.current = {
      key: crypto.randomUUID(),
      payload: transferPayload,
    };
  }

  const idempotencyKey = input.idempotencyRef.current?.key;
  if (!idempotencyKey) {
    throw new Error("No pudimos preparar el yapeo.");
  }

  const response = await fetch("/api/payments/transfer", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: transferPayload,
    cache: "no-store",
  });
  const data = (await response.json()) as TransferSubmissionData;

  return { response, data };
}
