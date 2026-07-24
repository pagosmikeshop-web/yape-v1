import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  requireSession,
  rotateAndUnlockSession,
  routeError,
} from "@/app/lib/auth-server";
import { completeAuthentication } from "@/app/lib/webauthn-server";

export const dynamic = "force-dynamic";

/**
 * FASE 2.3 — Verifica la respuesta del dispositivo e inicia/desbloquea la sesión
 * (mismo efecto que verificar el PIN: rotateAndUnlockSession).
 */
export async function POST(request: Request) {
  try {
    const { user, sessionId } = await requireSession(request);
    if (user.mustChangePassword) {
      return jsonError("Cambia tu contraseña antes de continuar.", 428);
    }
    if (user.mustSetPin || !user.pinSet) {
      return jsonError("Configura tu clave antes de usar biometría.", 428);
    }

    const body = await readJson(request);
    const credential = body.credential as AuthenticationResponseJSON | undefined;
    if (!credential || typeof credential !== "object" || typeof credential.id !== "string") {
      return jsonError("La respuesta biométrica no es válida.");
    }

    await completeAuthentication(request, user, credential);
    const { unlockedUntil, cookie } = await rotateAndUnlockSession(request, sessionId);

    return jsonOk(
      { user: { ...user, unlocked: true }, unlockedUntil },
      { headers: { "cache-control": "no-store", "set-cookie": cookie } },
    );
  } catch (error) {
    return routeError(error);
  }
}
