export type RecipientLookupRecord = {
  id?: string;
  displayName?: string;
  phone?: string;
  provider?: string;
  providers?: string[];
};

export type RecipientLookupResponse = {
  recipient?: RecipientLookupRecord;
  error?: string;
};

type RecipientLookupOptions = {
  configuredOnly?: boolean;
  signal?: AbortSignal;
};

async function postRecipientLookup(
  body: { recipientId: string } | { phone: string; configuredOnly?: true },
  signal?: AbortSignal,
): Promise<{ response: Response; data: RecipientLookupResponse }> {
  const response = await fetch("/api/payments/recipient-lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  const data = (await response.json()) as RecipientLookupResponse;
  return { response, data };
}

export function lookupRecipientById(
  recipientId: string,
  signal?: AbortSignal,
) {
  return postRecipientLookup({ recipientId }, signal);
}

export function lookupRecipientByPhone(
  phone: string,
  options: RecipientLookupOptions = {},
) {
  return postRecipientLookup(
    options.configuredOnly ? { phone, configuredOnly: true } : { phone },
    options.signal,
  );
}
