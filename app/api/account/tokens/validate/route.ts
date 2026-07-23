import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  authEnv,
  clearAuthRateLimit,
  enforceAuthRateLimits,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";

export const dynamic = "force-dynamic";

async function tokensMatch(received: string, expected: string) {
  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(receivedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request);
    const body = await readJson(request);
    const kind = asString(body.kind);
    const token = asString(body.token).trim();

    if (kind !== "sms" && kind !== "auto") return jsonError("Tipo de token inválido.");
    if (!token) return jsonError("Ingresa el token que deseas validar.");

    const expected = (kind === "sms"
      ? authEnv().ACCOUNT_SMS_VALIDATION_TOKEN
      : authEnv().ACCOUNT_AUTO_VALIDATION_TOKEN)?.trim() ?? "";

    if (expected.length < 8) {
      return jsonError("La validación de esta opción no está configurada.", 503);
    }

    const rateLimitSubject = `${user.id}:${kind}`;
    await enforceAuthRateLimits([{ bucket: "account-token", subject: rateLimitSubject, limit: 8, windowSeconds: 10 * 60 }]);

    if (!(await tokensMatch(token, expected))) return jsonError("El token no es válido.", 401);

    await clearAuthRateLimit("account-token", rateLimitSubject);
    return jsonOk({ kind, validated: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
