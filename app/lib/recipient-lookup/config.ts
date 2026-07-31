type RecipientLookupEnvironment = {
  RECIPIENT_LOOKUP_PROVIDER?: string;
  RECIPIENT_LOOKUP_API_BASE_URL?: string;
  RECIPIENT_LOOKUP_API_TOKEN?: string;
};

export function recipientLookupEnv() {
  const globals = globalThis as typeof globalThis & {
    __YAPE_ENV?: RecipientLookupEnvironment;
    process?: { env?: Record<string, string | undefined> };
  };
  return globals.__YAPE_ENV
    ?? (globals.process?.env as RecipientLookupEnvironment | undefined)
    ?? {};
}
