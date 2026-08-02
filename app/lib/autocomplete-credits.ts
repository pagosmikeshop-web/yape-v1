import { randomTokenPart } from "./random-token";

const RAW_TOKEN_PATTERN = /^AUTO[A-Z0-9]{16}$/u;

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
