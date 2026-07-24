import { jsonOk, readJson } from "@/app/lib/api-utils";
import { requireSession, requireUnlockedSession, routeError } from "@/app/lib/auth-server";
import {
  deleteAllUserCredentials,
  userHasWebAuthn,
} from "@/app/lib/webauthn-server";

export const dynamic = "force-dynamic";

/** Estado: ¿el usuario tiene Face ID / huella registrados? */
export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request);
    return jsonOk(
      { enabled: await userHasWebAuthn(user.id) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}

/** Desactivar biométricos (borra credenciales). Requiere sesión desbloqueada. */
export async function DELETE(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request);
    await readJson(request).catch(() => ({}));
    await deleteAllUserCredentials(user.id);
    return jsonOk({ enabled: false }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
