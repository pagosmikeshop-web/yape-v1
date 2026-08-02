const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomTokenPart(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let value = "";
  for (const byte of bytes) value += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return value;
}
