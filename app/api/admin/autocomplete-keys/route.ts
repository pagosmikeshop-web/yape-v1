import { jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { createAutocompleteKey } from "@/app/lib/autocomplete-credits";
import { autocompleteKeyHash } from "@/app/lib/autocomplete-credits-server";
import { dbBinding, enforceAuthRateLimits, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import { requirePermission } from "@/app/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(user, "keys:view");
    const result = await dbBinding().prepare(
      `SELECT k.id, k.token_hint, k.credits_total, k.credits_remaining,
              k.created_at, k.revoked_at, u.display_name AS created_by_name,
              (SELECT COUNT(*) FROM autocomplete_key_claims c WHERE c.key_id = k.id) AS claims
       FROM autocomplete_keys k
       JOIN users u ON u.id = k.created_by
       ORDER BY k.created_at DESC LIMIT 100`,
    ).all();
    return jsonOk({ keys: result.results ?? [] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(user, "keys:create");
    await enforceAuthRateLimits([{
      bucket: "autocomplete-key-create",
      subject: user.id,
      limit: 20,
      windowSeconds: 60 * 60,
    }]);
    const body = await readJson(request);
    if (Object.keys(body).some((key) => key !== "credits")) {
      return jsonError("La solicitud contiene campos no permitidos.", 400);
    }
    const credits = Number(body.credits);
    if (!Number.isInteger(credits) || credits < 1 || credits > 1_000_000) {
      return jsonError("La cantidad debe ser un entero entre 1 y 1000000.", 400);
    }

    const generated = createAutocompleteKey(credits);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const tokenHash = await autocompleteKeyHash(generated.raw);
    const result = await dbBinding().prepare(
      `INSERT INTO autocomplete_keys (
        id, token_hash, token_hint, credits_total, credits_remaining,
        created_by, created_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      id,
      tokenHash,
      generated.hint,
      credits,
      credits,
      user.id,
      now,
    ).run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      return jsonError("No se pudo generar la key de autocompletado.", 409);
    }
    return jsonOk({
      token: generated.formatted,
      credits,
      message: `Key creada con ${credits} créditos para una sola cuenta.`,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
