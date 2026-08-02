/** Serializa las coordenadas públicas relevantes en un orden estable. */
export function canonicalPublicKey(key: JsonWebKey) {
  return JSON.stringify({
    crv: key.crv,
    kty: key.kty,
    x: key.x,
    y: key.y,
  });
}
