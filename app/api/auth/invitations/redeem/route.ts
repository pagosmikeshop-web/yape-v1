import { asString, jsonOk, readJson } from "@/app/lib/api-utils";
import {
  enforceAuthRateLimits,
  requestIpRateLimitSubject,
  routeError,
  validatePassword,
} from "@/app/lib/auth-server";
import { redeemInvitation } from "@/app/lib/invitation-server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store" };
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function invitationError(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const token = asString(body.token).trim();
    const password = asString(body.password);
    const confirmPassword = asString(body.confirmPassword);
    const pin = asString(body.pin).replace(/\D/gu, "");
    const confirmPin = asString(body.confirmPin).replace(/\D/gu, "");

    if (!INVITATION_TOKEN_PATTERN.test(token)) {
      return invitationError("La invitación no es válida, ya fue utilizada o ha vencido.");
    }
    if (!validatePassword(password)) {
      return invitationError("Usa una contraseña de 8 a 128 caracteres.");
    }
    if (password !== confirmPassword) {
      return invitationError("Las contraseñas no coinciden.");
    }
    if (!/^\d{6}$/u.test(pin)) {
      return invitationError("El PIN debe tener exactamente 6 dígitos.");
    }
    if (pin !== confirmPin) {
      return invitationError("Los PIN no coinciden.");
    }

    await enforceAuthRateLimits([
      {
        bucket: "invitation-redeem-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 12,
        windowSeconds: 15 * 60,
      },
      {
        bucket: "invitation-redeem-token",
        subject: token,
        limit: 5,
        windowSeconds: 15 * 60,
      },
    ]);

    const redeemed = await redeemInvitation(token, password, pin);
    if (!redeemed) {
      return invitationError("La invitación no es válida, ya fue utilizada o ha vencido.");
    }

    return jsonOk(
      { message: "Tu contraseña y PIN fueron creados. Ya puedes iniciar sesión." },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return routeError(error);
  }
}
