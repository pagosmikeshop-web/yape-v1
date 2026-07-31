export type RecipientLookupErrorCode =
  | "INVALID_PHONE"
  | "RECIPIENT_NOT_FOUND"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_INVALID_RESPONSE"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "LOOKUP_EXPIRED";

export class RecipientLookupError extends Error {
  readonly code: RecipientLookupErrorCode;

  constructor(code: RecipientLookupErrorCode, message?: string) {
    super(message);
    this.name = "RecipientLookupError";
    this.code = code;
  }
}

export function isRecipientLookupError(error: unknown): error is RecipientLookupError {
  return error instanceof RecipientLookupError;
}
