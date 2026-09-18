import { asString, jsonError, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  enforceAuthRateLimits,
  requireSession,
  requireUnlockedSession,
  routeError,
} from "@/app/lib/auth-server";
import {
  getSmsSettings,
  normalizeSmsDisplayName,
  updateSmsSettings,
} from "@/app/lib/sms-credits-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request);
    return jsonOk({ sms: await getSmsSettings(user.id) });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request);
    await enforceAuthRateLimits([{
      bucket: "account-sms-settings",
      subject: user.id,
      limit: 30,
      windowSeconds: 60 * 60,
    }]);
    const body = await readJson(request);
    if (Object.keys(body).some((key) => key !== "enabled" && key !== "displayName")) {
      return jsonError("La solicitud contiene campos no permitidos.", 400);
    }
    if (!("enabled" in body) && !("displayName" in body)) {
      return jsonError("Indica una configuración para actualizar.", 400);
    }
    if ("enabled" in body && typeof body.enabled !== "boolean") {
      return jsonError("El estado de SMS no es válido.", 400);
    }

    let displayName: string | undefined;
    if ("displayName" in body) {
      if (typeof body.displayName !== "string") return jsonError("El nombre de SMS no es válido.", 400);
      const rawDisplayName = asString(body.displayName);
      displayName = normalizeSmsDisplayName(rawDisplayName);
      if (rawDisplayName.trim() && displayName.length < 2) {
        return jsonError("El nombre para el SMS debe tener al menos 2 caracteres.", 400);
      }
    }

    const sms = await updateSmsSettings(user.id, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      displayName,
    });
    return jsonOk({ sms });
  } catch (error) {
    return routeError(error);
  }
}
