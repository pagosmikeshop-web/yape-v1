import { randomTokenPart } from "@/app/lib/random-token";

const RAW_TOKEN_PATTERN = /^SMS[A-Z0-9]{16}$/u;

export function normalizeSmsCreditToken(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

export function isSmsCreditToken(value: string) {
  return RAW_TOKEN_PATTERN.test(normalizeSmsCreditToken(value));
}

export function formatSmsCreditToken(value: string) {
  return normalizeSmsCreditToken(value).match(/.{1,4}/gu)?.join("-") ?? value;
}

export function createSmsCreditToken(credits: number) {
  const raw = `SMS${randomTokenPart(16)}`;
  return {
    raw,
    formatted: formatSmsCreditToken(raw),
    credits,
    hint: raw.slice(-4),
  };
}
