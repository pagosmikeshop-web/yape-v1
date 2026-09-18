import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  claimAutocompleteKey,
  getAutocompleteStatus,
} from "@/app/lib/autocomplete-credits-server";
import {
  authEnv,
  clearAuthRateLimit,
  dbBinding,
  enforceAuthRateLimits,
  requireSession,
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

async function userBoundToken(masterSecret: string, userId: string, kind: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${userId}:${kind}`));
  return Array.from(
    new Uint8Array(mac),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("").slice(0, 32);
}

export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request);
    const result = await dbBinding().prepare(
      `SELECT kind, enabled, validated_at
       FROM account_feature_entitlements
       WHERE user_id = ?`,
    ).bind(user.id).all<{
      kind: "sms" | "auto";
      enabled: number;
      validated_at: string;
    }>();
    return jsonOk({
      entitlements: (result.results ?? []).map((row) => ({
        kind: row.kind,
        enabled: Boolean(row.enabled),
        validatedAt: row.validated_at,
      })),
      autocomplete: await getAutocompleteStatus(user.id),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request);
    const body = await readJson(request);
    const kind = asString(body.kind);
    const token = asString(body.token).trim();

    if (kind === "sms") {
      return jsonError("Los SMS se activan canjeando créditos desde Mis datos.", 410);
    }
    if (kind !== "auto") return jsonError("Tipo de token inválido.");
    if (!token) return jsonError("Ingresa el token que deseas validar.");

    const master = authEnv().ACCOUNT_AUTO_VALIDATION_TOKEN?.trim() ?? "";

    const rateLimitSubject = `${user.id}:${kind}`;
    await enforceAuthRateLimits([{
      bucket: "account-token",
      subject: rateLimitSubject,
      limit: 8,
      windowSeconds: 10 * 60,
    }]);

    if (kind === "auto") {
      try {
        const keyStatus = await claimAutocompleteKey(user.id, token);
        if (keyStatus) {
          await clearAuthRateLimit("account-token", rateLimitSubject);
          return jsonOk(
            {
              kind,
              validated: true,
              enabled: true,
              credits: keyStatus.credits,
              keyClaimed: true,
              validatedAt: new Date().toISOString(),
            },
            { headers: { "cache-control": "no-store" } },
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message === "AUTOCOMPLETE_KEY_EXHAUSTED") {
          return jsonError("Esta key de autocompletado ya no tiene créditos.", 409);
        }
        if (error instanceof Error && error.message === "AUTOCOMPLETE_KEY_CLAIMED") {
          return jsonError("Esta key ya fue vinculada a otra cuenta.", 409);
        }
        throw error;
      }
    }

    if (master.length < 32) {
      return jsonError("La validación de esta opción no está configurada.", 503);
    }

    const expected = await userBoundToken(master, user.id, kind);
    if (!(await tokensMatch(token, expected))) return jsonError("El token no es válido.", 401);

    await clearAuthRateLimit("account-token", rateLimitSubject);
    const now = new Date().toISOString();
    await dbBinding().prepare(
      `INSERT INTO account_feature_entitlements (
        user_id, kind, enabled, validated_at, updated_at
      ) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(user_id, kind) DO UPDATE SET
        enabled = 1,
        validated_at = excluded.validated_at,
        updated_at = excluded.updated_at`,
    ).bind(user.id, kind, now, now).run();

    return jsonOk(
      { kind, validated: true, enabled: true, validatedAt: now },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
