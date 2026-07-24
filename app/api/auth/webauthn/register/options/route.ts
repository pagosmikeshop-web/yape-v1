import { jsonError, jsonOk } from "@/app/lib/api-utils";
import { requireSession, routeError } from "@/app/lib/auth-server";
import {
  buildRegistrationOptions,
  userHasWebAuthn,
} from "@/app/lib/webauthn-server";

export const dynamic = "force-dynamic";

/**
 * FASE 1.1 — Genera opciones de registro WebAuthn (platform + UV required).
 * Requiere sesión; idealmente el usuario ya configuró PIN.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireSession(request);
    if (user.mustChangePassword) {
      return jsonError("Cambia tu contraseña antes de activar biometría.", 428);
    }
    if (user.mustSetPin || !user.pinSet) {
      return jsonError("Configura tu clave de 6 dígitos antes de activar biometría.", 428);
    }
    const options = await buildRegistrationOptions(request, user);
    return jsonOk(
      { options, alreadyRegistered: await userHasWebAuthn(user.id) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
