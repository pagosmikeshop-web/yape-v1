import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  dbBinding,
  enforceAuthRateLimits,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import { requirePermission } from "@/app/lib/rbac";
import { createSmsCreditToken } from "@/app/lib/sms-credit-tokens";
import { listSmsCreditTokens, smsCreditTokenHash } from "@/app/lib/sms-credits-server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(user, "keys:view");
    return jsonOk({ tokens: await listSmsCreditTokens() });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(user, "keys:create");
    await enforceAuthRateLimits([{
      bucket: "sms-credit-token-create",
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

    const generated = createSmsCreditToken(credits);
    const now = new Date().toISOString();
    await dbBinding().prepare(
      `INSERT INTO sms_credit_tokens (
        id, token_hash, token_hint, credits, created_by, created_at,
        revoked_at, redeemed_at, redeemed_by_user_id, redeemed_ledger_id
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
    ).bind(
      crypto.randomUUID(),
      await smsCreditTokenHash(generated.raw),
      generated.hint,
      credits,
      user.id,
      now,
    ).run();
    return jsonOk({
      token: generated.formatted,
      credits,
      message: `Token SMS creado con ${credits} créditos. Se muestra una sola vez.`,
    }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin"]);
    await requirePermission(user, "keys:create");
    const body = await readJson(request);
    if (Object.keys(body).some((key) => key !== "id")) {
      return jsonError("La solicitud contiene campos no permitidos.", 400);
    }
    const id = asString(body.id).trim();
    if (!UUID_PATTERN.test(id)) return jsonError("El token no es válido.", 400);
    const result = await dbBinding().prepare(
      `UPDATE sms_credit_tokens SET revoked_at = ?
       WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL`,
    ).bind(new Date().toISOString(), id).run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      return jsonError("El token ya fue usado, revocado o no existe.", 409);
    }
    return jsonOk({ message: "Token SMS revocado." });
  } catch (error) {
    return routeError(error);
  }
}
