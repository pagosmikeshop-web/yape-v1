import { requireUnlockedSession } from "@/app/lib/auth-server";
import {
  assertSameOriginMutation,
  deleteGlobalQrContact,
  qrJson,
  qrRouteError,
} from "@/app/lib/qr-contact-server";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginMutation(request, false);
    const { user } = await requireUnlockedSession(request, ["admin", "seller", "client"]);
    const { id } = await context.params;
    await deleteGlobalQrContact(user.id, id);
    return qrJson({ ok: true });
  } catch (error) {
    return qrRouteError(error);
  }
}
