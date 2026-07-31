import type { RecipientLookupErrorCode } from "./errors";

export type RecipientLookupProvider = {
  readonly name: string;
  lookupByPhone(phone: string, signal?: AbortSignal): Promise<{ fullName: string }>;
};

export type RecipientLookupResult = {
  phone: string;
  displayName: string;
};

export type RecipientLookupResponse =
  | { ok: true; result: RecipientLookupResult }
  | { ok: false; code: RecipientLookupErrorCode };
