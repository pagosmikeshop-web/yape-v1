import { jsonOk } from "@/app/lib/api-utils";
import { requireSession, routeError } from "@/app/lib/auth-server";
import { buildAuthenticationOptions } from "@/app/lib/webauthn-server";

export const dynamic = "force-dynamic";

/**
 * FASE 2.1 — Genera opciones de autenticación (userVerification: required).
 * Usa la sesión existente (aún bloqueada) para saber qué credenciales permitir.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireSession(request);
    const options = await buildAuthenticationOptions(request, user);
    return jsonOk({ options }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
