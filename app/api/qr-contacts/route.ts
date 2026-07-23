import { asString, readJson } from "@/app/lib/api-utils";
import { requireUnlockedSession } from "@/app/lib/auth-server";
import {
  assertSameOriginMutation,
  createQrContact,
  listQrContacts,
  qrJson,
  qrRouteError,
} from "@/app/lib/qr-contact-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await requireUnlockedSession(request, ["client"]);
    return qrJson({ ok: true, contacts: await listQrContacts(user.id) });
  } catch (error) {
    return qrRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginMutation(request, true);
    const { user } = await requireUnlockedSession(request, ["client"]);
    const body = await readJson(request);
    const contact = await createQrContact(user.id, {
      holderName: asString(body.holderName),
      phone: asString(body.phone),
      provider: asString(body.provider),
      payload: asString(body.payload),
    });
    return qrJson({ ok: true, contact }, 201);
  } catch (error) {
    return qrRouteError(error);
  }
}
