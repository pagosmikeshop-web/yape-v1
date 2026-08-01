const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RAW_TOKEN_PATTERN = /^AUTO[A-Z0-9]{16}$/u;

function randomTokenPart(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let value = "";
  for (const byte of bytes) value += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return value;
}

export function normalizeAutocompleteKey(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

export function isAutocompleteKey(value: string) {
  return RAW_TOKEN_PATTERN.test(normalizeAutocompleteKey(value));
}

export function formatAutocompleteKey(value: string) {
  return normalizeAutocompleteKey(value).match(/.{1,4}/gu)?.join("-") ?? value;
}

export function createAutocompleteKey(credits: number) {
  const raw = `AUTO${randomTokenPart(16)}`;
  return {
    raw,
    formatted: formatAutocompleteKey(raw),
    credits,
    hint: raw.slice(-4),
  };
}

