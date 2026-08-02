import { asString, readJson } from "@/app/lib/api-utils";
import { enforceAuthRateLimits, requestIpRateLimitSubject, requireUnlockedSession } from "@/app/lib/auth-server";
import {
  assertSameOriginMutation,
  createGlobalQrContact,
  listGlobalQrContacts,
  qrJson,
  qrRouteError,
} from "@/app/lib/qr-contact-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["admin", "seller", "client"]);
    return qrJson({ ok: true, contacts: await listGlobalQrContacts(user.id) });
  } catch (error) {
    return qrRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginMutation(request, true);
    const { user } = await requireUnlockedSession(request, ["admin", "seller", "client"]);
    await enforceAuthRateLimits([
      {
        bucket: "global-qr-user",
        subject: user.id,
        limit: 30,
        windowSeconds: 60 * 60,
      },
      {
        bucket: "global-qr-ip",
        subject: await requestIpRateLimitSubject(request),
        limit: 90,
        windowSeconds: 60 * 60,
      },
    ]);
    const body = await readJson(request);
    const contact = await createGlobalQrContact(user.id, {
      holderName: asString(body.holderName),
      phone: asString(body.phone),
      provider: asString(body.provider),
      payload: asString(body.payload),
      termsAccepted: body.termsAccepted,
      termsVersion: body.termsVersion,
    });
    return qrJson({ ok: true, contact }, 201);
  } catch (error) {
    return qrRouteError(error);
  }
}
