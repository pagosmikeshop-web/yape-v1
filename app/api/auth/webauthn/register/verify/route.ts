import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import { requireSession, routeError } from "@/app/lib/auth-server";
import { completeRegistration } from "@/app/lib/webauthn-server";

export const dynamic = "force-dynamic";

/**
 * FASE 1.3 — Verifica la credencial del dispositivo y la guarda asociada al usuario.
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

    const body = await readJson(request);
    const credential = body.credential as RegistrationResponseJSON | undefined;
    if (!credential || typeof credential !== "object" || typeof credential.id !== "string") {
      return jsonError("La respuesta biométrica no es válida.");
    }

    const result = await completeRegistration(request, user, credential);
    return jsonOk(
      { registered: true, credentialId: result.credentialId },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
